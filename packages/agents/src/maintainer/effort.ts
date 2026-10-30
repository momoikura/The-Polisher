/**
 * How long Muse Spark reasons at each step of a run. Measured on one small fix
 * (2026-10-29, one sample each, all answers correct): minimal 3 s, low 8 s,
 * model default 15 s, high 57 s. Every step stays quick except where it pays:
 * CodePolish thinks harder only once a revision was rejected. Unset = model default.
 */

import type { ReasoningEffort } from "../llm/chat-client.js";
import type { AdaptMode } from "./adapt.js";

export const EFFORT: Readonly<Record<"plan" | "draft" | "review" | "otherRepair", ReasoningEffort | undefined>> = {
  /** Choosing which files and symbols to read. */
  plan: "minimal",
  /** First drafts: several in parallel, and the sandbox's tests pick the best. */
  draft: "low",
  /** Every critic, including SecurityPolish. */
  review: "low",
  /** Docs and the PR description. */
  otherRepair: "low",
};

/**
 * CodePolish's revisions: quick while revisions are being kept; after a rejection
 * (rethink, then the narrowed minimal strategy) the model's full default. On a hard
 * issue its revisions took most of the run (rich#4238: 9.5 of 19 minutes).
 */
export function codeRepairEffort(mode: AdaptMode): ReasoningEffort | undefined {
  return mode === "normal" ? "low" : undefined;
}
