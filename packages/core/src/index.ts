/**
 * @thepolisher/core — public API barrel export.
 *
 * Re-exports all types, controller components, store, and utilities
 * so consumers can import from "@thepolisher/core" directly.
 */

export type {
  ArtifactMode,
  BasicRunStatus,
  RunStatus,
  RunConfig,
  AgentRole,
  Run,
  CreateRunInput,
} from "./types/run.js";
export {
  DEFAULT_RUN_CONFIG,
  ARTIFACT_MODES,
  BASIC_RUN_STATUSES,
  ALL_RUN_STATUSES,
  ArtifactModeSchema,
  BasicRunStatusSchema,
  RunStatusSchema,
  RunConfigSchema,
  CreateRunInputSchema,
  RunSchema,
  isTerminalRunStatus,
  isValidRunTransition,
} from "./types/run.js";

export type {
  ContentType,
  ArtifactVersion,
  ArtifactSource,
  CreateArtifactVersionInput,
} from "./types/artifact.js";

export type {
  EvaluationIssue,
  SubjectiveScores,
  Evaluation,
  EvaluatorOutput,
} from "./types/evaluation.js";
export { RUBRIC_DIMENSIONS } from "./types/evaluation.js";

export type { Repair, RepairTarget } from "./types/repair.js";

export type {
  TestType,
  TestAuthority,
  TestCheck,
  TestExecution,
  AggregatedTestResults,
} from "./types/test.js";
export { aggregateTestResults } from "./types/test.js";

export type {
  LearnedStrategy,
  RecordStrategyInput,
} from "./types/strategy.js";

// ─── Lifecycle ───────────────────────────────────────────────────────────────
export {
  RunLifecycleManager,
  InvalidStateTransitionError,
  RunNotFoundError,
  getRunLifecycleManager,
} from "./lifecycle/run-lifecycle.js";

// ─── Controller ──────────────────────────────────────────────────────────────
export {
  LoopController,
  MalformedEvaluationError,
  assertValidEvaluation,
  meetsQualityTarget,
  type ControllerConfig,
  type GeneratorAgent,
  type EvaluatorAgent,
  type RepairAttempt,
  type RepairerAgent,
  type TesterAgent,
  type GenerateResult,
  type EvaluateResult,
  type RepairResult,
  type TestResult,
  type RunStore,
  type ArtifactStore,
  type LoopEvent,
  type EventHandler,
} from "./controller/loop-controller.js";

export {
  evaluateCandidate,
  meetsAcceptanceCriteria,
  type GateDecision,
  type GateReason,
  type ScoreComparison,
} from "./controller/best-version-gate.js";

export {
  CostTracker,
  type CostRecord,
  type CostStatus,
} from "./controller/cost-tracker.js";

export {
  IterationLimiter,
  type LimitCheckResult,
} from "./controller/iteration-limiter.js";

// ─── Store ───────────────────────────────────────────────────────────────────
export { FileArtifactStore } from "./store/artifact-store.js";

// ─── Database ────────────────────────────────────────────────────────────────
export { getDb, closeDb } from "./db/client.js";
export { runMigrations } from "./db/migrate.js";
export * as dbSchema from "./db/schema.js";

// ─── Utilities ───────────────────────────────────────────────────────────────
export { sha256 } from "./utils/hash.js";
export {
  computeLineDiff,
  formatUnifiedDiff,
  countChanges,
  type DiffChange,
} from "./utils/diff.js";
