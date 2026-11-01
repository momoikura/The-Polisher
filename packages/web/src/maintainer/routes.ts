export type Page = "maintainer" | "runs" | "memory" | "about" | "privacy" | "terms";

const PATHS: Record<Page, string> = {
  maintainer: "/",
  runs: "/runs",
  memory: "/memory",
  about: "/about",
  privacy: "/privacy",
  terms: "/terms",
};

export const pathForPage = (page: Page): string => PATHS[page];

const RUN_PATH = /^\/runs\/([0-9a-f]{8}-[0-9a-f-]{27})\/*$/i;

export const pathForRun = (id: string): string => `/runs/${id}`;

/** The saved run this address opens, if any. */
export const runIdFromPath = (path: string): string | null => RUN_PATH.exec(path)?.[1] ?? null;

/** Unknown addresses open the issue form. */
export function pageFromPath(path: string): Page {
  if (runIdFromPath(path)) return "runs";
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return (Object.keys(PATHS) as Page[]).find((page) => PATHS[page] === clean) ?? "maintainer";
}
