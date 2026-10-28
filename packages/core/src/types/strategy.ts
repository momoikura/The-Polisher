/**
 * LearnedStrategy — patterns the Repairer has used that proved successful.
 *
 * Over time, the system accumulates knowledge about which repair strategies
 * work for which kinds of issues. The Repairer agent can consult these
 * before attempting a fix.
 */

/** A LearnedStrategy record as stored in the database. */
export interface LearnedStrategy {
  id: string;
  /** Which mode this strategy applies to. */
  mode: string;
  /** The kind of issue this strategy addresses (e.g., "accessibility", "grammar"). */
  issuePattern: string;
  /** Human-readable description of the repair approach. */
  strategyDescription: string;
  /** How many times this strategy has been applied. */
  timesUsed: number;
  /** How many times applying it led to the issue being resolved. */
  timesSuccessful: number;
  /** Computed success rate (timesSuccessful / timesUsed). */
  successRate: number;
  createdAt: string;
  updatedAt: string;
}

/** Input for recording a new strategy or updating an existing one. */
export interface RecordStrategyInput {
  mode: string;
  issuePattern: string;
  strategyDescription: string;
  wasSuccessful: boolean;
}
