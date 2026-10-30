/**
 * Best-Version Gate — the sole authority on whether a candidate replaces the current best.
 *
 * INVARIANT: This gate uses ONLY objective test results and deterministic logic.
 * Subjective LLM scores are NEVER consulted for acceptance decisions.
 *
 * Decision logic:
 * 1. If no current best exists → accept if all objective tests pass
 * 2. If current best exists → reject if ANY previously-passing test now fails (regression),
 *    except checks marked minor, when the candidate fixes strictly more checks than it breaks
 * 3. If no regression → accept if objective failures decreased
 * 4. If objective failures are equal → compare individual problem counts
 *    inside the failing checks; more is rejected, fewer is accepted
 * 5. Still tied → accept only if an independent
 *    evaluation score improved by at least epsilon (tie-break only)
 * 6. If objective failures increased → reject
 *
 * Scores can never override a regression or an increase in failures.
 */

import type { AggregatedTestResults, TestType } from "../types/test.js";

/** The gate's decision and reasoning. */
export interface GateDecision {
  /** Whether the candidate should replace the current best. */
  accepted: boolean;
  /** Machine-readable reason code. */
  reason: GateReason;
  /** Human-readable explanation. */
  explanation: string;
  /** Tests that regressed (empty if no regression). */
  regressions: TestType[];
}

export type GateReason =
  | "first_version_accepted"
  | "first_version_rejected"
  | "improvement"
  | "fewer_problems"
  | "more_problems"
  | "score_improvement"
  | "no_improvement"
  | "regression_detected"
  | "net_improvement"
  | "more_failures";

/** Independent evaluator scores (0-10), consulted only when objective results tie. */
export interface ScoreComparison {
  candidate: number | null;
  best: number | null;
  /** Minimum score gain that counts as meaningful progress. */
  epsilon: number;
}

/**
 * Evaluate whether a candidate should replace the current best version.
 *
 * @param candidateResults - Test results for the new candidate
 * @param bestResults - Test results for the current best version (null if first version)
 * @param scores - Optional independent scores used only to break objective ties
 * @returns A GateDecision with the verdict and reasoning
 */
export function evaluateCandidate(
  candidateResults: AggregatedTestResults,
  bestResults: AggregatedTestResults | null,
  scores?: ScoreComparison,
  options?: { minorChecks?: readonly TestType[] }
): GateDecision {
  // ── Case 1: First version (no current best) ──────────────────────────────
  if (bestResults === null) {
    // Accept the first version if it has zero objective failures.
    // Even if it has failures, accept it as the starting best since there's
    // nothing to compare against — but track the reason differently.
    if (candidateResults.allObjectivesPassed) {
      return {
        accepted: true,
        reason: "first_version_accepted",
        explanation:
          "First version accepted: all objective tests passed.",
        regressions: [],
      };
    }

    // Accept first version even with failures — it's our only option.
    // But mark the reason so the controller knows improvement is needed.
    return {
      accepted: true,
      reason: "first_version_accepted",
      explanation: `First version accepted as baseline with ${candidateResults.objectiveFailed} objective failure(s).`,
      regressions: [],
    };
  }

  // ── Case 2: Regression check ──────────────────────────────────────────────
  const regressions = detectRegressions(candidateResults, bestResults);
  // A minor check (lint, style) may break if the candidate fixes strictly more checks than it
  // breaks: e.g. a revision that finally proves the fix but leaves an unused import, which the
  // next round removes. Anything else breaking is still a regression.
  const minor = new Set<TestType>(options?.minorChecks ?? []);
  const fixed = candidateResults.passingTestTypes.filter((t) => !bestResults.passingTestTypes.includes(t)).length;
  if (regressions.length > 0 && regressions.every((t) => minor.has(t)) && fixed > regressions.length) {
    return {
      accepted: true,
      reason: "net_improvement",
      explanation: `Net improvement: fixed ${fixed} check(s) at the cost of minor ${regressions.length === 1 ? "check" : "checks"} [${regressions.join(", ")}], left for the next round.`,
      regressions,
    };
  }
  if (regressions.length > 0) {
    return {
      accepted: false,
      reason: "regression_detected",
      explanation: `Regression detected: ${regressions.length} previously-passing test(s) now fail: [${regressions.join(", ")}].`,
      regressions,
    };
  }

  // ── Case 3: Compare objective failure counts ──────────────────────────────
  if (candidateResults.objectiveFailed < bestResults.objectiveFailed) {
    return {
      accepted: true,
      reason: "improvement",
      explanation: `Improvement: objective failures decreased from ${bestResults.objectiveFailed} to ${candidateResults.objectiveFailed}.`,
      regressions: [],
    };
  }

  if (candidateResults.objectiveFailed === bestResults.objectiveFailed) {
    // Same failing checks: count individual problems inside them before consulting scores.
    if (candidateResults.objectiveProblems > bestResults.objectiveProblems) {
      return {
        accepted: false,
        reason: "more_problems",
        explanation: `Rejected: problems inside failing checks increased from ${bestResults.objectiveProblems} to ${candidateResults.objectiveProblems}.`,
        regressions: [],
      };
    }
    if (candidateResults.objectiveProblems < bestResults.objectiveProblems) {
      return {
        accepted: true,
        reason: "fewer_problems",
        explanation: `Improvement: problems inside failing checks decreased from ${bestResults.objectiveProblems} to ${candidateResults.objectiveProblems}.`,
        regressions: [],
      };
    }
    return compareScoresOnTie(scores);
  }

  // ── Case 4: More failures than current best ───────────────────────────────
  return {
    accepted: false,
    reason: "more_failures",
    explanation: `Rejected: objective failures increased from ${bestResults.objectiveFailed} to ${candidateResults.objectiveFailed}.`,
    regressions: [],
  };
}

/**
 * Objective tie-break. The score must come from an evaluation call separate
 * from the repair call; a missing score never counts as an improvement.
 */
function compareScoresOnTie(scores: ScoreComparison | undefined): GateDecision {
  if (!scores || scores.candidate === null || scores.best === null) {
    return {
      accepted: false,
      reason: "no_improvement",
      explanation:
        "Rejected: objective results unchanged and no independent score was available to show improvement.",
      regressions: [],
    };
  }

  const delta = scores.candidate - scores.best;
  if (delta >= scores.epsilon) {
    return {
      accepted: true,
      reason: "score_improvement",
      explanation: `Objective results unchanged; independent score improved from ${scores.best.toFixed(2)} to ${scores.candidate.toFixed(2)}.`,
      regressions: [],
    };
  }

  return {
    accepted: false,
    reason: "no_improvement",
    explanation: `Rejected: objective results unchanged and score did not improve meaningfully (${scores.best.toFixed(2)} → ${scores.candidate.toFixed(2)}, required +${scores.epsilon}).`,
    regressions: [],
  };
}

/**
 * Detect regressions: tests that passed in the best version but fail in the candidate.
 */
function detectRegressions(
  candidateResults: AggregatedTestResults,
  bestResults: AggregatedTestResults
): TestType[] {
  const candidatePassingSet = new Set(candidateResults.passingTestTypes);
  const regressions: TestType[] = [];

  for (const testType of bestResults.passingTestTypes) {
    if (!candidatePassingSet.has(testType)) {
      regressions.push(testType);
    }
  }

  return regressions;
}

/**
 * Check if acceptance criteria are fully met (all objectives pass).
 * Used by the controller to decide if early stopping is appropriate.
 */
export function meetsAcceptanceCriteria(
  results: AggregatedTestResults
): boolean {
  return results.allObjectivesPassed;
}
