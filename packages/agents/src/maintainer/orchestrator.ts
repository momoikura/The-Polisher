/**
 * Auto-Maintainer: GitHub issue → context → single-prompt baseline PR →
 * CodePolish (reviewed by UIPolish), DocPolish and WritePolish in parallel →
 * reconcile → before/after comparison → PR ready to open.
 *
 * Each owning lane is a LoopController, so the gate, regression rejection,
 * budgets and experience memory are the same tested machinery throughout.
 */

import { CostTracker, DEFAULT_RUN_CONFIG, LoopController, type ArtifactMode, type LoopEvent, type TestCheck } from "@polishloop/core";
import { completeStructured, StructuredOutputError, type ChatClient } from "../llm/chat-client.js";
import { LaneArtifactStore, LaneRunStore } from "../loop/stores.js";
import { buildExperience, formatLessons, recallLessons, type CheckSnapshot, type Experience, type ExperienceStore } from "../memory/experience.js";
import { LANES, type LaneId } from "../lanes.js";
import {
  PrWorkspace,
  diffBundle,
  isDocPath,
  isForbiddenPath,
  parseFiles,
  type PrBundle,
  type RepoSnapshot,
} from "./bundle.js";
import { codeStaticChecks, docChecks, prChecks, uxChecks } from "./checks.js";
import type { LaneSummary, MaintainerEvent, MaintainerEventInput, MaintainerStatus, SideMetrics } from "./events.js";
import { GitHubClient, parseIssueUrl } from "./github.js";
import { MaintainerLaneAgent, ValidationBoard, type OwnerLane, type RepairInfo, type UxReview } from "./lanes.js";
import { BaselineSchema, MAINTAINER_PROMPT_VERSION, PlanSchema, buildBaselineMessages, buildPlanMessages } from "./prompts.js";
import { summarizeValidation, type SandboxClient, type Validation } from "./sandbox.js";

export type MaintainerSource =
  | { kind: "github"; issueUrl: string; github: GitHubClient }
  | { kind: "snapshot"; snapshot: RepoSnapshot };

export interface MaintainerOptions {
  client: ChatClient;
  onEvent: (event: MaintainerEvent) => void;
  sandbox?: SandboxClient;
  budgetUSD?: number;
  maxRoundsPerLane?: number;
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

const DEFAULTS = { budgetUSD: 3, maxRoundsPerLane: 6 };
const LANE_MODES: Record<OwnerLane, ArtifactMode> = { code: "code", doc: "reports", write: "writing" };
const OWNER_LANES: OwnerLane[] = ["code", "doc", "write"];
/** Share of the post-baseline budget each owning lane may spend. */
const BUDGET_SHARE: Record<OwnerLane, number> = { code: 0.6, doc: 0.2, write: 0.2 };
const CLEAN_SCORE = 85;
const MAX_FILE_BYTES = 40_000;
const MAX_CONTEXT_BYTES = 150_000;
const CONTEXT_EXT = /\.(py|pyi|md|rst|txt|toml|cfg)$/i;

// ─── Context loading ──────────────────────────────────────────────────────

const IGNORED_DIRS = /(^|\/)(\.git|node_modules|\.venv|venv|site-packages|dist|build)\//;

async function loadFromGitHub(
  issueUrl: string,
  github: GitHubClient
): Promise<{ snapshot: RepoSnapshot; sizes: Record<string, number> }> {
  const ref = parseIssueUrl(issueUrl);
  const [issue, repo] = await Promise.all([github.getIssue(ref), github.getRepo(ref.owner, ref.repo)]);
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
    total += sizes[p] ?? 0;
    if (total > MAX_CONTEXT_BYTES) break;
    out.push(p);
  }
  return out;
}

