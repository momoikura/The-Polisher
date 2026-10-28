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
