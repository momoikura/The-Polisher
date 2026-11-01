/**
 * Checks someone's pull request, for the maintainer deciding whether to read it. The PR's code runs
 * in the sandbox on the commit it branched from, and Muse Wonder writes its own tests against it.
 * Only reads GitHub: nothing is posted, and the comment it writes is for a person to paste.
 */

import { CostTracker, DEFAULT_RUN_CONFIG } from "@thepolisher/core";
import type { ChatClient } from "../llm/chat-client.js";
import { LANES } from "../lanes.js";
import { diffBundle, isTestPath, type RepoSnapshot } from "./bundle.js";
import { runChallenge, type Challenge } from "./challenge.js";
import { clientUntil, sandboxUntil } from "./deadline.js";
import type { LaneSummary, MaintainerEvent, MaintainerStatus } from "./events.js";
import type { GitHubClient, IssueRef } from "./github.js";
import { proofFrom, type Proof } from "./proof.js";
import { newFailing, type SandboxClient, type Validation } from "./sandbox.js";

const MAX_FILES = 40;
const TIME_LIMIT_MS = 20 * 60_000;
/** Roughly the most one challenge costs. */
const CHALLENGE_MIN_USD = 0.15;
const NAME = /^[A-Za-z0-9_.-]+$/;

export type PrVerdict = "proven" | "new_failures" | "no_tests" | "tests_pass_without_it" | "tests_fail" | "only_new_code" | "not_run";

export interface PrCheck {
  number: number;
  url: string;
  verdict: PrVerdict;
  headline: string;
  detail: string;
  /** Changed files the sandbox couldn't apply: not Python, or removed. */
  notApplied: string[];
  comment: string;
}