/** Keep only what each lane may own; anything else the baseline produced is dropped. */
function sanitizeBaseline(raw: { code: Record<string, string>; docs: Record<string, string>; pr: string }): PrBundle {
  const code = Object.fromEntries(Object.entries(raw.code).filter(([p]) => /\.pyi?$/.test(p) && !isForbiddenPath(p)));
  const docs = Object.fromEntries(Object.entries(raw.docs).filter(([p]) => isDocPath(p) && !isForbiddenPath(p)));
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
      ui: tally(uxChecks(bundle.code, snapshot)),
      doc: tally(docChecks(bundle.docs, bundle, snapshot)),
      write: tally(prChecks(bundle.pr, bundle, snapshot, validation)),
    },
    scores,
    files: diffs.length,
    linesAdded: diffs.reduce((n, d) => n + d.added, 0),
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

export async function runMaintainer(source: MaintainerSource, options: MaintainerOptions): Promise<MaintainerResult> {
  const cfg = { ...DEFAULTS, ...options };
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

  const rounds: Record<LaneId, number> = { write: 0, ui: 0, code: 0, doc: 0 };
  const lastStatus: Record<OwnerLane, string> = { code: "waiting", doc: "waiting", write: "waiting" };
  const firstScore: Record<LaneId, number | null> = { write: null, ui: null, code: null, doc: null };
  const bestScore: Record<LaneId, number | null> = { write: null, ui: null, code: null, doc: null };
  const roundScore: Record<LaneId, Map<number, number>> = { write: new Map(), ui: new Map(), code: new Map(), doc: new Map() };

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
    const plan = await setupCall(options.client, buildPlanMessages(snap0), PlanSchema, { temperature: 0 });
    chargeSetup(plan, "planner");
    if (source.kind === "github") {
      const chosen = selectFiles(snap0, sizes, plan.data.files);
      const contents = await Promise.all(chosen.map(async (p) => [p, await source.github.getFile(snap0.owner, snap0.repo, p, snap0.sha)] as const));
      snapshot = { ...snap0, files: Object.fromEntries(contents) };
    }
    const snap = snapshot;
    emit({ type: "context", repo: `${snap.owner}/${snap.repo}`, sha: snap.sha, issue: { number: snap.issue.number, title: snap.issue.title, url: snap.issue.url }, files: Object.keys(snap.files), approach: plan.data.approach });

    // ── 3. Single-prompt baseline (kept for the before/after comparison) ──
    emit({ type: "phase", phase: "baseline" });
    const raw = await setupCall(options.client, buildBaselineMessages(snap), BaselineSchema, { temperature: 0.7 });
    chargeSetup(raw, "baseline");
    baseline = sanitizeBaseline(raw.data);
    workspace = new PrWorkspace(snap, baseline);
    const ws = workspace;
    emit({ type: "baseline", diffs: diffBundle(snap, baseline), pr: baseline.pr, metrics: metricsFor(snap, baseline, null, firstScore) });

    // ── 4. Polish all lanes in parallel ────────────────────────────────────
    emit({ type: "phase", phase: "polishing" });
    const available = Math.max(cfg.budgetUSD - totalSpent(), 0);
    await Promise.all(OWNER_LANES.map((lane) => runLane(lane, available * BUDGET_SHARE[lane], snap, ws)));

    // ── 5. Reconcile docs/PR against the final code ────────────────────────
    const stale = (["doc", "write"] as const).filter((l) => lastStatus[l] !== "accepted" || failing(l, snap, ws).length > 0);
    const left = cfg.budgetUSD - totalSpent();
    if (stale.length && left > 0.02) {
      emit({ type: "phase", phase: "reconciling" });
      await Promise.all(stale.map((lane) => runLane(lane, left / stale.length, snap, ws)));
    }

    // ── 6. Verdict + before/after ──────────────────────────────────────────
    const final = ws.get();
    const finalValidation = board.forCode(final.code);
    const baselineValidation = board.forCode(baseline.code);
    emit({
      type: "comparison",
      before: metricsFor(snap, baseline, baselineValidation, firstScore),
      after: metricsFor(snap, final, finalValidation, bestScore),
    });

    const lanes = summarize(snap, ws);
    const allClean = LANES.every((l) => lanes[l].clean);
    const budgetHit = totalSpent() >= cfg.budgetUSD * 0.98;
    const message = allClean
      ? "Every check passes, the new tests prove the fix in the sandbox, and all four agents signed off."
      : budgetHit
        ? "Budget reached before every agent signed off. The best version of each part is kept."
        : "Some agents stopped improving before signing off. The best version of each part is kept.";
    return finish(allClean ? "clean" : "not_clean", message, lanes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message });
    return finish("failed", message, null);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

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
    const cost = (l: LaneId) => (l === "ui" ? 0 : laneCost[l].done + laneCost[l].current);
    const entry = (lane: LaneId, clean: boolean, status: string, remaining: string[]): [LaneId, LaneSummary] => {
      emit({ type: "lane_state", lane, state: clean ? "clean" : status === "failed" ? "failed" : "not_clean", round: rounds[lane] });
      return [lane, { clean, status, rounds: rounds[lane], costUSD: cost(lane), remaining }];
    };
    const owner = (lane: OwnerLane) => {
      const f = failing(lane, snap, ws);
      const clean = lastStatus[lane] === "accepted" && f.length === 0;
      return entry(lane, clean, lastStatus[lane], lastStatus[lane] === "accepted" ? f : [`stopped: ${lastStatus[lane]}`, ...f]);
    };
    const uxFailing = uxChecks(b.code, snap).filter((c) => !c.passed).map((c) => c.message);
    const uxScore = bestScore.ui;
    const uxClean = uxFailing.length === 0 && uxScore !== null && uxScore >= CLEAN_SCORE;
    const uxRemaining = [...uxFailing, ...(uxScore === null || uxScore < CLEAN_SCORE ? [`UX review score ${uxScore ?? "—"}/100`] : [])];
    return Object.fromEntries([
      owner("code"),
      entry("ui", uxClean, uxClean ? "accepted" : "not_clean", uxRemaining),
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
    const lessons = recallLessons(memory, { lane, failing: failingChecks, provider });
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
      onRepaired: (info) => {
        pending = { info, scoreAfter: null, after: null };
      },
      onUxReview: (review: UxReview) => {
        rounds.ui = rounds.code + 1;
        roundScore.ui.set(rounds.ui, review.score);
        if (firstScore.ui === null) firstScore.ui = review.score;
        emit({ type: "lane_state", lane: "ui", state: "reviewing", round: rounds.ui });
        emit({ type: "lane_evaluation", lane: "ui", round: rounds.ui, score: review.score, findings: review.findings });
        if (review.findings.length) emit({ type: "review", from: "ui", to: "code", findings: review.findings.map((f) => f.description) });
      },
      onUxChecks: (checks) => {
        const t = tally(checks);
        emit({ type: "lane_checks", lane: "ui", round: rounds.ui, passed: t.passed, failed: t.total - t.passed, failing: checks.filter((c) => !c.passed).map((c) => ({ check: c.testType, message: c.message })) });
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
      initialContent: MaintainerLaneAgent.serialize(lane, ws.get()),
      config: {
        maxIterations: cfg.maxRoundsPerLane,
        maxCostUSD: Math.max(budgetUSD, 0.0001),
        maxConsecutiveRejections: 3,
        progressEpsilon: 0.1,
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
        // CodePolish's card shows its own critic; UIPolish's verdict is reported on its own card.
        const own = event.evaluation.scores.dimensions.code_review ?? event.evaluation.scores.overall;
        const score = Math.round(own * 10);
        roundScore[lane].set(rounds[lane], score);
        if (firstScore[lane] === null) firstScore[lane] = score;
        emit({
          type: "lane_evaluation",
          lane,
          round: rounds[lane],
          score,
          findings: event.evaluation.issues.filter((i) => !i.description.startsWith("UIPolish:")).slice(0, 4).map((i) => ({ severity: i.severity, description: i.description })),
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
          failing: event.results.checks.filter((c) => !c.passed && c.testType !== "ux_messages").map((c) => ({ check: c.testType, message: c.message })),
        });
        return;
      case "gate_decision":
        if (event.decision.accepted) {
          bestScore[lane] = roundScore[lane].get(rounds[lane]) ?? bestScore[lane];
          if (lane === "code") bestScore.ui = roundScore.ui.get(rounds.ui) ?? bestScore.ui;
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

