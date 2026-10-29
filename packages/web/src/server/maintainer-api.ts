/**
 * Auto-Maintainer endpoints:
 *   GET  /api/maintainer/config          → model, sandbox, who can open PRs
 *   POST /api/maintainer                 → start a run { issueUrl, budgetUSD?, metaApiKey?, rememberKey? }
 *   GET  /api/maintainer/:id/events      → Server-Sent Events
 *   POST /api/maintainer/:id/pr          → open the PR on GitHub (explicit user action only)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  DEMO_ISSUE_URL,
  DEMO_SNAPSHOT,
  GitHubClient,
  GitHubError,
  diffBundle,
  parseIssueUrl,
  runMaintainer,
  splitPr,
  type MaintainerEvent,
  type MaintainerResult,
} from "@thepolisher/agents";
import { currentUser, isAuthEnabled, isSameOrigin, rememberMetaKey, savedMetaKey } from "./auth/auth-api.js";
import { checkRunLimits, freeRunsFromEnv, runLimitsFromEnv } from "./auth/limits.js";
import { finishedRecord, saveQuietly, startedRecord } from "./history.js";
import { VerifiedMemory, freeRunStore, runStore, sharedMemory, type RunRecord } from "./store/index.js";
import type { FreeRunClaim } from "./store/free-runs.js";
import {
  activeProvider,
  githubClient,
  isSimulated,
  modelClientForKey,
  modelClientOrNull,
  providerStatus,
  readJsonBody,
  requiresUserKey,
  sandboxClientOrNull,
  sendJson,
} from "./http.js";
import { SessionRegistry } from "./sessions.js";

const StartSchema = z.object({
  issueUrl: z.string().trim().min(1, "Paste a GitHub issue link.").max(500),
  budgetUSD: z.number().min(0.1).max(20).default(3),
  metaApiKey: z
    .string()
    .trim()
    .min(10, "That Meta API key looks too short.")
    .max(300)
    .regex(/^\S+$/, "A Meta API key has no spaces.")
    .optional(),
  /** Save metaApiKey (encrypted) to the signed-in user's account for later runs. */
  rememberKey: z.boolean().default(false),
});

const LOCAL_OWNER = "local";
const todayUtc = () => new Date().toISOString().slice(0, 10);
const startOfTodayUtc = () => `${todayUtc()}T00:00:00.000Z`;

const MAX_BODY_BYTES = 8 * 1024;
const registry = new SessionRegistry<MaintainerEvent, MaintainerResult>();

