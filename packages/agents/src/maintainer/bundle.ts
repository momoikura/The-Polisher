/**
 * The pull request the agents build, and the repo snapshot it is based on.
 *
 * Lane ownership:
 *   code  (CodePolish) → source + test files
 *   doc   (DocPolish)  → README / docs / CHANGELOG
 *   write (WritePolish)→ PR title + description
 *   ui    (UIPolish)   → reviewer only: UX of the code change, gates CodePolish
 */

import { z } from "zod";
import { computeLineDiff } from "@polishloop/core";

export type FileMap = Readonly<Record<string, string>>;

export interface RepoSnapshot {
  owner: string;
  repo: string;
  defaultBranch: string;
  sha: string;
  issue: { number: number; title: string; body: string; url: string };
  /** Every blob path in the repo (possibly truncated for huge repos). */
  tree: string[];
  /** Contents of the files loaded as context. */
  files: FileMap;
}

export interface PrBundle {
  code: FileMap;
  docs: FileMap;
  pr: string;
}

export const PrBundleSchema = z.object({
  code: z.record(z.string(), z.string()),
  docs: z.record(z.string(), z.string()),
  pr: z.string().min(1),
});

/** Lane artifacts are strings inside the LoopController; file maps are stable JSON. */
export function serializeFiles(files: FileMap): string {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted, null, 2);
}

export function parseFiles(content: string): FileMap {
  const parsed = z.record(z.string(), z.string()).safeParse(JSON.parse(content));
  if (!parsed.success) throw new Error("Lane artifact is not a file map.");
  return parsed.data;
}

export const isTestPath = (p: string) => /(^|\/)(tests?\/|test_[^/]*\.py$|[^/]*_test\.py$|conftest\.py$)/.test(p);
export const isDocPath = (p: string) => /\.(md|rst|txt)$/i.test(p) && !/requirements[^/]*\.txt$/i.test(p);

/** Paths an agent may never touch. */
const FORBIDDEN = [/^\.github\//, /^\.git\//, /(^|\/)\.env/, /\.(pem|key|p12)$/i, /(^|\/)(setup\.cfg|pyproject\.toml|setup\.py|tox\.ini|noxfile\.py)$/];
export const isForbiddenPath = (p: string) => p.startsWith("/") || p.includes("..") || FORBIDDEN.some((re) => re.test(p));

/** The files an agent may change: Python for CodePolish, docs for DocPolish, never config or CI. */
export function ownedFiles<T>(lane: "code" | "doc", files: Record<string, T>): Record<string, T> {
  const owns = (p: string) => !isForbiddenPath(p) && (lane === "code" ? /\.pyi?$/.test(p) : isDocPath(p));
  return Object.fromEntries(Object.entries(files).filter(([p]) => owns(p)));
}

/** Workspace of the current best artifacts, shared by all lanes. */
export class PrWorkspace {
  private bundle: PrBundle;
  constructor(readonly snapshot: RepoSnapshot, initial: PrBundle) {
    this.bundle = initial;
  }
  get(): PrBundle {
    return this.bundle;
  }
  set(patch: Partial<PrBundle>): void {
    this.bundle = { ...this.bundle, ...patch };
  }
  with(patch: Partial<PrBundle>): PrBundle {
    return { ...this.bundle, ...patch };
  }
}

/** Original content of a path, or null for files the PR creates. */
export function baseContent(snapshot: RepoSnapshot, path: string): string | null {
  return snapshot.files[path] ?? null;
}

// ─── Diffs for the dashboard ──────────────────────────────────────────────

export interface FileDiff {
  path: string;
  status: "added" | "modified";
  added: number;
  removed: number;
  /** Hunks with up to 3 lines of context; "…" separates distant hunks. */
  lines: Array<{ type: "added" | "removed" | "context" | "gap"; text: string }>;
}

const CONTEXT = 3;

export function diffFile(path: string, before: string | null, after: string): FileDiff {
  const changes = computeLineDiff(before ?? "", after);
  const keep = new Set<number>();
  changes.forEach((c, i) => {
    if (c.type !== "unchanged") for (let j = i - CONTEXT; j <= i + CONTEXT; j++) keep.add(j);
  });
  const lines: FileDiff["lines"] = [];
  let lastKept = -1;
  changes.forEach((c, i) => {
    if (!keep.has(i)) return;
    if (lastKept !== -1 && i > lastKept + 1) lines.push({ type: "gap", text: "…" });
    lines.push({ type: c.type === "unchanged" ? "context" : c.type, text: c.content });
    lastKept = i;
  });
  return {
    path,
    status: before === null ? "added" : "modified",
    added: changes.filter((c) => c.type === "added").length,
    removed: changes.filter((c) => c.type === "removed").length,
    lines,
  };
}

export function diffBundle(snapshot: RepoSnapshot, bundle: PrBundle): FileDiff[] {
  return Object.entries({ ...bundle.code, ...bundle.docs })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => diffFile(path, baseContent(snapshot, path), content))
    .filter((d) => d.added + d.removed > 0);
}

/** PR description: first "# " line is the title, the rest is the body. */
export function splitPr(pr: string): { title: string; body: string } {
  const lines = pr.trim().split("\n");
  const titleLine = lines.find((l) => /^#\s+\S/.test(l)) ?? lines[0] ?? "";
  const title = titleLine.replace(/^#\s+/, "").trim();
  const body = lines.filter((l) => l !== titleLine).join("\n").trim();
  return { title, body };
}
