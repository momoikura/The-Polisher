/**
 * Tests for diff utilities.
 */

import { describe, it, expect } from "vitest";
import { computeLineDiff, formatUnifiedDiff, countChanges } from "../src/utils/diff.js";

describe("Diff utilities", () => {
  describe("computeLineDiff", () => {
    it("detects no changes for identical text", () => {
      const text = "line 1\nline 2\nline 3";
      const changes = computeLineDiff(text, text);

      const counts = countChanges(changes);
      expect(counts.added).toBe(0);
      expect(counts.removed).toBe(0);
      expect(counts.unchanged).toBe(3);
    });

    it("detects added lines", () => {
      const oldText = "line 1\nline 2";
      const newText = "line 1\nline 2\nline 3";
      const changes = computeLineDiff(oldText, newText);

      const counts = countChanges(changes);
      expect(counts.added).toBe(1);
      expect(counts.removed).toBe(0);
    });

    it("detects removed lines", () => {
      const oldText = "line 1\nline 2\nline 3";
      const newText = "line 1\nline 3";
      const changes = computeLineDiff(oldText, newText);

      const counts = countChanges(changes);
      expect(counts.removed).toBe(1);
    });

    it("diffs a large file with a small edit quickly, keeping line numbers right", () => {
      const lines = Array.from({ length: 20_000 }, (_, i) => `line ${i + 1}`);
      const edited = [...lines.slice(0, 9_999), "changed", ...lines.slice(10_000)];

      const started = Date.now();
      const changes = computeLineDiff(lines.join("\n"), edited.join("\n"));

      expect(Date.now() - started).toBeLessThan(1_000);
      expect(countChanges(changes)).toEqual({ added: 1, removed: 1, unchanged: 19_999 });
      expect(changes.find((c) => c.type === "removed")).toEqual({ type: "removed", content: "line 10000", lineNumber: 10_000 });
      expect(changes.find((c) => c.type === "added")).toEqual({ type: "added", content: "changed", lineNumber: 10_000 });
      expect(changes.at(-1)).toEqual({ type: "unchanged", content: "line 20000", lineNumber: 20_000 });
    });

    it("detects modifications (remove + add)", () => {
      const oldText = "hello world";
      const newText = "hello universe";
      const changes = computeLineDiff(oldText, newText);

      const counts = countChanges(changes);
      expect(counts.added).toBe(1);
      expect(counts.removed).toBe(1);
    });

    it("handles empty strings", () => {
      const changes = computeLineDiff("", "new content");
      const counts = countChanges(changes);
      expect(counts.added).toBeGreaterThan(0);
    });
  });

  describe("formatUnifiedDiff", () => {
    it("produces a readable diff output", () => {
      const changes = computeLineDiff("old line", "new line");
      const output = formatUnifiedDiff(changes);

      expect(output).toContain("---");
      expect(output).toContain("+++");
      expect(output).toContain("-old line");
      expect(output).toContain("+new line");
    });
  });
});
