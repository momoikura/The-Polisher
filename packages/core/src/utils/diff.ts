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
  const changes: DiffChange[] = [];

  // Simple LCS-based diff (O(n*m) — fine for artifacts under 10k lines)
  const lcs = buildLCSTable(oldLines, newLines);
  backtrackDiff(oldLines, newLines, lcs, oldLines.length, newLines.length, changes);

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

function backtrackDiff(
  a: string[],
  b: string[],
  table: number[][],
  i: number,
  j: number,
  changes: DiffChange[]
): void {
  if (i === 0 && j === 0) return;

  if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
    backtrackDiff(a, b, table, i - 1, j - 1, changes);
    changes.push({ type: "unchanged", content: a[i - 1], lineNumber: i });
  } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
    backtrackDiff(a, b, table, i, j - 1, changes);
    changes.push({ type: "added", content: b[j - 1], lineNumber: j });
  } else if (i > 0) {
    backtrackDiff(a, b, table, i - 1, j, changes);
    changes.push({ type: "removed", content: a[i - 1], lineNumber: i });
  }
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
