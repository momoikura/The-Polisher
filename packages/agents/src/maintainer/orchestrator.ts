/**
 * Auto-Maintainer: GitHub issue → context → single-prompt baseline PR →
 * CodePolish (reviewed by SecurityPolish), DocPolish and WritePolish in parallel →
 * reconcile → before/after comparison → PR ready to open.
 *
 * Each owning lane is a LoopController, so the gate, regression rejection,
 * budgets and experience memory are the same tested machinery throughout.
 */

import { CostTracker, DEFAULT_RUN_CONFIG, LoopController, type ArtifactMode, type LoopEvent, type TestCheck } from "@thepolisher/core";
import { completeStructured, StructuredOutputError, type ChatClient } from "../llm/chat-client.js";
import { ModelServiceError, ModelTimeoutError } from "../llm/meta-client.js";
import { LaneArtifactStore, LaneRunStore } from "../loop/stores.js";
import { buildExperience, formatLessons, recallLessons, type CheckSnapshot, type Experience, type ExperienceStore } from "../memory/experience.js";
import { LANES, type LaneId } from "../lanes.js";
import {
  PrWorkspace,
  diffBundle,
  ensureFilesListed,
  isForbiddenPath,
  isTestPath,
  ownedFiles,
  parseFiles,
  wholeFileBlocked,
  type PrBundle,
  type RepoSnapshot,
} from "./bundle.js";
import { chooseCandidate } from "./candidates.js";
import { EFFORT } from "./effort.js";
import { proofFrom } from "./proof.js";
import { issueImages, withImages, withoutRefusedImage } from "./issue-images.js";
import { settleWithGrace } from "./settle.js";
import { codeStaticChecks, docChecks, prChecks, uxChecks } from "./checks.js";
import type { CandidateSummary, LaneSummary, MaintainerEvent, MaintainerEventInput, MaintainerStatus, SideMetrics } from "./events.js";
import { GitHubClient, parseIssueUrl } from "./github.js";
import { MaintainerLaneAgent, ValidationBoard, type OwnerLane, type RepairInfo, type SecurityReview } from "./lanes.js";
import { MAX_LARGE_FILE_CHARS, applyEdits, isLarge, issueSymbols, type FileEdit } from "./large-files.js";
import { BaselineSchema, MAINTAINER_PROMPT_VERSION, PlanSchema, buildBaselineMessages, buildPlanMessages, promptChars } from "./prompts.js";
import { summarizeValidation, validationChecks, validationFailureChecks, type SandboxClient, type Validation } from "./sandbox.js";

export type MaintainerSource =
  | { kind: "github"; issueUrl: string; github: GitHubClient }
  | { kind: "snapshot"; snapshot: RepoSnapshot };

export interface MaintainerOptions {
  client: ChatClient;
  onEvent: (event: MaintainerEvent) => void;
  sandbox?: SandboxClient;
  budgetUSD?: number;
  /** Wall-clock limit for the whole run; after it no new revision starts (default 20 min). */
  timeLimitMs?: number;
  maxRoundsPerLane?: number;
  /** Independent first drafts to test in parallel when a sandbox can choose between them (default 3). */
  candidates?: number;
  experience?: ExperienceStore;
  provider?: string;
}

export interface MaintainerResult {
  status: MaintainerStatus;
  message: string;
  snapshot: RepoSnapshot | null;
  baseline: PrBundle | null;
  final: PrBundle | null;
  lanes: Record<LaneId, LaneSummary>;
  totalUSD: number;
}

const DEFAULTS = { budgetUSD: 3, timeLimitMs: 20 * 60_000, maxRoundsPerLane: 6, candidates: 3 };
const LANE_MODES: Record<OwnerLane, ArtifactMode> = { code: "code", doc: "reports", write: "writing" };
const OWNER_LANES: OwnerLane[] = ["code", "doc", "write"];
/** Share of the post-baseline budget each owning lane may spend. */
const BUDGET_SHARE: Record<OwnerLane, number> = { code: 0.6, doc: 0.2, write: 0.2 };
const CLEAN_SCORE = 85;
/** After the first usable draft, how long to wait for the others (pyparsing#693: two drafts took 5 more minutes). */
const DRAFT_GRACE_MS = 60_000;
// A file of at most this many bytes has at most that many characters: the sandbox's per-file limit.
// Files over MAX_FILE_CHARS are shown as excerpts and changed through edits (large-files.ts).
const MAX_FILE_BYTES = MAX_LARGE_FILE_CHARS;
/** Prompt space for context files, counting large files at their excerpt size. */
const MAX_CONTEXT_CHARS = 150_000;
const CONTEXT_EXT = /\.(py|pyi|md|rst|txt|toml|cfg)$/i;

