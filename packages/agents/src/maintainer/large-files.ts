/**
 * Large files. A file over MAX_FILE_CHARS is loaded in full on the server but
 * shown to the model as an excerpt (its header, the definitions the planner and
 * the issue name, and the lines around changes already made). The model changes
 * it through exact find/replace edits that the server applies; an edit is only
 * applied when its find text matches exactly once. Everything downstream (diffs,
 * checks, the sandbox, the PR) still works on whole files.
 */

import { z } from "zod";
import { computeLineDiff } from "@thepolisher/core";

/** Files up to this size are shown whole; agents may return them with full contents. */
export const MAX_FILE_CHARS = 40_000;
/** Largest file loaded at all: the sandbox's per-file limit. */
export const MAX_LARGE_FILE_CHARS = 200_000;
/** Budget for one excerpt in a prompt. */
export const EXCERPT_CHARS = 24_000;

const HEADER_LINES_CODE = 40;
const HEADER_LINES_DOCS = 80;
const CONTEXT_LINES = 12;
const MENTIONS_PER_SYMBOL = 5;

export const isLarge = (content: string) => content.length > MAX_FILE_CHARS;

export const FileEditSchema = z.object({
  path: z.string().min(1),
  find: z.string().min(1),
  replace: z.string(),
});
export type FileEdit = z.infer<typeof FileEditSchema>;

// ─── Excerpts ─────────────────────────────────────────────────────────────

type Range = [start: number, end: number];

const indentOf = (line: string) => line.length - line.trimStart().length;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A def/class from its decorators to the end of its body (by indentation). */
function definitionBlock(lines: string[], at: number): Range {
  const indent = indentOf(lines[at]);
  let start = at;
  while (start > 0 && lines[start - 1].trim().startsWith("@") && indentOf(lines[start - 1]) === indent) start--;
  // The signature may span lines; the body starts after the line that ends it with ":".
  let end = at;
  while (end < lines.length - 1 && !/:\s*(#.*)?$/.test(lines[end])) end++;
  end++;
  while (end < lines.length && (lines[end].trim() === "" || indentOf(lines[end]) > indent)) end++;
  return [start, end];
}

function symbolRanges(lines: string[], symbol: string): Range[] {
  const def = new RegExp(`^\\s*(async\\s+def|def|class)\\s+${escape(symbol)}\\b`);
  const defs = lines.flatMap((l, i) => (def.test(l) ? [definitionBlock(lines, i)] : []));
  if (defs.length) return defs;
  const word = new RegExp(`\\b${escape(symbol)}\\b`);
  return lines
    .flatMap((l, i) => (word.test(l) ? [i] : []))
    .slice(0, MENTIONS_PER_SYMBOL)
    .map((i): Range => [i - CONTEXT_LINES, i + CONTEXT_LINES + 1]);
}

function merge(ranges: Range[], total: number): Range[] {
  const sorted = ranges.map(([s, e]): Range => [Math.max(0, s), Math.min(total, e)]).sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

const size = (lines: string[], [s, e]: Range) => lines.slice(s, e).reduce((n, l) => n + l.length + 1, 0);

/**
 * An excerpt of a large file. `changedLines` are 1-based line numbers in `content`
 * (e.g. lines a previous revision changed), shown with context.
 */
export function excerpt(content: string, focus: readonly string[], changedLines: readonly number[] = [], isDoc = false): string {
  const lines = content.split("\n");
  // In priority order; ranges are added until the budget runs out.
  const wanted: Range[] = [
    [0, isDoc ? HEADER_LINES_DOCS : HEADER_LINES_CODE],
    ...changedLines.map((n): Range => [n - 1 - CONTEXT_LINES, n + CONTEXT_LINES]),
    ...focus.flatMap((s) => symbolRanges(lines, s)),
  ];
  const kept: Range[] = [];
  let used = 0;
  for (const r of wanted) {
    const [clipped] = merge([r], lines.length);
    if (!clipped) continue;
    const cost = size(lines, clipped);
    if (used + cost > EXCERPT_CHARS) continue;
    kept.push(clipped);
    used += cost;
  }

  const parts: string[] = [];
  let shown = 0;
  for (const [s, e] of merge(kept, lines.length)) {
    if (s > shown) parts.push(`⋯ lines ${shown + 1}-${s} not shown ⋯`);
    parts.push(lines.slice(s, e).join("\n"));
    shown = e;
  }
  if (shown < lines.length) parts.push(`⋯ lines ${shown + 1}-${lines.length} not shown ⋯`);
  return parts.join("\n");
}

/** 1-based line numbers in `current` that differ from `base`. */
export function changedLineNumbers(base: string | null, current: string): number[] {
  if (base === null || base === current) return [];
  return computeLineDiff(base, current).flatMap((c) => (c.type === "added" ? [c.lineNumber!] : []));
}

/** Code names the issue mentions: backticked identifiers and names followed by "(". */
export function issueSymbols(title: string, body: string): string[] {
  const text = `${title}\n${body}`;
  const backticked = [...text.matchAll(/`([A-Za-z_][\w.]*)(?:\(\S*\))?`/g)].map((m) => m[1].split(".").pop()!);
  const called = [...text.matchAll(/\b([A-Za-z_]\w{2,})\(/g)].map((m) => m[1]);
  return [...new Set([...backticked, ...called])].filter((s) => s.length >= 3).slice(0, 20);
}

// ─── Edits ────────────────────────────────────────────────────────────────

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) count++;
  return count;
}

/**
 * Applies edits to whole files. Returns only the files that changed, plus one
 * note per skipped edit, written for the agent so its next attempt can fix it.
 */
export function applyEdits(files: Readonly<Record<string, string>>, edits: readonly FileEdit[]): { files: Record<string, string>; notes: string[] } {
  const out: Record<string, string> = {};
  const notes: string[] = [];
  for (const e of edits) {
    const content = out[e.path] ?? files[e.path];
    if (content === undefined) {
      notes.push(`Skipped an edit to ${e.path}: that file wasn't loaded, so it can't be edited`);
      continue;
    }
    const n = occurrences(content, e.find);
    if (n !== 1) {
      notes.push(
        n === 0
          ? `Skipped an edit to ${e.path}: its find text isn't in the file. Copy it exactly from the file shown, including indentation`
          : `Skipped an edit to ${e.path}: its find text matches ${n} places. Include more surrounding lines so it matches exactly once`
      );
      continue;
    }
    const at = content.indexOf(e.find);
    out[e.path] = content.slice(0, at) + e.replace + content.slice(at + e.find.length);
  }
  return { files: out, notes };
}
