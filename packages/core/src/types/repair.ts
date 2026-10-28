/**
 * Repair — tracks a single repair attempt by the Repairer agent.
 *
 * Links the source version (what was broken) to the result version
 * (the repair attempt), along with which issues were targeted and
 * which learned strategy (if any) was applied.
 */

/** A Repair record as stored in the database. */
export interface Repair {
  id: string;
  runId: string;
  /** The artifact version that was fed to the Repairer. */
  sourceVersionId: string;
  /** The artifact version produced by the Repairer. */
  resultVersionId: string;
  repairerModel: string;
  /** Which issues from the Evaluation were targeted. */
  issuesAddressed: RepairTarget[];
  /** ID of the learned strategy used, if any. */
  strategyUsed: string | null;
  promptTokens: number;
  completionTokens: number;
  costUSD: number;
  createdAt: string;
}

/** A specific issue the Repairer targeted. */
export interface RepairTarget {
  /** Category of the original EvaluationIssue. */
  category: string;
  /** Description of what was attempted. */
  attemptedFix: string;
  /** Whether the Repairer believes it addressed the issue. */
  selfReportedFixed: boolean;
}
