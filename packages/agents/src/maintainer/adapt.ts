/**
 * How an agent changes course after the gate rejects its revisions.
 *
 * Every repair starts again from the last kept version, so without this the
 * agent can't see why its previous attempt was thrown out and tends to repeat
 * it. One rejection: explain it and ask for a different approach. Two or more
 * in a row: stop trying to fix everything and make the smallest edit for the
 * single most important failing check.
 */

import type { RepairAttempt } from "@polishloop/core";

export type AdaptMode = "normal" | "rethink" | "minimal";

export interface AdaptStrategy {
  mode: AdaptMode;
  /** Instructions added to the repair prompt (empty in normal mode). */
  brief: string;
  /** One line for the live timeline, or null when nothing changed. */
  label: string | null;
}

const MINIMAL_AFTER = 2;

const readable = (check: string) => check.replace(/_/g, " ");

function describeAttempt(a: RepairAttempt): string {
  const broke = a.regressions.length ? ` It broke: ${a.regressions.join(", ")}.` : "";
  const tried = a.changesMade.length ? ` It tried: ${a.changesMade.join("; ")}.` : "";
  return `- Round ${a.round} was rejected (${a.explanation.trim()})${broke}${tried}`;
}

export function adaptStrategy(history: readonly RepairAttempt[], failingChecks: readonly string[]): AdaptStrategy {
  const lastKept = history.map((a) => a.accepted).lastIndexOf(true);
  const rejected = history.slice(lastKept + 1);
  if (rejected.length === 0) return { mode: "normal", brief: "", label: null };

  const shared = rejected
    .map((a) => new Set(a.regressions))
    .reduce((acc, s) => new Set([...acc].filter((c) => s.has(c))));
  const pattern =
    rejected.length > 1 && shared.size ? `\nEvery rejected attempt broke ${[...shared].join(", ")}: whatever they had in common caused it.` : "";
  const wasted = rejected.some((a) => a.changesMade.some((c) => c.startsWith("Discarded ")))
    ? "\nEdits to files you don't own are thrown away before anyone sees them, so they can never improve your score. Spend this round on the open findings instead."
    : "";
  // Without this, a cautious model answers a rejection by changing nothing, which can never be kept.
  const keepGoing =
    "\nStill make a real change this round: an unchanged revision is always rejected. Keep everything that already passes and change only what the open findings ask for.";
  const report = `Your previous revisions were rejected and thrown away; you are starting again from the last kept version.\n${rejected.map(describeAttempt).join("\n")}${pattern}${wasted}${keepGoing}`;

  if (rejected.length < MINIMAL_AFTER) {
    return {
      mode: "rethink",
      brief: `${report}\nDo not repeat what was rejected. Take a different approach.`,
      label: "rethinks after a rejected revision",
    };
  }

  const target = failingChecks[0];
  const focus = target
    ? `Make the smallest edit that fixes only the failing check "${target}". Leave every other line exactly as it is, and ignore style findings this round.`
    : "Make the smallest edit that addresses the most severe finding. Leave every other line exactly as it is.";
  return {
    mode: "minimal",
    brief: `${report}\nBroad rewrites keep failing. ${focus}`,
    label: target ? `narrows to the smallest fix for ${readable(target)}` : "narrows to the smallest possible fix",
  };
}
