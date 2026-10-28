/**
 * PolishLoop Run — represents a single polishing job from start to finish.
 *
 * A Run tracks the full lifecycle: mode, user prompt,
 * configuration overrides, cost/iteration accounting, and a pointer
 * to the best artifact version produced so far.
 */

import { z } from "zod";

/** The four artifact modes PolishLoop supports (writing, ui, code, presentation/reports). */
export const ARTIFACT_MODES = [
  "writing",
  "ui",
  "code",
  "reports",
  "presentation",
] as const;

export type ArtifactMode = (typeof ARTIFACT_MODES)[number];

export const ArtifactModeSchema = z.enum(ARTIFACT_MODES);

/**
 * Basic run lifecycle states specified for PolishLoop:
 * queued -> running -> completed | quality_target_not_reached | failed
 */
export const BASIC_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "quality_target_not_reached",
  "failed",
] as const;

export type BasicRunStatus = (typeof BASIC_RUN_STATUSES)[number];

export const BasicRunStatusSchema = z.enum(BASIC_RUN_STATUSES);

/** Full run statuses supported by the system including detailed sub-states. */
export const ALL_RUN_STATUSES = [
  "queued",
  "pending",
  "running",
  "completed",
  "accepted",
  "quality_target_not_reached",
  "iteration_limited",
  "cost_limited",
  "stalled",
  "failed",
  "cancelled",
] as const;

export type RunStatus = (typeof ALL_RUN_STATUSES)[number];

export const RunStatusSchema = z.enum(ALL_RUN_STATUSES);

/** The four agent roles in the system. */
export const AGENT_ROLES = ["generator", "evaluator", "repairer", "tester"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
export const AgentRoleSchema = z.enum(AGENT_ROLES);

/** User-supplied configuration that scopes a run. */
export const QualityThresholdsSchema = z.object({
  minScore: z.number().min(0).max(10).default(8.0),
  requireAllTestsPass: z.boolean().default(true),
  maxCriticalDefects: z.number().int().min(0).default(0),
});

export type QualityThresholds = z.infer<typeof QualityThresholdsSchema>;

export const RunConfigSchema = z.object({
  /** Maximum number of generate->evaluate->repair iterations (default: 5). */
  maxIterations: z.number().int().min(1).default(5),
  /** Maximum total cost (USD) before the run is halted (default: $2.00). */
  maxCostUSD: z.number().positive().default(2.0),
  /** How many consecutive non-improving iterations before stagnation stop (default: 2). */
  maxConsecutiveRejections: z.number().int().min(1).default(2),
  /** Minimum score progress epsilon to count as meaningful progress (default: 0.05). */
  progressEpsilon: z.number().min(0).default(0.05),
  /** Stop as soon as acceptance criteria are met. */
  earlyStopOnAcceptance: z.boolean().default(true),
  /** Quality thresholds that must be satisfied. */
  qualityThresholds: QualityThresholdsSchema.default({
    minScore: 8.0,
    requireAllTestsPass: true,
    maxCriticalDefects: 0,
  }),
  /** Optional timeout in milliseconds per iteration/tool call. */
  timeoutMs: z.number().int().positive().default(30000),
  /** Optional: user-supplied test suite (code mode). */
  testSuite: z.string().optional(),
  /** Optional: style guide text (writing mode). */
  styleGuide: z.string().optional(),
  /** Optional: design tokens JSON (UI mode). */
  designTokens: z.record(z.unknown()).optional(),
  /** Optional: max slide/section count (reports/presentation mode). */
  maxSections: z.number().int().positive().optional(),
  /** Optional: max words per section/slide (reports/presentation mode). */
  maxWordsPerSection: z.number().int().positive().optional(),
  /** Optional: phrases/terms that must appear in the final artifact (writing mode). */
  requiredPhrases: z.array(z.string().min(1)).optional(),
  /** Optional: word-count bounds (writing mode). */
  minWords: z.number().int().positive().optional(),
  maxWords: z.number().int().positive().optional(),
  /** Optional: intended audience and tone, passed to the evaluator and repairer. */
  audience: z.string().optional(),
  /** Optional: target readability range (writing mode). */
  readabilityRange: z
    .object({
      min: z.number(),
      max: z.number(),
    })
    .optional(),
  /** Optional: override the LLM model for each agent role. */
  modelOverrides: z.record(z.string()).optional(),
  /** Optional: source data tables for cross-checking (reports mode). */
  sourceData: z.string().optional(),
});

export type RunConfig = z.infer<typeof RunConfigSchema>;

/** Default configuration values. */
export const DEFAULT_RUN_CONFIG: RunConfig = {
  maxIterations: 5,
  maxCostUSD: 2.0,
  maxConsecutiveRejections: 2,
  progressEpsilon: 0.05,
  earlyStopOnAcceptance: true,
  qualityThresholds: {
    minScore: 8.0,
    requireAllTestsPass: true,
    maxCriticalDefects: 0,
  },
  timeoutMs: 30000,
  readabilityRange: { min: 60, max: 70 },
  maxSections: 20,
  maxWordsPerSection: 150,
};

/** Input schema needed to create a new Run. */
export const CreateRunInputSchema = z.object({
  mode: ArtifactModeSchema,
  prompt: z.string().min(1, "Prompt cannot be empty"),
  initialContent: z.string().optional(),
  config: RunConfigSchema.partial().optional(),
});

export type CreateRunInput = z.infer<typeof CreateRunInputSchema>;

/** A Run record as stored and validated. */
export const RunSchema = z.object({
  id: z.string(),
  mode: ArtifactModeSchema,
  status: RunStatusSchema,
  prompt: z.string(),
  config: RunConfigSchema,
  totalCostUSD: z.number().default(0),
  totalIterations: z.number().int().default(0),
  currentIteration: z.number().int().default(0),
  consecutiveRejections: z.number().int().default(0),
  bestVersionId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  errorMessage: z.string().nullable().default(null),
});

export type Run = z.infer<typeof RunSchema>;

/**
 * Check if a status represents a terminal state.
 */
export function isTerminalRunStatus(status: RunStatus): boolean {
  return [
    "completed",
    "accepted",
    "quality_target_not_reached",
    "iteration_limited",
    "cost_limited",
    "stalled",
    "failed",
    "cancelled",
  ].includes(status);
}

/**
 * Validate a run lifecycle transition according to state machine rules.
 */
export function isValidRunTransition(from: RunStatus, to: RunStatus): boolean {
  if (from === to) return true;

  // Once in a terminal state, transitions are not allowed
  if (isTerminalRunStatus(from)) return false;

  const validTransitions: Record<string, RunStatus[]> = {
    queued: ["running", "failed", "cancelled"],
    pending: ["running", "queued", "failed", "cancelled"],
    running: [
      "completed",
      "accepted",
      "quality_target_not_reached",
      "iteration_limited",
      "cost_limited",
      "stalled",
      "failed",
      "cancelled",
    ],
  };

  return validTransitions[from]?.includes(to) ?? false;
}
