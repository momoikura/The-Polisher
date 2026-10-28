/**
 * Run history: every run's summary and full event timeline, kept after the
 * server restarts so anyone can browse past runs.
 */

export type RunStatus = "running" | "clean" | "verified" | "not_clean" | "failed";

export interface RunRecord {
  id: string;
  issueUrl: string;
  repo: string;
  issueNumber: number;
  title: string;
  status: RunStatus;
  totalUSD: number;
  model: string;
  startedAt: string;
  finishedAt: string | null;
  /** GitHub login of whoever started it; null before sign-in exists. */
  user: string | null;
}

export interface SavedRun {
  record: RunRecord;
  events: unknown[];
}

export interface RunStore {
  /** Record a run as started, so it shows up in the list while it's still going. */
  start(record: RunRecord): Promise<void>;
  /** Record the final state and the full event timeline. */
  finish(record: RunRecord, events: readonly unknown[]): Promise<void>;
  get(id: string): Promise<SavedRun | null>;
  /** Newest first. */
  list(limit: number): Promise<RunRecord[]>;
  /** How many runs this user has started since `sinceIso`, for the daily limit. */
  countSince(user: string, sinceIso: string): Promise<number>;
}

/**
 * Split events into pages whose JSON stays under `maxChars`, preserving order.
 * A run's timeline is then a handful of writes instead of one per event, and
 * no page comes near DynamoDB's 400 KB item limit.
 */
export function splitIntoPages<T>(events: readonly T[], maxChars: number): T[][] {
  const pages: T[][] = [];
  let page: T[] = [];
  let size = 2; // "[]"
  for (const event of events) {
    const length = JSON.stringify(event).length + 1;
    if (page.length > 0 && size + length > maxChars) {
      pages.push(page);
      page = [];
      size = 2;
    }
    page.push(event);
    size += length;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}
