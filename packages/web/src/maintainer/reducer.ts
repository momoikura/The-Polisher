import type {
  CandidateSummary,
  FileDiff,
  LaneId,
  MaintainerEvent,
  MaintainerLaneState,
  MaintainerLaneSummary,
  MaintainerPhase,
  MaintainerStatus,
  SideMetrics,
} from "@thepolisher/agents";

export const LANE_IDS: LaneId[] = ["code", "security", "doc", "write"];

export interface LaneView {
  state: MaintainerLaneState;
  round: number;
  scores: number[];
  checks: { passed: number; failed: number; failing: Array<{ check: string; message: string }> } | null;
  decision: { accepted: boolean; reason: string; explanation: string; round: number } | null;
  findings: Array<{ severity: string; description: string }>;
  kept: number;
  rejected: number;
  recalled: string[];
  learned: number;
}

export interface FeedItem {
  id: number;
  at: number;
  lane: LaneId | null;
  tone: "neutral" | "good" | "bad" | "warn";
  text: string;
}

export interface Side {
  diffs: FileDiff[];
  pr: string;
}

export interface MaintainerView {
  phase: MaintainerPhase | "idle";
  context: { repo: string; sha: string; issue: { number: number; title: string; url: string }; files: string[]; approach?: string } | null;
  lanes: Record<LaneId, LaneView>;
  baseline: (Side & { metrics: SideMetrics }) | null;
  current: Side | null;
  comparison: { before: SideMetrics; after: SideMetrics } | null;
  costUSD: number;
  budgetUSD: number;
  feed: FeedItem[];
  result: { status: MaintainerStatus; message: string; lanes: Record<LaneId, MaintainerLaneSummary>; totalUSD: number; canOpenPr: boolean } | null;
}

const MAX_FEED = 250;

const emptyLane = (): LaneView => ({
  state: "waiting",
  round: 0,
  scores: [],
  checks: null,
  decision: null,
  findings: [],
  kept: 0,
  rejected: 0,
  recalled: [],
  learned: 0,
});

export const initialView = (): MaintainerView => ({
  phase: "idle",
  context: null,
  lanes: { code: emptyLane(), security: emptyLane(), doc: emptyLane(), write: emptyLane() },
  baseline: null,
  current: null,
  comparison: null,
  costUSD: 0,
  budgetUSD: 0,
  feed: [],
  result: null,
});

export const AGENT: Record<LaneId, string> = { code: "CodePolish", security: "SecurityPolish", doc: "DocPolish", write: "WritePolish" };

const PHASE_TEXT: Record<MaintainerPhase, string> = {
  fetching: "Reading the issue and the repository",
  planning: "Choosing which files to read",
  baseline: "Writing a single-prompt first draft (kept for comparison)",
  polishing: "All four agents are working in parallel",
  reconciling: "Fixing docs and description against the final code while the whole test suite runs",
  verifying: "Running the whole test suite on the final patch and on the first draft",
  done: "Run finished",
};

const REASON_TEXT: Record<string, string> = {
  first_version_accepted: "baseline recorded",
  improvement: "fewer failing checks",
  fewer_problems: "fewer problems",
  more_problems: "added problems",
  score_improvement: "critic score improved",
  no_improvement: "no measurable improvement",
  regression_detected: "broke a check that used to pass",
  more_failures: "more failing checks",
};

export const reasonText = (reason: string) => REASON_TEXT[reason] ?? reason.replace(/_/g, " ");
const pretty = (xs: string[]) => xs.map((x) => x.replace(/_/g, " ")).join(", ");

function updateLane(view: MaintainerView, lane: LaneId, patch: (l: LaneView) => Partial<LaneView>): MaintainerView {
  return { ...view, lanes: { ...view.lanes, [lane]: { ...view.lanes[lane], ...patch(view.lanes[lane]) } } };
}

function candidateText(c: CandidateSummary): string {
  const parts = [
    c.provesFix ? "proves the fix" : "doesn't prove the fix",
    c.objectiveFailing === 0 ? "all checks pass" : `${c.objectiveFailing} failing check${c.objectiveFailing === 1 ? "" : "s"}`,
    c.testsTotal === null ? "tests not run" : `${c.testsPassed}/${c.testsTotal} tests pass`,
    `+${c.linesAdded} lines`,
  ];
  return `Candidate ${c.index + 1}${c.chosen ? " (chosen)" : ""}: ${parts.join(", ")}`;
}

function pushFeed(view: MaintainerView, event: MaintainerEvent, item: Omit<FeedItem, "id" | "at">): MaintainerView {
  const last = view.feed[view.feed.length - 1];
  const feed = [...view.feed, { id: (last?.id ?? 0) + 1, at: event.at, ...item }];
  return { ...view, feed: feed.length > MAX_FEED ? feed.slice(feed.length - MAX_FEED) : feed };
}

