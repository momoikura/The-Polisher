/**
 * Run history endpoints, readable by anyone:
 *   GET /api/runs        → recent runs, newest first
 *   GET /api/runs/:id    → one run's summary and full event timeline, for replay
 *
 * Who started a run stays on the server: a signed-in owner only learns the run is theirs.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { isPullUrl, parseIssueUrl, parsePullUrl } from "@thepolisher/agents";
import { currentUser } from "./auth/auth-api.js";
import { sendJson } from "./http.js";
import { runStore, type RunRecord, type RunStatus, type SavedRun } from "./store/index.js";

const LIST_LIMIT = 200;

/**
 * Runs taken off the site but kept in storage: rich#4244's fix also broke two other tests,
 * which these runs reported as already failing (benchmarks/results/rerun-2026-10-30.md).
 */
const WITHDRAWN = new Set([
  "f023855e-b850-4248-8af1-84dbd4dad4a2",
  "de71dd7d-c18b-452d-be80-d3518b5c016c",
  "d78c719f-94c1-4c4d-be7a-1329ebc891c7",
  "73b4b063-9d39-4b0a-88d3-49f73d48e609",
  "77c6d63d-614b-5a6f-a7f1-8b288af66888",
]);

export const isWithdrawn = (id: string): boolean => WITHDRAWN.has(id);

export function publicRun({ user: _user, ...shown }: RunRecord): Omit<RunRecord, "user"> {
  return shown;
}

export function runForViewer(saved: SavedRun, viewer: string | null) {
  return { ...saved, record: publicRun(saved.record), isMine: viewer !== null && saved.record.user === viewer };
}

/** The summary saved when a run starts; title and status are filled in when it finishes. */
export function startedRecord(id: string, issueUrl: string, model: string, user: string | null): RunRecord {
  let repo = "";
  let issueNumber = 0;
  try {
    const ref = isPullUrl(issueUrl) ? parsePullUrl(issueUrl) : parseIssueUrl(issueUrl);
    repo = `${ref.owner}/${ref.repo}`;
    issueNumber = ref.number;
  } catch {
    // The scripted demo accepts any link; keep the record anyway.
  }
  return { id, issueUrl, repo, issueNumber, title: "", status: "running", totalUSD: 0, model, startedAt: new Date().toISOString(), finishedAt: null, user };
}

export function finishedRecord(started: RunRecord, outcome: { status: RunStatus; totalUSD: number; title: string }): RunRecord {
  return { ...started, ...outcome, title: outcome.title || started.title, finishedAt: new Date().toISOString() };
}

/** History must never break a run: a storage error is logged and the run carries on. */
export async function saveQuietly(what: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (err) {
    console.error(`[history] could not ${what}:`, err instanceof Error ? err.message : err);
  }
}

export async function handleHistoryRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = (req.url ?? "").split("?")[0];
  if (req.method !== "GET") return false;

  if (url === "/api/runs") {
    sendJson(res, 200, { runs: (await runStore().list(LIST_LIMIT)).filter((r) => !isWithdrawn(r.id)).map(publicRun) });
    return true;
  }

  const one = url.match(/^\/api\/runs\/([0-9a-f-]{36})$/);
  if (one) {
    const saved = isWithdrawn(one[1]) ? null : await runStore().get(one[1]);
    if (!saved) sendJson(res, 404, { error: "No saved run with that id." });
    else sendJson(res, 200, runForViewer(saved, (await currentUser(req))?.login ?? null));
    return true;
  }
  return false;
}