export async function handleMaintainerRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = (req.url ?? "").split("?")[0];

  if (req.method === "GET" && url === "/api/maintainer/config") {
    const status = providerStatus();
    const user = await currentUser(req);
    const owner = user?.login ?? LOCAL_OWNER;
    // With sign-in on, PRs are opened as the signed-in user; without it, with the server's GITHUB_TOKEN.
    const prAccess = isAuthEnabled()
      ? user
        ? "ready"
        : "sign_in"
      : process.env.GITHUB_TOKEN?.trim()
        ? "ready"
        : "set_token";
    // When every user brings their own Meta key, the server having none is the intended setup.
    const needsUserKey = requiresUserKey() && !isSimulated();
    // Free runs left for this person, or null when there are none to offer (signed out, or turned off).
    const free = freeRunsFromEnv();
    let freeRunsLeft: number | null = null;
    if (needsUserKey && free && user) {
      try {
        freeRunsLeft = Math.max(0, free.perUser - (await freeRunStore().used(user.githubId)));
      } catch {
        freeRunsLeft = null;
      }
    }
    sendJson(res, 200, {
      provider: status.provider,
      isSimulated: status.provider === "simulated",
      isConfigured: status.isConfigured || needsUserKey,
      model: status.model,
      setupHint: needsUserKey ? null : status.setupHint,
      isSandboxConfigured: sandboxClientOrNull() !== null,
      prAccess,
      demoIssueUrl: isSimulated() ? DEMO_ISSUE_URL : null,
      // Each person reattaches to their own run, never someone else's.
      activeRunId: registry.activeSessions().find((s) => s.meta.owner === owner)?.id ?? null,
      isAuthEnabled: isAuthEnabled(),
      requiresUserKey: needsUserKey,
      freeRunsLeft,
      freeRunsPerUser: free?.perUser ?? null,
      freeRunBudgetUSD: free?.budgetUSD ?? null,
    });
    return true;
  }

  if (req.method === "POST" && url === "/api/maintainer") {
    let body: unknown;
    try {
      body = await readJsonBody(req, MAX_BODY_BYTES);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : "Invalid request." });
      return true;
    }
    const parsed = StartSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return true;
    }
    if (!isSimulated()) {
      try {
        parseIssueUrl(parsed.data.issueUrl);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : "Invalid issue link." });
        return true;
      }
    }
    if (!isSameOrigin(req)) {
      sendJson(res, 403, { error: "Cross-site request refused." });
      return true;
    }
    const user = await currentUser(req);
    if (isAuthEnabled() && !user) {
      sendJson(res, 401, { error: "Sign in with GitHub to start a run." });
      return true;
    }
    // Without sign-in (local development) every run belongs to one local owner.
    const owner = user?.login ?? LOCAL_OWNER;
    const active = registry.activeSessions();
    const blocked = checkRunLimits(
      {
        userActive: active.filter((s) => s.meta.owner === owner).length,
        userToday: user ? await runStore().countSince(user.login, startOfTodayUtc()) : 0,
        globalActive: active.length,
      },
      runLimitsFromEnv()
    );
    if (blocked) {
      sendJson(res, 429, { error: blocked });
      return true;
    }

    // Bring your own key: the one typed in, else the one the user chose to save. Never logged.
    // Without one, a signed-in person may use one of their free runs on the server's key.
    const typedKey = parsed.data.metaApiKey;
    const userKey = typedKey ?? (user ? await savedMetaKey(user) : null) ?? undefined;
    const free = freeRunsFromEnv();
    const isFreeRun = requiresUserKey() && !userKey && !isSimulated();
    if (isFreeRun && (!user || !free)) {
      sendJson(res, 400, { error: "Add your Meta Model API key to start a run." });
      return true;
    }
    const client = userKey && activeProvider() === "meta" ? modelClientForKey(userKey) : modelClientOrNull();
    if (!client) {
      sendJson(res, 503, { error: `${providerStatus().setupHint} To try the scripted demo, run \`pnpm --filter @thepolisher/web dev:sim\`.` });
      return true;
    }
    // Claimed last, once nothing else can refuse the run, so a refused run never costs a free one.
    if (isFreeRun && user && free) {
      let claim: FreeRunClaim;
      try {
        claim = await freeRunStore().claim(user.githubId, todayUtc(), free);
      } catch {
        sendJson(res, 503, { error: "Couldn't check your free runs just now. Try again, or add your Meta Model API key." });
        return true;
      }
      if (claim !== "ok") {
        sendJson(res, 400, {
          error:
            claim === "user_limit"
              ? `You've used your ${free.perUser} free runs. Add your Meta Model API key (dev.meta.ai → API keys) to keep going.`
              : "Today's free runs are all used. Add your Meta Model API key to keep going, or try again tomorrow.",
        });
        return true;
      }
    }
    const budgetUSD = isFreeRun && free ? Math.min(parsed.data.budgetUSD, free.budgetUSD) : parsed.data.budgetUSD;

    if (user && typedKey && parsed.data.rememberKey) {
      await saveQuietly("remember the Meta key", () => rememberMetaKey(user, typedKey));
    }

    const source = isSimulated()
      ? ({ kind: "snapshot", snapshot: DEMO_SNAPSHOT } as const)
      : // Read with the user's own token: each person gets GitHub's full rate limit instead of sharing one.
        ({ kind: "github", issueUrl: parsed.data.issueUrl, github: user ? new GitHubClient({ token: user.token }) : githubClient() } as const);
    const provider = activeProvider();
    // Shared memory only learns from this run if the sandbox verifies its result.
    const memory = new VerifiedMemory(sharedMemory(provider));
    const holder: { started: RunRecord | null } = { started: null };
    const session = registry.start(
      async (publish) => {
        let result: MaintainerResult;
        try {
          result = await runMaintainer(source, {
            client,
            sandbox: sandboxClientOrNull() ?? undefined,
            budgetUSD,
            experience: memory,
            provider,
            onEvent: publish,
          });
        } catch (err) {
          // A run that stops with an error (closed issue, file too large) is saved as failed, not left "running".
          const started = holder.started;
          if (started) {
            // What was spent before it stopped: the running total from the last cost event.
            const spent = session.events.reduce((usd, e) => (e.type === "cost" ? e.totalUSD : usd), 0);
            await saveQuietly("save the failed run", () =>
              runStore().finish(finishedRecord(started, { status: "failed", totalUSD: spent, title: "" }), session.events)
            );
          }
          throw err;
        }
        const started = holder.started;
        if (started) {
          const finished = finishedRecord(started, { status: result.status, totalUSD: result.totalUSD, title: result.snapshot?.issue.title ?? "" });
          await saveQuietly("save the finished run", () => runStore().finish(finished, session.events));
        }
        await saveQuietly("share this run's lessons", () => memory.commit(result.status));
        return result;
      },
      (message) => ({ type: "error", message, at: Date.now() })
    );
    session.meta.owner = owner;
    holder.started = startedRecord(session.id, parsed.data.issueUrl, providerStatus().model, user?.login ?? null);
    const started = holder.started;
    void saveQuietly("record the run start", () => runStore().start(started));
    sendJson(res, 201, { id: session.id, isSimulated: isSimulated() });
    return true;
  }

  const events = url.match(/^\/api\/maintainer\/([0-9a-f-]{36})\/events$/);
  if (req.method === "GET" && events) {
    const session = registry.get(events[1]);
    if (!session) {
      sendJson(res, 404, { error: "Run not found. The server may have restarted." });
      return true;
    }
    registry.stream(req, res, session);
    return true;
  }

  const pr = url.match(/^\/api\/maintainer\/([0-9a-f-]{36})\/pr$/);
  if (req.method === "POST" && pr) {
    if (!isSameOrigin(req)) {
      sendJson(res, 403, { error: "Cross-site request refused." });
      return true;
    }
    await openPullRequest(req, res, pr[1]);
    return true;
  }

  return false;
}

