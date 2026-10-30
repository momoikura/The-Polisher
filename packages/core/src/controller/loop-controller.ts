/**
 * Loop Controller — the deterministic orchestrator for a ThePolisher run.
 *
 * This is NOT an LLM agent. It is pure control flow that dispatches
 * work to the agents in the correct order and enforces all limits.
 *
 * Lifecycle:
 *   1. Create run → status "running"
 *   2. Baseline = user-supplied draft, or Generator output
 *   3. Loop: Evaluator → Tester → Best-Version Gate → Repairer (from best)
 *   4. Terminate when: quality target met, iteration/cost limit, stalled, or error
 *   5. Return the best-ever version (never a rejected candidate)
 */

import type { Run, RunStatus, RunConfig, CreateRunInput, ArtifactMode } from "../types/run.js";
import type { ArtifactVersion, ContentType } from "../types/artifact.js";
import type { EvaluatorOutput } from "../types/evaluation.js";
import type { AggregatedTestResults, TestCheck, TestType } from "../types/test.js";
import { aggregateTestResults } from "../types/test.js";
import { CostTracker } from "./cost-tracker.js";
import { IterationLimiter } from "./iteration-limiter.js";
import { evaluateCandidate, type GateDecision } from "./best-version-gate.js";

// ─── Agent Interfaces ────────────────────────────────────────────────────────

export interface GeneratorAgent {
  generate(run: Run): Promise<GenerateResult>;
}

export interface EvaluatorAgent {
  evaluate(run: Run, artifact: ArtifactVersion, content: string): Promise<EvaluateResult>;
}

/** What an earlier repair tried and what the gate decided, so the next repair can adapt. */
export interface RepairAttempt {
  round: number;
  accepted: boolean;
  reason: GateDecision["reason"];
  explanation: string;
  /** Checks the attempt broke (empty when it was kept). */
  regressions: TestType[];
  changesMade: string[];
}

export interface RepairerAgent {
  repair(
    run: Run,
    artifact: ArtifactVersion,
    content: string,
    evaluation: EvaluatorOutput,
    testResults: AggregatedTestResults,
    /** Earlier repairs in this run, oldest first. */
    history?: readonly RepairAttempt[]
  ): Promise<RepairResult>;
}

export interface TesterAgent {
  test(run: Run, artifact: ArtifactVersion, content: string): Promise<TestResult>;
}

