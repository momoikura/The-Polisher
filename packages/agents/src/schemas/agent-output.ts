/**
 * Shared output contract for every specialist agent.
 *
 * Agents score on 0-100 (as the prompts ask). The core controller works on
 * 0-10; conversion happens in exactly one place: toEvaluatorOutput().
 */

import { z } from "zod";
import type { EvaluatorOutput, EvaluationIssue } from "@polishloop/core";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingSchema = z.object({
  id: z.string().min(1),
  severity: SeveritySchema,
  category: z.string().min(1),
  description: z.string().min(1),
  evidence: z.string(),
  location: z.string().optional(),
  recommendedFix: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const EvaluationSchema = z.object({
  score: z.number().min(0).max(100),
  dimensionScores: z.record(z.string(), z.number().min(0).max(100)),
  findings: z.array(FindingSchema),
  criticalFailures: z.array(z.string()),
  requiredFixes: z.array(z.string()),
  recommendedChecks: z.array(z.string()),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

export const RepairSchema = z.object({
  candidateArtifact: z.string().min(1),
  changesMade: z.array(z.string()),
  addressedFindingIds: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
});
export type Repair = z.infer<typeof RepairSchema>;

const SEVERITY_MAP: Record<Severity, EvaluationIssue["severity"]> = {
  critical: "critical",
  high: "major",
  medium: "minor",
  low: "suggestion",
};

/** Convert an agent evaluation (0-100) into the controller's EvaluatorOutput (0-10). */
export function toEvaluatorOutput(evaluation: Evaluation): EvaluatorOutput {
  const findingIssues: EvaluationIssue[] = evaluation.findings.map((f) => ({
    category: f.category,
    severity: SEVERITY_MAP[f.severity],
    description: f.evidence ? `${f.description} (evidence: ${f.evidence})` : f.description,
    location: f.location,
    suggestedFix: f.recommendedFix,
  }));

  const listedCritical = new Set(
    evaluation.findings.filter((f) => f.severity === "critical").map((f) => f.description)
  );
  const extraCritical: EvaluationIssue[] = evaluation.criticalFailures
    .filter((c) => !listedCritical.has(c))
    .map((c) => ({ category: "critical_failure", severity: "critical", description: c }));

  const dimensions = Object.fromEntries(
    Object.entries(evaluation.dimensionScores).map(([k, v]) => [k, v / 10])
  );

  return {
    scores: {
      overall: evaluation.score / 10,
      dimensions,
      rationale: evaluation.requiredFixes.join("; "),
    },
    issues: [...findingIssues, ...extraCritical],
  };
}
