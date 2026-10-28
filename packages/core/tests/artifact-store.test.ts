/**
 * Tests for the FileArtifactStore.
 *
 * Verifies:
 * 1. Content is saved and readable
 * 2. Content hashing is consistent
 * 3. Version numbering in filenames
 * 4. Path traversal attacks are blocked
 * 5. Invalid characters in runId are rejected
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FileArtifactStore } from "../src/store/artifact-store.js";
import { sha256 } from "../src/utils/hash.js";

const TEST_STORE_ROOT = join(process.cwd(), "test-artifacts-tmp");

describe("FileArtifactStore", () => {
  let store: FileArtifactStore;

  beforeEach(() => {
    rmSync(TEST_STORE_ROOT, { recursive: true, force: true });
    store = new FileArtifactStore(TEST_STORE_ROOT);
  });

  afterEach(() => {
    rmSync(TEST_STORE_ROOT, { recursive: true, force: true });
  });

  describe("saveVersion", () => {
    it("saves content to the filesystem and returns version metadata", () => {
      const content = "# Hello World\n\nThis is a test.";
      const version = store.saveVersion(
        "run-001",
        0,
        content,
        "text/markdown",
        "generated"
      );

      expect(version.id).toBeTruthy();
      expect(version.runId).toBe("run-001");
      expect(version.versionNumber).toBe(0);
      expect(version.contentHash).toBe(sha256(content));
      expect(version.contentPath).toContain("v000.md");
      expect(version.contentType).toBe("text/markdown");
      expect(version.source).toBe("generated");
      expect(version.isBest).toBe(false);
    });

    it("creates correct file extension for each content type", () => {
      const types: Record<string, string> = {
        "text/markdown": ".md",
        "text/html": ".html",
        "text/plain": ".txt",
        "application/javascript": ".js",
        "text/css": ".css",
        "application/json": ".json",
      };

      let i = 0;
      for (const [contentType, ext] of Object.entries(types)) {
        const version = store.saveVersion(
          "run-ext-test",
          i++,
          "content",
          contentType,
          "generated"
        );
        expect(version.contentPath).toContain(ext);
      }
    });

    it("zero-pads version numbers in filenames", () => {
      const v0 = store.saveVersion("run-pad", 0, "v0", "text/plain", "generated");
      const v5 = store.saveVersion("run-pad", 5, "v5", "text/plain", "generated");
      const v99 = store.saveVersion("run-pad", 99, "v99", "text/plain", "generated");

      expect(v0.contentPath).toContain("v000");
      expect(v5.contentPath).toContain("v005");
      expect(v99.contentPath).toContain("v099");
    });
  });

  describe("getContent", () => {
    it("reads back saved content correctly", () => {
      const content = "function hello() { return 42; }";
      const version = store.saveVersion(
        "run-read",
        0,
        content,
        "application/javascript",
        "generated"
      );

      const retrieved = store.getContent(version);
      expect(retrieved).toBe(content);
    });

    it("throws for non-existent content", () => {
      expect(() =>
        store.getContent({
          id: "fake",
          runId: "run-fake",
          versionNumber: 0,
          contentHash: "abc",
          contentPath: "runs/run-fake/v000.txt",
          contentType: "text/plain",
          isBest: false,
          source: "generated",
          createdAt: new Date().toISOString(),
        })
      ).toThrow(/not found/);
    });
  });

  describe("Security: path traversal prevention", () => {
    it("rejects runId containing path separators", () => {
      expect(() =>
        store.saveVersion("../evil", 0, "hack", "text/plain", "generated")
      ).toThrow(/invalid characters/i);
    });

    it("rejects runId containing backslashes", () => {
      expect(() =>
        store.saveVersion("..\\evil", 0, "hack", "text/plain", "generated")
      ).toThrow(/invalid characters/i);
    });

    it("rejects runId that is '..'", () => {
      expect(() =>
        store.saveVersion("..", 0, "hack", "text/plain", "generated")
      ).toThrow();
    });

    it("rejects runId that is '.'", () => {
      expect(() =>
        store.saveVersion(".", 0, "hack", "text/plain", "generated")
      ).toThrow();
    });

    it("rejects empty runId", () => {
      expect(() =>
        store.saveVersion("", 0, "hack", "text/plain", "generated")
      ).toThrow(/must not be empty/i);
    });

    it("rejects runId with special characters", () => {
      const badIds = ['run:evil', 'run*bad', 'run?"bad"', 'run<bad>', 'run|bad'];
      for (const id of badIds) {
        expect(() =>
          store.saveVersion(id, 0, "hack", "text/plain", "generated")
        ).toThrow(/invalid characters/i);
      }
    });
  });

  describe("Content deduplication", () => {
    it("detects when identical content already exists", () => {
      const content = "duplicate content";
      store.saveVersion("run-dup", 0, content, "text/plain", "generated");

      const exists = store.contentExists("run-dup", sha256(content));
      expect(exists).toBe(true);
    });

    it("returns false for non-existent content", () => {
      store.saveVersion("run-dup2", 0, "original", "text/plain", "generated");

      const exists = store.contentExists("run-dup2", sha256("different content"));
      expect(exists).toBe(false);
    });

    it("returns false for non-existent run", () => {
      const exists = store.contentExists("nonexistent-run", sha256("anything"));
      expect(exists).toBe(false);
    });
  });
});
