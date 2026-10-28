/** Live events from an Auto-Maintainer run. Every value comes from a real step. */

import type { LaneId } from "../lanes.js";
import type { FileDiff } from "./bundle.js";

export type MaintainerPhase = "fetching" | "planning" | "baseline" | "polishing" | "reconciling" | "done";
export type LaneState = "waiting" | "evaluating" | "testing" | "validating" | "repairing" | "reviewing" | "clean" | "not_clean" | "failed";
export type MaintainerStatus = "clean" | "not_clean" | "failed";

export interface SideMetrics {
  testsPassed: number | null;
  testsTotal: number | null;
  provesFix: boolean | null;
  lintIssues: number | null;
  /** Objective checks passed / total per lane, excluding sandbox checks. */
  checks: Record<LaneId, { passed: number; total: number }>;
  /** Critic scores 0-100 per lane (null if never evaluated). */
  scores: Record<LaneId, number | null>;
  files: number;
  linesAdded: number;
}

export interface LaneSummary {
  clean: boolean;
  status: string;
  rounds: number;
  costUSD: number;
  remaining: string[];
}

type At = { at: number };

export type MaintainerEvent = At &
  (
    | { type: "phase"; phase: MaintainerPhase }
    | {
        type: "context";
        repo: string;
        sha: string;
        issue: { number: number; title: string; url: string };
        files: string[];
        approach?: string;
      }
    | { type: "baseline"; diffs: FileDiff[]; pr: string; metrics: SideMetrics }
    | { type: "patch"; diffs: FileDiff[]; pr: string }
    | { type: "lane_state"; lane: LaneId; state: LaneState; round: number }
    | { type: "lane_evaluation"; lane: LaneId; round: number; score: number; findings: Array<{ severity: string; description: string }> }
    | { type: "lane_checks"; lane: LaneId; round: number; passed: number; failed: number; failing: Array<{ check: string; message: string }> }
    | { type: "lane_decision"; lane: LaneId; round: number; accepted: boolean; reason: string; explanation: string }
    | { type: "lane_changes"; lane: LaneId; round: number; changes: string[] }
    | { type: "review"; from: LaneId; to: LaneId; findings: string[] }
    | { type: "lessons"; lane: LaneId; round: number; worked: string[]; avoid: string[] }
    /** The agent changed approach after its revisions were rejected. */
    | { type: "adapt"; lane: LaneId; round: number; mode: "normal" | "rethink" | "minimal"; label: string }
    | { type: "learned"; lane: LaneId; round: number; accepted: boolean; fixed: string[]; broke: string[]; strategies: string[] }
    | { type: "cost"; totalUSD: number; budgetUSD: number }
    | { type: "error"; lane?: LaneId; message: string }
    | { type: "comparison"; before: SideMetrics; after: SideMetrics }
    | { type: "complete"; status: MaintainerStatus; message: string; lanes: Record<LaneId, LaneSummary>; totalUSD: number; canOpenPr: boolean }
  );

export type MaintainerEventInput = MaintainerEvent extends infer E ? (E extends MaintainerEvent ? Omit<E, "at"> : never) : never;