async function openPullRequest(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const session = registry.get(id);
  if (!session || !session.isDone || !session.result) {
    sendJson(res, 404, { error: "That run hasn't finished (or the server restarted)." });
    return;
  }
  // With sign-in on, only the person who started the run can open its PR, as themselves.
  const user = await currentUser(req);
  if (isAuthEnabled()) {
    if (!user) {
      sendJson(res, 401, { error: "Sign in with GitHub to open a pull request." });
      return;
    }
    if (session.meta.owner !== user.login) {
      sendJson(res, 403, { error: "Only the person who started this run can open its pull request." });
      return;
    }
  }
  if (typeof session.meta.prUrl === "string") {
    sendJson(res, 200, { url: session.meta.prUrl, alreadyOpen: true });
    return;
  }
  if (isSimulated()) {
    sendJson(res, 400, { error: "This is the scripted demo repo; there is nothing on GitHub to open a PR against." });
    return;
  }
  const { snapshot, final, status } = session.result;
  if (!snapshot || !final || status === "failed") {
    sendJson(res, 400, { error: "This run didn't produce a pull request." });
    return;
  }
  const github = user ? new GitHubClient({ token: user.token }) : githubClient();
  if (!github.hasToken()) {
    sendJson(res, 400, { error: "Set GITHUB_TOKEN in .env (with write access to this repo) and restart the dev server." });
    return;
  }

  try {
    const repo = await github.getRepo(snapshot.owner, snapshot.repo);
    // Without push access, contribute the way outside contributors do: branch on your fork, PR to the original.
    const head = repo.canPush ? undefined : await github.forkFor(snapshot.owner, snapshot.repo, repo.defaultBranch);
    const files = Object.fromEntries(
      diffBundle(snapshot, final).map((d) => [d.path, final.code[d.path] ?? final.docs[d.path]] as const)
    );
    const { title, body } = splitPr(final.pr);
    const opened = await github.createPullRequest({
      owner: snapshot.owner,
      repo: snapshot.repo,
      head,
      baseBranch: snapshot.defaultBranch,
      baseSha: snapshot.sha,
      branch: `thepolisher/issue-${snapshot.issue.number}-${id.slice(0, 8)}`,
      files,
      title,
      body: `${body}\n\n---\n_AI-assisted: opened by [ThePolisher](https://github.com/momoikura/The-Polisher) using ${providerStatus().model} after ${
        status === "clean"
          ? "all four agents signed off and the sandbox confirmed the tests"
          : status === "verified"
            ? "the sandbox confirmed the tests prove the fix, though not every reviewer signed off on style"
            : "the run stopped before every agent signed off"
      }. A person reviewed it and chose to open it._`,
    });
    session.meta.prUrl = opened.url;
    sendJson(res, 201, { url: opened.url });
  } catch (err) {
    const status = err instanceof GitHubError && err.status ? err.status : 502;
    sendJson(res, status, { error: err instanceof Error ? err.message : "GitHub request failed." });
  }
}