// ─── Context loading ──────────────────────────────────────────────────────

const IGNORED_DIRS = /(^|\/)(\.git|node_modules|\.venv|venv|site-packages|dist|build)\//;

async function loadFromGitHub(
  issueUrl: string,
  github: GitHubClient
): Promise<{ snapshot: RepoSnapshot; sizes: Record<string, number> }> {
  const ref = parseIssueUrl(issueUrl);
  const [issue, repo] = await Promise.all([github.getIssue(ref), github.getRepo(ref.owner, ref.repo)]);
  // The latest code may already contain the fix; working on it would spend money "fixing" fixed code.
  if (issue.state !== "open") {
    throw new Error(`Issue #${issue.number} is already closed, so its fix may already be in the code. Pick an open issue.`);
  }
  const { files } = await github.listFiles(ref.owner, ref.repo, repo.headSha);
  if (!files.some((f) => f.path.endsWith(".py"))) throw new Error("This repository has no Python files; only Python + pytest repos are supported.");
  const kept = files.filter((f) => !IGNORED_DIRS.test(f.path));
  return {
    snapshot: {
      owner: ref.owner,
      repo: ref.repo,
      defaultBranch: repo.defaultBranch,
      sha: repo.headSha,
      issue: { number: issue.number, title: issue.title, body: issue.body ?? "", url: issue.html_url },
      tree: kept.map((f) => f.path),
      files: {},
    },
    sizes: Object.fromEntries(kept.map((f) => [f.path, f.size])),
  };
}

function selectFiles(snapshot: RepoSnapshot, sizes: Record<string, number>, wanted: string[]): string[] {
  const tree = new Set(snapshot.tree);
  const always = ["README.md", "README.rst", "CHANGELOG.md", "CHANGES.md"].filter((p) => tree.has(p));
  const picked = [...new Set([...wanted.filter((p) => tree.has(p)), ...always])].filter(
    (p) => CONTEXT_EXT.test(p) && !isForbiddenPath(p) && (sizes[p] ?? 0) <= MAX_FILE_BYTES
  );
  const out: string[] = [];
  let total = 0;
  for (const p of picked) {
    total += promptChars(sizes[p] ?? 0);
    if (total > MAX_CONTEXT_CHARS) break;
    out.push(p);
  }
  return out;
}

/**
 * A source file over MAX_FILE_BYTES can't be loaded or changed (the sandbox won't
 * take it). When every source file the planner wants is like that, the agents would
 * work blind (and could only patch around the bug), so the run stops with a reason.
 */
export function tooLargeToFix(wanted: readonly string[], sizes: Record<string, number>, loaded: readonly string[]): string | null {
  const isSource = (p: string) => p.endsWith(".py") && !isTestPath(p);
  const wantedSource = wanted.filter((p) => isSource(p) && p in sizes);
  if (wantedSource.length === 0 || loaded.some(isSource)) return null;
  const big = wantedSource.filter((p) => sizes[p] > MAX_FILE_BYTES);
  if (big.length === 0) return null;
  const listed = big.map((p) => `${p} (${Math.round(sizes[p] / 1024)} KB)`).join(", ");
  return `ThePolisher can't fix this issue yet: the code to change is in ${listed}, and it can only edit Python files up to ${MAX_FILE_BYTES / 1000} KB. The run stopped after planning, before writing any drafts.`;
}

/** Why no first draft could be written, in words a user can act on. */
export function draftFailure(reasons: readonly unknown[]): Error {
  if (reasons.length > 0 && reasons.every((r) => r instanceof ModelTimeoutError)) {
    return new Error(
      `The model didn't finish any first draft in time (${(reasons[0] as ModelTimeoutError).message.toLowerCase()}). The issue may need a lot of code context; try again, or pick an issue in a smaller part of the codebase.`
    );
  }
  const first = reasons[0];
  return first instanceof Error ? first : new Error(String(first));
}

/** Keep only what each lane may own; anything else the baseline produced is dropped. */
const AGENT_NAMES: Record<LaneId, string> = { code: "CodePolish", security: "SecurityPolish", doc: "DocPolish", write: "WritePolish" };