export interface GenerateResult {
  content: string;
  contentType: ContentType;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface EvaluateResult {
  output: EvaluatorOutput;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface RepairResult {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** What the repairer says it changed. Recorded for audit; never trusted for acceptance. */
  changesMade?: string[];
}

export interface TestResult {
  checks: TestCheck[];
}

// ─── Persistence Interface ───────────────────────────────────────────────────

export interface RunStore {
  createRun(input: CreateRunInput): Run;
  updateRun(id: string, updates: Partial<Run>): Run;
  getRun(id: string): Run | null;
}

export interface ArtifactStore {
  saveVersion(
    runId: string,
    versionNumber: number,
    content: string,
    contentType: string,
    source: string
  ): ArtifactVersion;
  getContent(artifact: ArtifactVersion): string;
  markAsBest(runId: string, versionId: string): void;
}

// ─── Loop Events ─────────────────────────────────────────────────────────────

export type LoopEvent =
  | { type: "run_started"; run: Run }
  | { type: "generation_complete"; version: ArtifactVersion }
  | { type: "evaluation_complete"; evaluation: EvaluatorOutput; versionId: string }
  | { type: "tests_complete"; results: AggregatedTestResults }
  | { type: "gate_decision"; decision: GateDecision; versionId: string }
  | { type: "repair_started"; iteration: number }
  | { type: "repair_complete"; version: ArtifactVersion; changesMade: string[] }
  | { type: "cost_warning"; totalCost: number; budget: number }
  | { type: "run_complete"; run: Run; bestVersion: ArtifactVersion | null; message: string }
  | { type: "run_error"; error: string };

export type EventHandler = (event: LoopEvent) => void;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_CONTENT_TYPES: Record<ArtifactMode, ContentType> = {
  writing: "text/markdown",
  ui: "text/html",
  code: "application/javascript",
  reports: "text/markdown",
  presentation: "text/markdown",
};

/** The best version found so far, with the evidence that earned it the slot. */
interface BestState {
  version: ArtifactVersion;
  tests: AggregatedTestResults;
  evaluation: EvaluatorOutput;
}

export class MalformedEvaluationError extends Error {
  constructor(detail: string) {
    super(`Evaluator returned a malformed evaluation: ${detail}`);
    this.name = "MalformedEvaluationError";
  }
}

/** Missing or out-of-range scores are failures, never passes. */
export function assertValidEvaluation(output: EvaluatorOutput): void {
  const overall = output?.scores?.overall;
  if (typeof overall !== "number" || !Number.isFinite(overall) || overall < 0 || overall > 10) {
    throw new MalformedEvaluationError(`overall score must be a number in [0, 10], got ${String(overall)}`);
  }
  if (!Array.isArray(output.issues)) {
    throw new MalformedEvaluationError("issues must be an array");
  }
}

/** Full quality target: hard gates first, then the score threshold. */
export function meetsQualityTarget(best: BestState, config: RunConfig): boolean {
  const { qualityThresholds } = config;
  if (qualityThresholds.requireAllTestsPass && !best.tests.allObjectivesPassed) return false;
  const criticalCount = best.evaluation.issues.filter((i) => i.severity === "critical").length;
  if (criticalCount > qualityThresholds.maxCriticalDefects) return false;
  return best.evaluation.scores.overall >= qualityThresholds.minScore;
}

// ─── Controller ──────────────────────────────────────────────────────────────

export interface ControllerConfig {
  /** Optional when every run supplies initialContent. */
  generator?: GeneratorAgent;
  evaluator: EvaluatorAgent;
  repairer: RepairerAgent;
  tester: TesterAgent;
  runStore: RunStore;
  artifactStore: ArtifactStore;
  onEvent?: EventHandler;
  /**
   * Re-run the tester on the best version before every gate decision. Needed
   * when tests depend on things outside the artifact (e.g. other files that
   * change concurrently), so both sides are judged against the same world.
   */
  retestBestBeforeGate?: boolean;
}

interface RunContext {
  run: Run;
  config: RunConfig;
  cost: CostTracker;
  limiter: IterationLimiter;
  /** Every repair so far and the gate's verdict on it. */
  attempts: RepairAttempt[];
  /** changesMade of the repair awaiting its verdict. */
  pendingChanges: string[] | null;
  /** Whether the one extra revision for a major finding has been spent. */
  revisedForMajor: boolean;
  /** Revisions started while every objective check already passed. */
  polishRounds: number;
}

const majorCount = (best: BestState) => best.evaluation.issues.filter((i) => i.severity === "major").length;

export class LoopController {
  private readonly deps: ControllerConfig;
  private readonly onEvent: EventHandler;

  constructor(config: ControllerConfig) {
    this.deps = config;
    this.onEvent = config.onEvent ?? (() => {});
  }

  async execute(input: CreateRunInput): Promise<Run> {
    const run = this.deps.runStore.createRun(input);
    const ctx: RunContext = {
      run,
      config: run.config,
      cost: new CostTracker(run.config),
      limiter: new IterationLimiter(run.config),
      attempts: [],
      pendingChanges: null,
      revisedForMajor: false,
      polishRounds: 0,
    };

    this.deps.runStore.updateRun(run.id, { status: "running" });
    this.emit({ type: "run_started", run });

    let best: BestState | null = null;

    try {
      let current = await this.createBaseline(ctx, input);
      if (!current) {
        return this.terminate(ctx,"cost_limited", "Budget exhausted before generation.", null);
      }

      while (true) {
        const stop = this.checkLimits(ctx, "evaluation");
        if (stop) return this.terminate(ctx,stop.status, stop.message, best?.version ?? null);

        const outcome = await this.assess(ctx, current, best);
        best = outcome.best;

        // Checked even after a rejection: with retestBestBeforeGate, the best version can start
        // meeting the target because the world around it changed.
        if (ctx.config.earlyStopOnAcceptance && meetsQualityTarget(best, ctx.config)) {
          // A reviewer's major finding earns one revision; if that doesn't help, the approved version stands.
          const shouldReviseOnce = ctx.config.reviseOnMajorFindings && !ctx.revisedForMajor && majorCount(best) > 0;
          if (!shouldReviseOnce) return this.terminate(ctx, "accepted", "Quality target met.", best.version);
          ctx.revisedForMajor = true;
        }

        this.persistProgress(ctx, best);

        const stopBeforeRepair = this.checkLimits(ctx, "repair");
        if (stopBeforeRepair) {
          return this.terminate(ctx,stopBeforeRepair.status, stopBeforeRepair.message, best.version);
        }

        // Once every objective check passes, only the critic wants more: cap those rounds.
        if (ctx.config.maxPolishRounds !== undefined && best.tests.allObjectivesPassed) {
          if (ctx.polishRounds >= ctx.config.maxPolishRounds) {
            return this.terminate(ctx, "iteration_limited", "Every objective check passes; the polish rounds are used up.", best.version);
          }
          ctx.polishRounds++;
        }

        current = await this.repairFromBest(ctx, best);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const usage = usageOf(error);
      if (usage) ctx.cost.recordCall("failed_call", usage.model, usage.promptTokens, usage.completionTokens);
      this.emit({ type: "run_error", error: errorMessage });
      return this.terminate(ctx,"failed", errorMessage, best?.version ?? null);
    }
  }

  private async createBaseline(ctx: RunContext, input: CreateRunInput): Promise<ArtifactVersion | null> {
    const { run, cost } = ctx;
    if (input.initialContent !== undefined && input.initialContent.trim().length > 0) {
      const version = this.deps.artifactStore.saveVersion(
        run.id,
        0,
        input.initialContent,
        DEFAULT_CONTENT_TYPES[run.mode],
        "user_supplied"
      );
      this.emit({ type: "generation_complete", version });
      return version;
    }

    if (!this.deps.generator) {
      throw new Error("No initial content was supplied and no generator agent is configured.");
    }
    if (!cost.canAffordCall()) return null;

    const gen = await this.deps.generator.generate(run);
    cost.recordCall("generator", gen.model, gen.promptTokens, gen.completionTokens);
    const version = this.deps.artifactStore.saveVersion(run.id, 0, gen.content, gen.contentType, "generated");
    this.emit({ type: "generation_complete", version });
    return version;
  }

  /** Evaluate + test a candidate, then let the gate decide whether it becomes the best. */
  private async assess(
    ctx: RunContext,
    candidate: ArtifactVersion,
    best: BestState | null
  ): Promise<{ best: BestState; accepted: boolean }> {
    const { run, cost, limiter, config } = ctx;
    const content = this.deps.artifactStore.getContent(candidate);

    const evalResult = await this.deps.evaluator.evaluate(run, candidate, content);
    cost.recordCall("evaluator", evalResult.model, evalResult.promptTokens, evalResult.completionTokens);
    assertValidEvaluation(evalResult.output);
    this.emit({ type: "evaluation_complete", evaluation: evalResult.output, versionId: candidate.id });

    const testResult = await this.deps.tester.test(run, candidate, content);
    const tests = aggregateTestResults(candidate.id, testResult.checks);
    this.emit({ type: "tests_complete", results: tests });

    if (best && this.deps.retestBestBeforeGate) {
      const bestContent = this.deps.artifactStore.getContent(best.version);
      const fresh = await this.deps.tester.test(run, best.version, bestContent);
      best = { ...best, tests: aggregateTestResults(best.version.id, fresh.checks) };
    }

    const decision = evaluateCandidate(tests, best?.tests ?? null, {
      candidate: evalResult.output.scores.overall,
      best: best?.evaluation.scores.overall ?? null,
      epsilon: config.progressEpsilon,
    });
    this.emit({ type: "gate_decision", decision, versionId: candidate.id });
    limiter.recordIteration();
    if (ctx.pendingChanges) {
      ctx.attempts.push({
        round: limiter.getCurrentIteration(),
        accepted: decision.accepted,
        reason: decision.reason,
        explanation: decision.explanation,
        regressions: decision.regressions,
        changesMade: ctx.pendingChanges,
      });
      ctx.pendingChanges = null;
    }

    if (decision.accepted) {
      this.deps.artifactStore.markAsBest(run.id, candidate.id);
      limiter.recordAcceptance();
      return { best: { version: candidate, tests, evaluation: evalResult.output }, accepted: true };
    }

    limiter.recordRejection();
    // The first assessment is always accepted, so best is non-null on rejection.
    return { best: best as BestState, accepted: false };
  }

  /** Repairs always start from the best version and its own findings, never a rejected candidate. */
  private async repairFromBest(ctx: RunContext, best: BestState): Promise<ArtifactVersion> {
    const { run, cost, limiter } = ctx;
    this.emit({ type: "repair_started", iteration: limiter.getCurrentIteration() });

    const content = this.deps.artifactStore.getContent(best.version);
    const repair = await this.deps.repairer.repair(run, best.version, content, best.evaluation, best.tests, [...ctx.attempts]);
    cost.recordCall("repairer", repair.model, repair.promptTokens, repair.completionTokens);
    ctx.pendingChanges = repair.changesMade ?? [];

    const version = this.deps.artifactStore.saveVersion(
      run.id,
      limiter.getCurrentIteration(),
      repair.content,
      best.version.contentType,
      "repaired"
    );
    this.emit({ type: "repair_complete", version, changesMade: repair.changesMade ?? [] });
    return version;
  }

  private checkLimits(ctx: RunContext, phase: string): { status: RunStatus; message: string } | null {
    // Past the deadline, the version in hand is still assessed but no new revision starts.
    if (phase === "repair" && ctx.config.deadlineAt !== undefined && Date.now() >= ctx.config.deadlineAt) {
      return { status: "time_limited", message: "Time limit reached; the best version so far is kept." };
    }
    const limit = ctx.limiter.check();
    if (!limit.shouldContinue) {
      return { status: limit.stopReason ?? "quality_target_not_reached", message: limit.message };
    }
    if (!ctx.cost.canAffordCall()) {
      return { status: "cost_limited", message: `Budget exhausted before ${phase}.` };
    }
    return null;
  }

  private persistProgress(ctx: RunContext, best: BestState): void {
    const { run, cost, limiter } = ctx;
    this.deps.runStore.updateRun(run.id, {
      totalCostUSD: cost.getTotalCost(),
      totalIterations: limiter.getCurrentIteration(),
      currentIteration: limiter.getCurrentIteration(),
      consecutiveRejections: limiter.getConsecutiveRejections(),
      bestVersionId: best.version.id,
    });

    const status = cost.getStatus();
    if (status.isWarning) {
      this.emit({ type: "cost_warning", totalCost: status.totalCostUSD, budget: status.budgetUSD });
    }
  }

  private terminate(
    ctx: RunContext,
    status: RunStatus,
    message: string,
    bestVersion: ArtifactVersion | null
  ): Run {
    const now = new Date().toISOString();
    const updates: Partial<Run> = {
      status,
      bestVersionId: bestVersion?.id ?? null,
      totalCostUSD: ctx.cost.getTotalCost(),
      totalIterations: ctx.limiter.getCurrentIteration(),
      currentIteration: ctx.limiter.getCurrentIteration(),
      completedAt: now,
      updatedAt: now,
    };
    if (status === "failed") {
      updates.errorMessage = message;
    }

    const finalRun = this.deps.runStore.updateRun(ctx.run.id, updates);
    this.emit({ type: "run_complete", run: finalRun, bestVersion, message });
    return finalRun;
  }

  private emit(event: LoopEvent): void {
    try {
      this.onEvent(event);
    } catch {
      // Event handler errors must never crash the loop.
    }
  }
}

/** Agents attach `usage` to errors from calls that spent tokens but returned nothing usable. */
function usageOf(error: unknown): { model: string; promptTokens: number; completionTokens: number } | null {
  const usage = (error as { usage?: unknown } | null)?.usage as
    | { model?: unknown; promptTokens?: unknown; completionTokens?: unknown }
    | undefined;
  if (!usage || typeof usage.model !== "string") return null;
  if (typeof usage.promptTokens !== "number" || typeof usage.completionTokens !== "number") return null;
  return { model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens };
}
