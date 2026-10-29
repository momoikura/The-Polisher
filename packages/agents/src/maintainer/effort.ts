/**
 * How long Muse Spark reasons at each step of a run. Measured on one small fix
 * (2026-10-29, one sample each, all answers correct): minimal 3 s, low 8 s,
 * model default 15 s, high 57 s. Reasoning goes where correctness is decided
 * (CodePolish's revisions); every other step stays quick. Unset = model default.
 */

import type { ReasoningEffort } from "../llm/chat-client.js";

export const EFFORT: Readonly<Record<"plan" | "draft" | "review" | "codeRepair" | "otherRepair", ReasoningEffort | undefined>> = {
  /** Choosing which files and symbols to read. */
  plan: "minimal",
  /** First drafts: several in parallel, and the sandbox's tests pick the best. */
  draft: "low",
  /** Every critic, including SecurityPolish. */
  review: "low",
  /** The fix itself. */
  codeRepair: undefined,
  /** Docs and the PR description. */
  otherRepair: "low",
};