/**
 * The run's outcome. "verified" is reported separately from "clean" so a fix the
 * sandbox proves is never presented as failed just because a critic wants polish,
 * and never presented as approved when a critic hasn't signed off.
 */
export function verdict(input: { approved: readonly LaneId[]; objectivelyPassing: boolean; budgetHit: boolean; timeHit?: boolean }): {
  status: MaintainerStatus;
  message: string;
} {
  const pending = LANES.filter((l) => !input.approved.includes(l)).map((l) => AGENT_NAMES[l]);
  if (pending.length === 0) {
    return { status: "clean", message: "Every check passes, the new tests prove the fix in the sandbox, and all four agents signed off." };
  }
  if (input.objectivelyPassing) {
    return {
      status: "verified",
      message: `Every check passes and the new tests prove the fix in the sandbox. ${pending.join(" and ")} still ${pending.length === 1 ? "wants" : "want"} more polish before signing off.`,
    };
  }
  return {
    status: "not_clean",
    message: input.timeHit
      ? "Time limit reached before every agent signed off. The best version of each part is kept."
      : input.budgetHit
      ? "Budget reached before every agent signed off. The best version of each part is kept."
      : "Some agents stopped improving before signing off. The best version of each part is kept.",
  };
}

/**
 * A draft's files, limited to what each lane may own: whole files except blocked
 * ones (not loaded, or large), then its edits applied on top. Edits that can't be
 * applied are dropped; a draft has no agent to tell.
 */
function sanitizeBaseline(
  raw: { code: Record<string, string>; docs: Record<string, string>; edits: FileEdit[]; pr: string },
  snap: RepoSnapshot
): PrBundle {
  const blocked = wholeFileBlocked(snap, isLarge);
  const existing = new Set(snap.tree);
  const code: Record<string, string> = ownedFiles("code", raw.code, undefined, blocked);
  const docs: Record<string, string> = ownedFiles("doc", raw.docs, existing, blocked);
  const { files: edited } = applyEdits({ ...snap.files, ...code, ...docs }, raw.edits);
  Object.assign(code, ownedFiles("code", edited));
  Object.assign(docs, ownedFiles("doc", edited, existing));
  return { code, docs, pr: raw.pr };
}

// ─── Metrics ──────────────────────────────────────────────────────────────

const tally = (checks: TestCheck[]) => ({ passed: checks.filter((c) => c.passed).length, total: checks.length });

function metricsFor(snapshot: RepoSnapshot, bundle: PrBundle, validation: Validation | null, scores: Record<LaneId, number | null>): SideMetrics {
  const v = summarizeValidation(validation);
  const diffs = diffBundle(snapshot, bundle);
  return {
    testsPassed: v?.testsPassed ?? null,
    testsTotal: v?.testsTotal ?? null,
    provesFix: v?.provesFix ?? null,
    lintIssues: v?.lintIssues ?? null,
    checks: {
      code: tally(codeStaticChecks(bundle.code, snapshot)),
      security: tally(securityChecks(validation)),
      doc: tally(docChecks(bundle.docs, bundle, snapshot)),
      write: tally(prChecks(bundle.pr, bundle, snapshot, validation)),
    },
    scores,
    files: diffs.length,
    linesAdded: diffs.reduce((n, d) => n + d.added, 0),
  };
}