/** Accepts https://github.com/{owner}/{repo}/pull/{n}, also its /files and /commits tabs. */
export function parsePullUrl(input: string): IssueRef {
  const m = input.trim().match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:\/(?:files|commits|checks))?\/?(?:[?#].*)?$/);
  const isName = (s: string) => NAME.test(s) && !/^\.+$/.test(s);
  if (!m || !isName(m[1]) || !isName(m[2])) throw new Error("Use a GitHub pull request link like https://github.com/owner/repo/pull/123.");
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

export const isPullUrl = (input: string): boolean => {
  try {
    parsePullUrl(input);
    return true;
  } catch {
    return false;
  }
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What the sandbox's run says about the PR, in the order a maintainer cares about. */
export function judgePr(v: Validation, proof: Proof | null): Pick<PrCheck, "verdict" | "headline" | "detail"> {
  const counts = `${v.tests.passed} of ${v.tests.total} tests pass`;
  const preexisting = v.tests.preexistingCount ?? 0;
  const already = preexisting > 0 ? `; ${preexisting} already failed on the original code` : "";
  const broken = newFailing(v);
  if (!v.tests.ran || (v.tests.total > 1 && v.tests.passed === 0)) {
    return { verdict: "not_run", headline: "The tests couldn't run here", detail: "The repo's tests didn't run in the sandbox, so this check says nothing about the PR either way." };
  }
  if (!proof) {
    if (broken > 0) return { verdict: "new_failures", headline: `This PR breaks ${plural(broken, "test")}`, detail: `${counts}${already}. It also adds no tests.` };
    return { verdict: "no_tests", headline: "Nothing breaks, but no test shows it works", detail: `${counts}${already}. The PR adds or changes no tests.` };
  }
  if (!proof.passedAfter) return { verdict: "tests_fail", headline: "Its own tests fail", detail: `The tests this PR adds or changes fail with its code. ${counts}${already}.` };
  if (broken > 0) return { verdict: "new_failures", headline: `This PR breaks ${plural(broken, "test")}`, detail: `Its own tests pass, but ${plural(broken, "other test")} newly ${broken === 1 ? "fails" : "fail"}. ${counts}${already}.` };
  if (!proof.failedOnBase) return { verdict: "tests_pass_without_it", headline: "Its tests pass without it too", detail: `The tests it adds or changes also pass on the original code, so they don't show what this PR changes. ${counts}${already}.` };
  if (!proof.proven) return { verdict: "only_new_code", headline: "Its tests only fail for missing code", detail: `Its tests fail on the original code only because they use code this PR adds. That's normal for a new feature, but doesn't show a bug being fixed. ${counts}${already}.` };
  return { verdict: "proven", headline: "Its tests show it works", detail: `Its tests fail on the original code and pass with this PR, and nothing else newly fails. ${counts}${already}.` };
}

const code = (text: string) => `\`${text.replaceAll("`", "'")}\``;

/** Ready to paste into the PR. A person decides whether to post it. */
export function prCheckComment(check: Pick<PrCheck, "headline" | "detail" | "notApplied">, challenge: Challenge | null, runUrl: string | null): string {
  const lines = [
    `**${check.headline}.** ${check.detail}`,
    ...(challenge
      ? [
          `Independent edge-case tests by ${challenge.model}: ${challenge.passed} of ${challenge.total} pass.`,
          ...challenge.failures.map((f) => `${code(f.test)} doesn't pass${f.failsOnOriginal === true ? ", and also fails on the original code" : f.failsOnOriginal === false ? ", but passes on the original code" : ""}.`),
        ]
      : []),
    ...(check.notApplied.length > 0 ? [`Not applied in the sandbox: ${check.notApplied.map(code).join(", ")}.`] : []),
  ];
  return `${lines.map((l) => `- ${l}`).join("\n")}\n\n<sub>Tested in a sandbox by ThePolisher${runUrl ? `: [full run](${runUrl})` : ""}.</sub>`;
}

export async function runPrCheck(
  url: string,
  options: {
    github: GitHubClient;
    sandbox: SandboxClient;
    client: ChatClient;
    challengeModel?: string;
    budgetUSD: number;
    /** The run's public page, if the server knows its address. */
    runUrl?: () => string | null;
    timeLimitMs?: number;
    onEvent: (event: MaintainerEvent) => void;
  }
) {
  const ref = parsePullUrl(url);
  const { github, budgetUSD, challengeModel } = options;
  const emit = (event: DistributiveOmit<MaintainerEvent, "at">) => options.onEvent({ ...event, at: Date.now() } as MaintainerEvent);
  const stop = AbortSignal.timeout(options.timeLimitMs ?? TIME_LIMIT_MS);
  const client = clientUntil(options.client, stop);
  const sandbox = sandboxUntil(options.sandbox, stop);
  const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: budgetUSD });
  let spent = 0;

  emit({ type: "phase", phase: "fetching" });
  const pr = await github.getPullRequest(ref);
  const pythonFiles = pr.files.filter((f) => f.status !== "removed" && f.path.endsWith(".py"));
  const notApplied = pr.files.filter((f) => !pythonFiles.includes(f)).map((f) => f.path);
  if (pythonFiles.length === 0) throw new Error("This pull request changes no Python files, so there's nothing to run.");
  if (pythonFiles.length > MAX_FILES) throw new Error(`This pull request changes ${pythonFiles.length} Python files; the check handles up to ${MAX_FILES}.`);

  const changes = Object.fromEntries(await Promise.all(pythonFiles.map(async (f) => [f.path, await github.getFile(pr.headOwner, pr.headRepo, f.path, pr.headSha)] as const)));
  const originals = await Promise.all(
    pythonFiles.map(async (f) => [f.path, await github.getFile(ref.owner, ref.repo, f.path, pr.baseSha).catch(() => null)] as const)
  );
  const snapshot: RepoSnapshot = {
    owner: ref.owner,
    repo: ref.repo,
    defaultBranch: pr.baseBranch,
    sha: pr.baseSha,
    issue: { number: ref.number, title: `PR check: ${pr.title}`, body: pr.body ?? "", url },
    tree: originals.filter(([, content]) => content !== null).map(([path]) => path),
    files: Object.fromEntries(originals.filter((o): o is readonly [string, string] => o[1] !== null)),
  };
  const bundle = { code: changes, docs: {}, pr: "" };
  emit({ type: "context", repo: `${ref.owner}/${ref.repo}`, sha: pr.baseSha, issue: { number: ref.number, title: pr.title, url }, files: pythonFiles.map((f) => f.path), isCheck: true });
  emit({ type: "patch", diffs: diffBundle(snapshot, bundle), pr: "" });

  emit({ type: "phase", phase: "verifying" });
  const newTests = pythonFiles.map((f) => f.path).filter((p) => isTestPath(p) && !p.endsWith("conftest.py"));
  const validation = await sandbox.validate({ repo: `${ref.owner}/${ref.repo}`, sha: pr.baseSha, changes, newTests, scope: "full" });
  const proof = proofFrom(validation);
  if (proof) emit({ type: "proof", proof });
  const judged = judgePr(validation, proof);

  let challenge: Challenge | null = null;
  if (challengeModel && judged.verdict !== "not_run" && budgetUSD >= CHALLENGE_MIN_USD) {
    try {
      challenge = await runChallenge({
        client,
        sandbox,
        snapshot,
        bundle,
        model: challengeModel,
        charge: (u) => {
          spent += tracker.recordCall("challenge", u.model, u.promptTokens, u.completionTokens);
          emit({ type: "cost", totalUSD: spent, budgetUSD });
        },
      });
      if (challenge) emit({ type: "challenge", challenge });
    } catch (err) {
      console.warn(`Skipped the challenge: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const check: PrCheck = { number: ref.number, url, ...judged, notApplied, comment: prCheckComment({ ...judged, notApplied }, challenge, options.runUrl?.() ?? null) };
  emit({ type: "pr_check", check });

  const status: MaintainerStatus = judged.verdict === "proven" ? "verified" : "not_clean";
  const lanes = Object.fromEntries(LANES.map((l) => [l, { clean: false, status: "skipped", rounds: 0, costUSD: 0, remaining: [] } satisfies LaneSummary])) as unknown as Record<(typeof LANES)[number], LaneSummary>;
  emit({ type: "phase", phase: "done" });
  emit({ type: "complete", status, message: judged.headline, lanes, totalUSD: spent, canOpenPr: false });
  return { status, message: judged.headline, snapshot, baseline: null, final: null, lanes, totalUSD: spent, proof, challenge, check };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
