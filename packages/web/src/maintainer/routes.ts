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

/** Unknown addresses open the issue form. */
export function pageFromPath(path: string): Page {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return (Object.keys(PATHS) as Page[]).find((page) => PATHS[page] === clean) ?? "maintainer";
}
