/**
 * Diff utility — word-level and line-level diffing for artifact versions.
 *
 * Provides human-readable diffs for the dashboard and changelogs.
 */

/**
 * A single diff change (line-level).
 */
export interface DiffChange {
  type: "added" | "removed" | "unchanged";
  content: string;
  lineNumber?: number;
}

/**
 * Compute a simple line-level diff between two strings.
 * Returns an array of changes suitable for rendering.
 *
 * NOTE: This is a minimal implementation for MVP. For production,
 * use the `diff` npm package for Myers diff algorithm.
 */
export function computeLineDiff(oldText: string, newText: string): DiffChange[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Lines both versions share at the start and end are unchanged, so the O(n*m) LCS
  // only runs on the middle. Edits to large files are local, which keeps that small.
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const changes: DiffChange[] = [];
  for (let i = 0; i < prefix; i++) changes.push({ type: "unchanged", content: oldLines[i], lineNumber: i + 1 });

  const a = oldLines.slice(prefix, oldLines.length - suffix);
  const b = newLines.slice(prefix, newLines.length - suffix);
  const lcs = buildLCSTable(a, b);
  for (const c of backtrackDiff(a, b, lcs)) changes.push({ ...c, lineNumber: c.lineNumber! + prefix });

  for (let k = suffix; k > 0; k--) {
    const i = oldLines.length - k;
    changes.push({ type: "unchanged", content: oldLines[i], lineNumber: i + 1 });
  }
  return changes;
}

function buildLCSTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const table: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

/** Walks the LCS table from the end (iteratively, so long inputs can't overflow the stack). */
function backtrackDiff(a: string[], b: string[], table: number[][]): DiffChange[] {
  const reversed: DiffChange[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      reversed.push({ type: "unchanged", content: a[i - 1], lineNumber: i });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      reversed.push({ type: "added", content: b[j - 1], lineNumber: j });
      j--;
    } else {
      reversed.push({ type: "removed", content: a[i - 1], lineNumber: i });
      i--;
    }
  }
  return reversed.reverse();
}

/**
 * Generate a unified diff string (similar to `git diff` output).
 */
export function formatUnifiedDiff(
  changes: DiffChange[],
  oldLabel = "previous",
  newLabel = "current"
): string {
  const lines: string[] = [`--- ${oldLabel}`, `+++ ${newLabel}`];

  for (const change of changes) {
    switch (change.type) {
      case "added":
        lines.push(`+${change.content}`);
        break;
      case "removed":
        lines.push(`-${change.content}`);
        break;
      case "unchanged":
        lines.push(` ${change.content}`);
        break;
    }
  }

  return lines.join("\n");
}

/**
 * Count the number of actual changes (additions + removals).
 */
export function countChanges(changes: DiffChange[]): {
  added: number;
  removed: number;
  unchanged: number;
} {
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const change of changes) {
    switch (change.type) {
      case "added":
        added++;
        break;
      case "removed":
        removed++;
        break;
      case "unchanged":
        unchanged++;
        break;
    }
  }

  return { added, removed, unchanged };
}
