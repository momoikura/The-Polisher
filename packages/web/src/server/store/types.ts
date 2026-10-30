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
  /** "benchmark" for runs imported from benchmarks/ (scripts/import-benchmark-runs.mjs). */
  source?: "web" | "benchmark";
  /** Benchmark results; older ones have no timeline, and startedAt is then just the date. */
  benchmark?: {
    list: string;
    provesFix: boolean;
    baselineProvesFix: boolean | null;
    tests: string | null;
    wallSeconds: number;
    seenBefore: boolean;
    hasTimeline: boolean;
  };
}

export interface SavedRun {
  record: RunRecord;
  events: unknown[];
}

/**
 * Everything "Open pull request" needs, saved when a run finishes so the PR can
 * still be opened after the server restarts. Kept apart from the public run.
 */
export interface SavedPullRequest {
  owner: string;
  repo: string;
  defaultBranch: string;
  baseSha: string;
  issueNumber: number;
  status: Exclude<RunStatus, "running" | "failed">;
  model: string;
  /** Full new content of every changed file. */
  files: Record<string, string>;
  /** "# Title" then the body. */
  pr: string;
  /** Set once the PR is opened. */
  prUrl?: string;
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
  savePullRequest(id: string, pr: SavedPullRequest): Promise<void>;
  getPullRequest(id: string): Promise<SavedPullRequest | null>;
}

/** Split a string into pieces of at most `maxChars`. */
export function splitString(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) pieces.push(text.slice(i, i + maxChars));
  return pieces.length ? pieces : [""];
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
