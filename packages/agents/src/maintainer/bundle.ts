/**
 * The pull request the agents build, and the repo snapshot it is based on.
 *
 * Lane ownership:
 *   code  (CodePolish) → source + test files
 *   doc   (DocPolish)  → README / docs / CHANGELOG
 *   write (WritePolish)→ PR title + description
 *   security (SecurityPolish) → reviewer only: security of the code change, gates CodePolish
 */

import { z } from "zod";
import { computeLineDiff } from "@thepolisher/core";

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

/**
 * The files an agent may change: Python for CodePolish, docs for DocPolish, never config or CI.
 * With `existing` (the repo's paths), DocPolish may only edit docs the repo already has.
 */
export function ownedFiles<T>(lane: "code" | "doc", files: Record<string, T>, existing?: ReadonlySet<string>): Record<string, T> {
  const owns = (p: string) =>
    !isForbiddenPath(p) && (lane === "code" ? /\.pyi?$/.test(p) : isDocPath(p) && (!existing || existing.has(p)));
  return Object.fromEntries(Object.entries(files).filter(([p]) => owns(p)));
}

/** One note per file a revision touched but may not change, so the agent learns its edit was thrown away. */
export function discardNotes(lane: "code" | "doc", files: Record<string, unknown>, existing?: ReadonlySet<string>): string[] {
  const owned = ownedFiles(lane, files, existing);
  const rule = (p: string) =>
    lane === "code"
      ? "CodePolish may only change Python files (docs belong to DocPolish)"
      : isDocPath(p)
        ? "DocPolish may only edit docs that already exist in the repo"
        : "DocPolish may only change README/CHANGELOG-style docs";
  return Object.keys(files)
    .filter((p) => !(p in owned))
    .map((p) => `Discarded ${p}: ${rule(p)}`);
}

/** Whether a PR description names a file, by its path or its file name. */
export const mentionsFile = (body: string, path: string) => body.includes(path) || body.includes(path.split("/").pop()!);

/**
 * The PR description with any changed file it doesn't mention appended under "Files changed".
 * The list comes straight from the diff, so it is always accurate and the model's rounds go to
 * the parts that need judgement.
 */
export function ensureFilesListed(pr: string, changedPaths: readonly string[]): string {
  const missing = changedPaths.filter((p) => !mentionsFile(pr, p));
  if (missing.length === 0) return pr;
  return `${pr.trimEnd()}\n\n## Files changed\n${missing.map((p) => `- \`${p}\``).join("\n")}\n`;
}

/** Changelog-style files, which every user-visible fix should get an entry in. */
export const isChangelogPath = (p: string) => /(^|\/)(CHANGELOG|CHANGES|HISTORY|NEWS)(\.[a-z]+)?$/i.test(p);

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