export function maintainerReducer(view: MaintainerView, event: MaintainerEvent): MaintainerView {
  switch (event.type) {
    case "phase":
      if (event.phase === view.phase) return view;
      return pushFeed({ ...view, phase: event.phase }, event, { lane: null, tone: "neutral", text: PHASE_TEXT[event.phase] });

    case "context": {
      const next = { ...view, context: { repo: event.repo, sha: event.sha, issue: event.issue, files: event.files, approach: event.approach } };
      return event.approach
        ? pushFeed(next, event, { lane: null, tone: "neutral", text: `Plan: ${event.approach} (read ${event.files.length} files)` })
        : next;
    }

    case "baseline":
      return pushFeed(
        { ...view, baseline: { diffs: event.diffs, pr: event.pr, metrics: event.metrics }, current: { diffs: event.diffs, pr: event.pr } },
        event,
        { lane: null, tone: "neutral", text: `First draft touches ${event.diffs.length} file(s); now the agents take over` }
      );

    case "patch":
      return { ...view, current: { diffs: event.diffs, pr: event.pr } };

    case "lane_state":
      return updateLane(view, event.lane, () => ({ state: event.state }));

    case "lane_evaluation": {
      const next = updateLane(view, event.lane, (l) => ({ round: event.round, scores: [...l.scores, event.score], findings: event.findings }));
      return pushFeed(next, event, {
        lane: event.lane,
        tone: event.score >= 85 ? "good" : "neutral",
        text: `${event.lane === "security" ? "Security review" : "Critic"} scored round ${event.round}: ${event.score}/100`,
      });
    }

    case "lane_checks": {
      const next = updateLane(view, event.lane, () => ({ checks: { passed: event.passed, failed: event.failed, failing: event.failing } }));
      const total = event.passed + event.failed;
      return pushFeed(next, event, {
        lane: event.lane,
        tone: event.failed === 0 ? "good" : "warn",
        text: event.failed === 0 ? `All ${total} checks pass` : `${event.failed} of ${total} checks failing: ${pretty(event.failing.map((f) => f.check))}`,
      });
    }

    case "lane_decision": {
      const next = updateLane(view, event.lane, (l) => ({
        decision: { accepted: event.accepted, reason: event.reason, explanation: event.explanation, round: event.round },
        kept: l.kept + (event.accepted ? 1 : 0),
        rejected: l.rejected + (event.accepted ? 0 : 1),
      }));
      return pushFeed(next, event, {
        lane: event.lane,
        tone: event.accepted ? "good" : "bad",
        text: `${event.accepted ? "Kept" : "Rejected"} round ${event.round}: ${reasonText(event.reason)}`,
      });
    }

    case "lane_changes":
      return pushFeed(view, event, { lane: event.lane, tone: "neutral", text: event.changes.length ? `Changed: ${event.changes.join("; ")}` : "Submitted a revision" });

    case "review":
      return pushFeed(view, event, { lane: event.from, tone: "warn", text: `→ ${AGENT[event.to]}: ${event.findings.join("; ")}` });

    case "candidates": {
      const chosen = event.candidates.find((c) => c.chosen);
      const head = pushFeed(view, event, {
        lane: null,
        tone: "neutral",
        text: `Tested ${event.candidates.length} candidate fixes in parallel; the tests picked candidate ${(chosen?.index ?? 0) + 1}`,
      });
      return event.candidates.reduce((v, c) => pushFeed(v, event, { lane: null, tone: c.chosen ? "good" : "neutral", text: candidateText(c) }), head);
    }
    case "adapt":
      return pushFeed(view, event, { lane: event.lane, tone: "warn", text: `Changes approach: ${event.label}` });
    case "lessons": {
      const next = updateLane(view, event.lane, () => ({ recalled: event.worked }));
      const parts = [
        event.worked.length ? `${event.worked.length} that worked ("${event.worked[0]}"${event.worked.length > 1 ? ", …" : ""})` : "",
        event.avoid.length ? `${event.avoid.length} to avoid` : "",
      ].filter(Boolean);
      return pushFeed(next, event, { lane: event.lane, tone: "neutral", text: `Recalled from memory: ${parts.join(", ")}` });
    }

    case "learned": {
      const next = updateLane(view, event.lane, (l) => ({ learned: l.learned + 1 }));
      const detail = [event.fixed.length ? `fixed ${pretty(event.fixed)}` : "", event.broke.length ? `broke ${pretty(event.broke)}` : ""].filter(Boolean).join("; ");
      return pushFeed(next, event, {
        lane: event.lane,
        tone: event.accepted ? "good" : "bad",
        text: `Remembered: "${event.strategies[0] ?? "this revision"}" was ${event.accepted ? "kept" : "rejected"}${detail ? ` (${detail})` : ""}`,
      });
    }

    case "cost":
      return { ...view, costUSD: event.totalUSD, budgetUSD: event.budgetUSD };

    case "error":
      return pushFeed(view, event, { lane: event.lane ?? null, tone: "bad", text: event.message });

    case "comparison":
      return { ...view, comparison: { before: event.before, after: event.after } };

    case "complete":
      return pushFeed(
        { ...view, costUSD: event.totalUSD, result: { status: event.status, message: event.message, lanes: event.lanes, totalUSD: event.totalUSD, canOpenPr: event.canOpenPr } },
        event,
        { lane: null, tone: event.status === "clean" || event.status === "verified" ? "good" : event.status === "failed" ? "bad" : "warn", text: event.message }
      );
  }
}
