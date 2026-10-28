import type { LaneId, MaintainerLaneState } from "@thepolisher/agents";
import type { IconName } from "../components/Icon.js";

export const LANE_META: Record<LaneId, { agent: string; job: string; icon: IconName }> = {
  code: { agent: "CodePolish", job: "Writes the fix and its tests", icon: "code" },
  security: { agent: "SecurityPolish", job: "Reviews the fix for security problems", icon: "shield" },
  doc: { agent: "DocPolish", job: "Updates README and changelog", icon: "book" },
  write: { agent: "WritePolish", job: "Writes the pull request description", icon: "pen" },
};

export const STATE_LABEL: Record<MaintainerLaneState, string> = {
  waiting: "Waiting",
  evaluating: "Critiquing",
  testing: "Running checks",
  validating: "Running tests on Modal",
  repairing: "Revising",
  reviewing: "Reviewing CodePolish",
  clean: "Approved",
  not_clean: "Changes requested",
  failed: "Failed",
};

export const ACTIVE_STATES: MaintainerLaneState[] = ["evaluating", "testing", "validating", "repairing", "reviewing"];

/** Status glyph: shape carries meaning, not color. */
export function stateIcon(state: MaintainerLaneState): IconName {
  if (state === "clean") return "checkCircle";
  if (state === "not_clean" || state === "failed") return "timesCircle";
  if (ACTIVE_STATES.includes(state)) return "circleNotch";
  return "dotCircle";
}
