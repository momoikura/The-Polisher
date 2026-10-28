/**
 * Auto-Maintainer endpoints:
 *   GET  /api/maintainer/config          → model, sandbox, GitHub token status
 *   POST /api/maintainer                 → start a run { issueUrl, budgetUSD? }
 *   GET  /api/maintainer/:id/events      → Server-Sent Events
 *   POST /api/maintainer/:id/pr          → open the PR on GitHub (explicit user action only)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  DEMO_ISSUE_URL,
  DEMO_SNAPSHOT,
  GitHubError,
  diffBundle,
  parseIssueUrl,
  runMaintainer,
  splitPr,
  type MaintainerEvent,
  type MaintainerResult,
} from "@polishloop/agents";
import { experienceStore } from "./experience-api.js";
import {
  activeProvider,
  githubClient,
  isSimulated,
  modelClientOrNull,
  providerStatus,
  readJsonBody,
  sandboxClientOrNull,
  sendJson,
} from "./http.js";
import { SessionRegistry } from "./sessions.js";

const StartSchema = z.object({
  issueUrl: z.string().trim().min(1, "Paste a GitHub issue link.").max(500),
  budgetUSD: z.number().min(0.1).max(20).default(3),
});

const MAX_BODY_BYTES = 8 * 1024;
const registry = new SessionRegistry<MaintainerEvent, MaintainerResult>();

export async function handleMaintainerRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = (req.url ?? "").split("?")[0];

  if (req.method === "GET" && url === "/api/maintainer/config") {
    const status = providerStatus();
    sendJson(res, 200, {
      provider: status.provider,
      isSimulated: status.provider === "simulated",
      isConfigured: status.isConfigured,
      model: status.model,
      setupHint: status.setupHint,
      isSandboxConfigured: sandboxClientOrNull() !== null,
      hasGitHubToken: Boolean(process.env.GITHUB_TOKEN?.trim()),
      demoIssueUrl: isSimulated() ? DEMO_ISSUE_URL : null,
      activeRunId: registry.active()?.id ?? null,
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
    if (registry.active()) {
      sendJson(res, 409, { error: "A run is already in progress. Wait for it to finish." });
      return true;
    }
    const client = modelClientOrNull();
    if (!client) {
      sendJson(res, 503, { error: `${providerStatus().setupHint} To try the scripted demo, run \`pnpm --filter @polishloop/web dev:sim\`.` });
      return true;
    }

    const source = isSimulated()
      ? ({ kind: "snapshot", snapshot: DEMO_SNAPSHOT } as const)
      : ({ kind: "github", issueUrl: parsed.data.issueUrl, github: githubClient() } as const);
    const session = registry.start(
      (publish) =>
        runMaintainer(source, {
          client,
          sandbox: sandboxClientOrNull() ?? undefined,
          budgetUSD: parsed.data.budgetUSD,
          experience: experienceStore(),
          provider: activeProvider(),
          onEvent: publish,
        }),
      (message) => ({ type: "error", message, at: Date.now() })
    );
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
    await openPullRequest(res, pr[1]);
    return true;
  }

  return false;
}

async function openPullRequest(res: ServerResponse, id: string): Promise<void> {
  const session = registry.get(id);
  if (!session || !session.isDone || !session.result) {
    sendJson(res, 404, { error: "That run hasn't finished (or the server restarted)." });
    return;
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
  const github = githubClient();
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
      branch: `polishloop/issue-${snapshot.issue.number}-${id.slice(0, 8)}`,
      files,
      title,
      body: `${body}\n\n---\n_AI-assisted: opened by [The Polisher](https://github.com/momoikura/The-Polisher) using ${providerStatus().model} after ${status === "clean" ? "all four agents signed off and the sandbox confirmed the tests" : "the run stopped before every agent signed off"}. A person reviewed it and chose to open it._`,
    });
    session.meta.prUrl = opened.url;
    sendJson(res, 201, { url: opened.url });
  } catch (err) {
    const status = err instanceof GitHubError && err.status ? err.status : 502;
    sendJson(res, status, { error: err instanceof Error ? err.message : "GitHub request failed." });
  }
}
