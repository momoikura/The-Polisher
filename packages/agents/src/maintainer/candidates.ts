/**
 * Parallel candidate fixes. Several independent first drafts are tested in the
 * sandbox at once and the tests pick the one the agents polish: one that proves
 * the fix, then the fewest failing objective checks, then the smallest diff.
 * A model's opinion plays no part in the choice.
 */

export interface CandidateScore {
  index: number;
  /** The new tests fail on the original code and pass with this candidate. */
  provesFix: boolean;
  /** Failing objective checks: static checks plus compile, lint and test results. */
  objectiveFailing: number;
  linesAdded: number;
}

/** Index of the candidate to polish. */
export function chooseCandidate(candidates: readonly CandidateScore[]): number {
  const ranked = [...candidates].sort(
    (a, b) =>
      Number(b.provesFix) - Number(a.provesFix) ||
      a.objectiveFailing - b.objectiveFailing ||
      a.linesAdded - b.linesAdded ||
      a.index - b.index
  );
  return ranked[0].index;
}