/** The sandbox's security scan for a patch, or nothing if it hasn't been run. */
function securityChecks(validation: Validation | null): TestCheck[] {
  return validation ? validationChecks(validation).filter((c) => c.testType === "security_scan") : [];
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

export async function runMaintainer(source: MaintainerSource, options: MaintainerOptions): Promise<MaintainerResult> {
  const cfg = { ...DEFAULTS, ...options };
  const deadlineAt = Date.now() + cfg.timeLimitMs;
  const provider = options.provider ?? "default";
  const emit = (e: MaintainerEventInput) => {
    try {
      options.onEvent({ ...e, at: Date.now() } as MaintainerEvent);
    } catch {
      // A broken listener must not stop the run.
    }
  };

  const laneCost: Record<OwnerLane, { done: number; current: number }> = {
    code: { done: 0, current: 0 },
    doc: { done: 0, current: 0 },
    write: { done: 0, current: 0 },
  };
  let setupCost = 0;
  const totalSpent = () => setupCost + OWNER_LANES.reduce((s, l) => s + laneCost[l].done + laneCost[l].current, 0);
  const emitCost = () => emit({ type: "cost", totalUSD: totalSpent(), budgetUSD: cfg.budgetUSD });
  const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: cfg.budgetUSD });
  const chargeSetup = (r: { model: string; promptTokens: number; completionTokens: number }, role: string) => {
    setupCost += tracker.recordCall(role, r.model, r.promptTokens, r.completionTokens);
    emitCost();
  };
  /** A setup call (plan, first draft) that is charged even when its reply is unusable. */
  const setupCall: typeof completeStructured = async (client, messages, schema, opts) => {
    try {
      return await completeStructured(client, messages, schema, opts);
    } catch (err) {
      if (err instanceof StructuredOutputError && err.usage) chargeSetup(err.usage, "failed_call");
      throw err;
    }
  };

  const rounds: Record<LaneId, number> = { write: 0, security: 0, code: 0, doc: 0 };
  const lastStatus: Record<OwnerLane, string> = { code: "waiting", doc: "waiting", write: "waiting" };
  const firstScore: Record<LaneId, number | null> = { write: null, security: null, code: null, doc: null };
  const bestScore: Record<LaneId, number | null> = { write: null, security: null, code: null, doc: null };
  const roundScore: Record<LaneId, Map<number, number>> = { write: new Map(), security: new Map(), code: new Map(), doc: new Map() };

  let memory: Experience[] = [];
  if (options.experience) {
    try {
      memory = await options.experience.list();
    } catch (err) {
      emit({ type: "error", message: `Could not load experience memory: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  let snapshot: RepoSnapshot | null = null;
  let baseline: PrBundle | null = null;
  let workspace: PrWorkspace | null = null;
  const board = new ValidationBoard();
  let imagesUsed: string[] = [];
  /**
   * A call with the issue's images. If the Meta API refuses one (a bare attachment
   * link that's really a video, an image it couldn't fetch), that one is dropped and
   * the call retried; if it doesn't say which, all are. Later calls use what's left.
   */
  const withImageFallback = async <T>(imgs: readonly string[], call: (imgs: readonly string[]) => Promise<T>): Promise<T> => {
    let current = [...imgs];
    for (;;) {
      try {
        return await call(current);
      } catch (err) {
        if (current.length === 0 || !(err instanceof ModelServiceError) || (err.statusCode ?? 500) >= 500) throw err;
        current = withoutRefusedImage(current, err.message);
        imagesUsed = current;
      }
    }
  };

  try {
    // ── 1. Fetch the issue and repo ────────────────────────────────────────
    emit({ type: "phase", phase: "fetching" });
    let sizes: Record<string, number> = {};
    if (source.kind === "github") {
      const loaded = await loadFromGitHub(source.issueUrl, source.github);
      snapshot = loaded.snapshot;
      sizes = loaded.sizes;
    } else {
      snapshot = source.snapshot;
    }
    const snap0 = snapshot;
    emit({ type: "context", repo: `${snap0.owner}/${snap0.repo}`, sha: snap0.sha, issue: { number: snap0.issue.number, title: snap0.issue.title, url: snap0.issue.url }, files: Object.keys(snap0.files) });

    // ── 2. Plan which files to read ────────────────────────────────────────
    emit({ type: "phase", phase: "planning" });
    // Screenshots in the issue (tracebacks, broken output) go to the planner and the first drafts.
    const images = issueImages(snap0.issue.body);
    imagesUsed = images;
    const plan = await withImageFallback(images, (imgs) =>
      setupCall(options.client, withImages(buildPlanMessages(snap0), imgs), PlanSchema, { temperature: 0, reasoningEffort: EFFORT.plan })
    );
    chargeSetup(plan, "planner");
    if (source.kind === "github") {
      const chosen = selectFiles(snap0, sizes, plan.data.files);
      const blocked = tooLargeToFix(plan.data.files, sizes, chosen);
      if (blocked) throw new Error(blocked);
      const contents = await Promise.all(chosen.map(async (p) => [p, await source.github.getFile(snap0.owner, snap0.repo, p, snap0.sha)] as const));
      snapshot = { ...snap0, files: Object.fromEntries(contents) };
    }
    // Large files are shown around these names: the planner's picks plus the ones the issue mentions.
    snapshot = { ...snapshot, focus: [...new Set([...plan.data.symbols, ...issueSymbols(snap0.issue.title, snap0.issue.body)])] };
    const snap = snapshot;
    emit({ type: "context", repo: `${snap.owner}/${snap.repo}`, sha: snap.sha, issue: { number: snap.issue.number, title: snap.issue.title, url: snap.issue.url }, files: Object.keys(snap.files), approach: plan.data.approach, images: imagesUsed.length });

    // ── 3. First drafts. The first is the single-prompt baseline kept for the comparison;
    //       with a sandbox, several are drafted in parallel and the tests pick which to polish.
    emit({ type: "phase", phase: "baseline" });
    const count = options.sandbox ? Math.max(1, cfg.candidates) : 1;
    // Each draft is charged when it arrives, including one that finishes after the run moved on.
    const calls = Array.from({ length: count }, () =>
      withImageFallback(imagesUsed, (imgs) =>
        setupCall(options.client, withImages(buildBaselineMessages(snap), imgs), BaselineSchema, { temperature: 0.7, reasoningEffort: EFFORT.draft })
      ).then((r) => {
        chargeSetup(r, "baseline");
        return r;
      })
    );
    // Once one draft is usable, wait only a short while for the rest.
    const drafts = await settleWithGrace(calls, DRAFT_GRACE_MS);
    const written = drafts.flatMap((d) => (d.status === "fulfilled" ? [d.value] : []));
    if (written.length === 0) throw draftFailure(drafts.map((d) => (d.status === "rejected" ? d.reason : null)));
    const bundles = written.map((r) => sanitizeBaseline(r.data, snap));
    baseline = bundles[0];
    const start = bundles.length > 1 && options.sandbox ? await pickCandidate(bundles, snap, options.sandbox) : baseline;
    workspace = new PrWorkspace(snap, start);
    const ws = workspace;
    emit({ type: "baseline", diffs: diffBundle(snap, baseline), pr: baseline.pr, metrics: metricsFor(snap, baseline, null, firstScore) });

    // ── 4. Polish all lanes in parallel ────────────────────────────────────
    emit({ type: "phase", phase: "polishing" });
    const available = Math.max(cfg.budgetUSD - totalSpent(), 0);
    await Promise.all(OWNER_LANES.map((lane) => runLane(lane, available * BUDGET_SHARE[lane], snap, ws)));

    // ── 5 + 6. The code is final now: run the whole suite while docs/PR are reconciled ──
    // Reconcile only fixes objective failures (e.g. a changed file the PR doesn't mention), not a
    // critic wanting nicer wording, and never past the time limit.
    const stale = (["doc", "write"] as const).filter((l) => failing(l, snap, ws).length > 0);
    const left = cfg.budgetUSD - totalSpent();
    const reconcile = stale.length > 0 && left > 0.02 && Date.now() < deadlineAt;
    emit({ type: "phase", phase: reconcile ? "reconciling" : "verifying" });
    // Polishing ran only the related tests; the final patch and the first draft get the whole suite.
    // Reconcile can't change the code (DocPolish and WritePolish don't own code files).
    const [[finalValidation, baselineValidation]] = await Promise.all([
      fullValidations([ws.get(), baseline], snap),
      reconcile ? Promise.all(stale.map((lane) => runLane(lane, left / stale.length, snap, ws))) : Promise.resolve([]),
    ]);
    const final = ws.get();
    const proof = proofFrom(finalValidation);
    if (proof) emit({ type: "proof", proof });
    emit({
      type: "comparison",
      before: metricsFor(snap, baseline, baselineValidation, firstScore),
      after: metricsFor(snap, final, finalValidation, bestScore),
    });

    const lanes = summarize(snap, ws);
    const objectivelyPassing =
      finalValidation !== null &&
      validationChecks(finalValidation).every((c) => c.passed) &&
      uxChecks(final.code, snap).every((c) => c.passed) &&
      OWNER_LANES.every((l) => failing(l, snap, ws).length === 0);
    const v = verdict({
      approved: LANES.filter((l) => lanes[l].clean),
      objectivelyPassing,
      budgetHit: totalSpent() >= cfg.budgetUSD * 0.98,
      timeHit: Date.now() >= deadlineAt,
    });
    return finish(v.status, v.message, lanes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message });
    return finish("failed", message, null);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /**
   * The whole test suite, for the verdict and the comparison. Falls back to the targeted
   * result if the sandbox can't run it, so a hiccup never hides what was already shown.
   */
  async function fullValidations(bundles: PrBundle[], snap: RepoSnapshot): Promise<Array<Validation | null>> {
    const sandbox = options.sandbox;
    if (!sandbox) return bundles.map((b) => board.forCode(b.code));
    return Promise.all(
      bundles.map(async (b) => {
        if (Object.keys(b.code).length === 0) return board.forCode(b.code);
        try {
          return await sandbox.validate({
            repo: `${snap.owner}/${snap.repo}`,
            sha: snap.sha,
            changes: { ...b.code },
            newTests: Object.keys(b.code).filter(isTestPath),
            scope: "full",
          });
        } catch {
          return board.forCode(b.code);
        }
      })
    );
  }

  /** Test every draft in the sandbox at once and keep the one the tests rank best. */
  async function pickCandidate(bundles: PrBundle[], snap: RepoSnapshot, sandbox: SandboxClient): Promise<PrBundle> {
    const scored = await Promise.all(
      bundles.map(async (b, index): Promise<CandidateSummary> => {
        let v: Validation | null = null;
        try {
          v = await sandbox.validate({
            repo: `${snap.owner}/${snap.repo}`,
            sha: snap.sha,
            changes: { ...b.code },
            newTests: Object.keys(b.code).filter(isTestPath),
            scope: "targeted",
          });
          board.record(b.code, v);
        } catch {
          v = null;
        }
        const checks = [...codeStaticChecks(b.code, snap), ...(v ? validationChecks(v) : validationFailureChecks("sandbox unavailable"))];
        const s = summarizeValidation(v);
        return {
          index,
          provesFix: s?.provesFix ?? false,
          objectiveFailing: checks.filter((c) => !c.passed).length,
          linesAdded: diffBundle(snap, { ...b, docs: {} }).reduce((n, d) => n + d.added, 0),
          testsPassed: s?.testsPassed ?? null,
          testsTotal: s?.testsTotal ?? null,
          chosen: false,
        };
      })
    );
    const chosen = chooseCandidate(scored);
    emit({ type: "candidates", candidates: scored.map((c) => ({ ...c, chosen: c.index === chosen })) });
    return bundles[chosen];
  }

  function failing(lane: OwnerLane, snap: RepoSnapshot, ws: PrWorkspace): string[] {
    const b = ws.get();
    const checks =
      lane === "code"
        ? codeStaticChecks(b.code, snap)
        : lane === "doc"
          ? docChecks(b.docs, b, snap)
          : prChecks(b.pr, b, snap, board.forCode(b.code));
    return checks.filter((c) => !c.passed).map((c) => `${c.testType}: ${c.message}`);
  }

  function summarize(snap: RepoSnapshot, ws: PrWorkspace): Record<LaneId, LaneSummary> {
    const b = ws.get();
    const cost = (l: LaneId) => (l === "security" ? 0 : laneCost[l].done + laneCost[l].current);
    const entry = (lane: LaneId, clean: boolean, status: string, remaining: string[]): [LaneId, LaneSummary] => {
      emit({ type: "lane_state", lane, state: clean ? "clean" : status === "failed" ? "failed" : "not_clean", round: rounds[lane] });
      return [lane, { clean, status, rounds: rounds[lane], costUSD: cost(lane), remaining }];
    };
    const owner = (lane: OwnerLane) => {
      const f = failing(lane, snap, ws);
      const clean = lastStatus[lane] === "accepted" && f.length === 0;
      return entry(lane, clean, lastStatus[lane], lastStatus[lane] === "accepted" ? f : [`stopped: ${lastStatus[lane]}`, ...f]);
    };
    const secFailing = securityChecks(board.forCode(b.code)).filter((c) => !c.passed).map((c) => c.message);
    const secScore = bestScore.security;
    const secClean = board.forCode(b.code) !== null && secFailing.length === 0 && secScore !== null && secScore >= CLEAN_SCORE;
    const secRemaining = [
      ...(board.forCode(b.code) ? secFailing : ["security scan: the final code was never run in the sandbox"]),
      ...(secScore === null || secScore < CLEAN_SCORE ? [`Security review score ${secScore ?? "—"}/100`] : []),
    ];
    return Object.fromEntries([
      owner("code"),
      entry("security", secClean, secClean ? "accepted" : "not_clean", secRemaining),
      owner("doc"),
      owner("write"),
    ]) as Record<LaneId, LaneSummary>;
  }

  function finish(status: MaintainerStatus, message: string, lanes: Record<LaneId, LaneSummary> | null): MaintainerResult {
    const summary =
      lanes ??
      (Object.fromEntries(LANES.map((l) => [l, { clean: false, status: "failed", rounds: 0, costUSD: 0, remaining: [message] }])) as Record<LaneId, LaneSummary>);
    const final = workspace?.get() ?? null;
    const hasChanges = Boolean(snapshot && final && diffBundle(snapshot, final).length > 0);
    emit({ type: "phase", phase: "done" });
    emit({ type: "complete", status, message, lanes: summary, totalUSD: totalSpent(), canOpenPr: status !== "failed" && hasChanges });
    return { status, message, snapshot, baseline, final, lanes: summary, totalUSD: totalSpent() };
  }

  function publishPatch(snap: RepoSnapshot, ws: PrWorkspace) {
    const b = ws.get();
    emit({ type: "patch", diffs: diffBundle(snap, b), pr: b.pr });
  }

  function recall(lane: LaneId, failingChecks: string[]): string {
    if (!options.experience) return "";
    const brief = snapshot ? `${snapshot.issue.title}\n${snapshot.issue.body}` : undefined;
    const lessons = recallLessons(memory, { lane, failing: failingChecks, provider, brief });
    if (lessons.worked.length || lessons.avoid.length) {
      emit({ type: "lessons", lane, round: rounds[lane], worked: lessons.worked.map((l) => l.strategy), avoid: lessons.avoid.map((l) => l.strategy) });
    }
    return formatLessons(lessons);
  }

  async function runLane(lane: OwnerLane, budgetUSD: number, snap: RepoSnapshot, ws: PrWorkspace): Promise<void> {
    laneCost[lane] = { done: laneCost[lane].done + laneCost[lane].current, current: 0 };
    let pending: { info: RepairInfo; scoreAfter: number | null; after: CheckSnapshot[] | null } | null = null;

    const runStore = new LaneRunStore((run) => {
      if (run.totalCostUSD !== laneCost[lane].current) {
        laneCost[lane] = { ...laneCost[lane], current: run.totalCostUSD };
        emitCost();
      }
    });
    const artifactStore = new LaneArtifactStore((content) => {
      const patch: Partial<PrBundle> = lane === "code" ? { code: parseFiles(content) } : lane === "doc" ? { docs: parseFiles(content) } : { pr: content };
      ws.set(patch);
      publishPatch(snap, ws);
    });
    const agent = new MaintainerLaneAgent({
      lane,
      client: options.client,
      workspace: ws,
      board,
      sandbox: options.sandbox,
      onActivity: (state) => emit({ type: "lane_state", lane, state, round: rounds[lane] }),
      recall: (f) => recall(lane, f),
      onAdapt: (s) => emit({ type: "adapt", lane, round: rounds[lane], mode: s.mode, label: s.label ?? "" }),
      onRepaired: (info) => {
        pending = { info, scoreAfter: null, after: null };
      },
      onSecurityReview: (review: SecurityReview) => {
        rounds.security = rounds.code + 1;
        roundScore.security.set(rounds.security, review.score);
        if (firstScore.security === null) firstScore.security = review.score;
        emit({ type: "lane_state", lane: "security", state: "reviewing", round: rounds.security });
        emit({ type: "lane_evaluation", lane: "security", round: rounds.security, score: review.score, findings: review.findings });
        if (review.findings.length) emit({ type: "review", from: "security", to: "code", findings: review.findings.map((f) => f.description) });
      },
      onSecurityChecks: (checks) => {
        const t = tally(checks);
        emit({ type: "lane_checks", lane: "security", round: rounds.security, passed: t.passed, failed: t.total - t.passed, failing: checks.filter((c) => !c.passed).map((c) => ({ check: c.testType, message: c.message })) });
      },
    });
    const controller = new LoopController({
      evaluator: agent,
      repairer: agent,
      tester: agent,
      runStore,
      artifactStore,
      retestBestBeforeGate: true,
      onEvent: (event) => {
        forward(lane, event);
        if (pending && options.experience) {
          if (event.type === "evaluation_complete") pending = { ...pending, scoreAfter: event.evaluation.scores.overall };
          if (event.type === "tests_complete" && !pending.after) pending = { ...pending, after: event.results.checks.filter((c) => c.authority === "objective") };
          if (event.type === "gate_decision" && pending.after) {
            const experience = buildExperience({
              lane,
              model: pending.info.model,
              promptVersion: MAINTAINER_PROMPT_VERSION,
              provider,
              brief: `${snap.issue.title}\n${snap.issue.body}`,
              before: pending.info.before,
              after: pending.after,
              scoreBefore: pending.info.scoreBefore,
              scoreAfter: pending.scoreAfter,
              accepted: event.decision.accepted,
              reason: event.decision.reason,
              strategies: pending.info.strategies,
            });
            memory = [...memory, experience];
            options.experience.append(experience).catch((err: unknown) => {
              emit({ type: "error", lane, message: `Could not save experience: ${err instanceof Error ? err.message : String(err)}` });
            });
            emit({ type: "learned", lane, round: rounds[lane], accepted: experience.accepted, fixed: experience.fixed, broke: experience.broke, strategies: experience.strategies });
            pending = null;
          }
        }
      },
    });

    const run = await controller.execute({
      mode: LANE_MODES[lane],
      prompt: snap.issue.title,
      // WritePolish starts from a description that already names every changed file.
      initialContent:
        lane === "write"
          ? ensureFilesListed(ws.get().pr, diffBundle(snap, ws.get()).map((d) => d.path))
          : MaintainerLaneAgent.serialize(lane, ws.get()),
      config: {
        maxIterations: cfg.maxRoundsPerLane,
        maxCostUSD: Math.max(budgetUSD, 0.0001),
        deadlineAt,
        // Once every objective check passes: CodePolish gets one more round for its critic (the fix
        // itself); DocPolish and WritePolish stop there rather than polishing wording.
        maxPolishRounds: lane === "code" ? 1 : 0,
        // A revision that fixes more than it breaks may leave lint or wording for the next round
        // (sqlglot#8752 lost a proven fix over one unused import). Tests, the proof and security never.
        minorChecks: ["py_lint", "debug_leftovers", "ux_messages"],
        // Room for the narrowed, smallest-edit strategy (after 2 rejections) to get two tries.
        maxConsecutiveRejections: 4,
        progressEpsilon: 0.1,
        // SecurityPolish's findings land in CodePolish's evaluation; a major one earns a revision.
        reviseOnMajorFindings: lane === "code",
        earlyStopOnAcceptance: true,
        qualityThresholds: { minScore: 8.5, requireAllTestsPass: true, maxCriticalDefects: 0 },
      },
    });
    lastStatus[lane] = run.status;
    if (run.status === "failed" && run.errorMessage) emit({ type: "error", lane, message: run.errorMessage });
    emit({ type: "lane_state", lane, state: run.status === "accepted" ? "clean" : run.status === "failed" ? "failed" : "not_clean", round: rounds[lane] });
  }

  function forward(lane: OwnerLane, event: LoopEvent): void {
    switch (event.type) {
      case "evaluation_complete": {
        rounds[lane] += 1;
        // CodePolish's card shows its own critic; SecurityPolish's verdict is reported on its own card.
        const own = event.evaluation.scores.dimensions.code_review ?? event.evaluation.scores.overall;
        const score = Math.round(own * 10);
        roundScore[lane].set(rounds[lane], score);
        if (firstScore[lane] === null) firstScore[lane] = score;
        emit({
          type: "lane_evaluation",
          lane,
          round: rounds[lane],
          score,
          findings: event.evaluation.issues.filter((i) => !i.description.startsWith("SecurityPolish:")).slice(0, 4).map((i) => ({ severity: i.severity, description: i.description })),
        });
        return;
      }
      case "tests_complete":
        emit({
          type: "lane_checks",
          lane,
          round: rounds[lane],
          passed: event.results.objectivePassed,
          failed: event.results.objectiveFailed,
          failing: event.results.checks.filter((c) => !c.passed).map((c) => ({ check: c.testType, message: c.message })),
        });
        return;
      case "gate_decision":
        if (event.decision.accepted) {
          bestScore[lane] = roundScore[lane].get(rounds[lane]) ?? bestScore[lane];
          if (lane === "code") bestScore.security = roundScore.security.get(rounds.security) ?? bestScore.security;
        }
        emit({ type: "lane_decision", lane, round: rounds[lane], accepted: event.decision.accepted, reason: event.decision.reason, explanation: event.decision.explanation });
        return;
      case "repair_complete":
        emit({ type: "lane_changes", lane, round: rounds[lane], changes: event.changesMade.slice(0, 5) });
        return;
      default:
        return;
    }
  }
}

