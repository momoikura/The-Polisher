/**
 * Evaluation — the Evaluator agent's subjective assessment of an artifact.
 *
 * Key invariant: subjective scores are recorded for diagnostics
 * but NEVER used as the sole gate for acceptance. Objective checks
 * in TestExecution are authoritative.
 */

/** A single issue identified by the Evaluator. */
export interface EvaluationIssue {
  /** Machine-readable category (e.g., "grammar", "accessibility", "logic_error"). */
  category: string;
  /** Severity from the evaluator's perspective. */
  severity: "critical" | "major" | "minor" | "suggestion";
  /** Human-readable description of the issue. */
  description: string;
  /** Optional: location in the artifact (line number, CSS selector, etc.). */
  location?: string;
  /** Optional: suggested fix. */
  suggestedFix?: string;
}

/** Mode-specific subjective score dimensions. */
export interface SubjectiveScores {
  /** Overall quality score 0-10. */
  overall: number;
  /** Mode-specific dimension scores. */
  dimensions: Record<string, number>;
  /** Free-text rationale from the evaluator. */
  rationale: string;
}

/** An Evaluation record as stored in the database. */
export interface Evaluation {
  id: string;
  runId: string;
  artifactVersionId: string;
  evaluatorModel: string;
  subjectiveScores: SubjectiveScores;
  issues: EvaluationIssue[];
  promptTokens: number;
  completionTokens: number;
  costUSD: number;
  createdAt: string;
}

/** The structured output schema the Evaluator agent must produce. */
export interface EvaluatorOutput {
  scores: SubjectiveScores;
  issues: EvaluationIssue[];
}

/**
 * Mode-specific rubric dimensions.
 * These define what the Evaluator scores on a 0-10 scale per mode.
 */
export const RUBRIC_DIMENSIONS: Record<string, string[]> = {
  writing: ["clarity", "tone_consistency", "structural_balance", "grammar", "engagement"],
  ui: ["visual_quality", "semantic_html", "responsiveness", "accessibility_awareness", "design_coherence"],
  code: ["correctness", "readability", "edge_case_handling", "style", "efficiency"],
  reports: ["narrative_flow", "evidence_quality", "visual_hierarchy", "completeness", "actionability"],
};
