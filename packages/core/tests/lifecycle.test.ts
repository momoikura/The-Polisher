/**
 * Tests for PolishLoop Run Lifecycle Manager.
 *
 * Verifies:
 * 1. Initial run status is 'queued'
 * 2. Transition from 'queued' to 'running'
 * 3. Transition from 'running' to 'completed'
 * 4. Transition from 'running' to 'quality_target_not_reached'
 * 5. Transition to 'failed'
 * 6. Illegal state transitions are rejected
 * 7. Progress tracking updates iteration and cost metrics
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  RunLifecycleManager,
  InvalidStateTransitionError,
  RunNotFoundError,
} from "../src/lifecycle/run-lifecycle.js";

describe("RunLifecycleManager", () => {
  let manager: RunLifecycleManager;

  beforeEach(() => {
    manager = new RunLifecycleManager();
  });

  describe("Run creation & Initial State", () => {
    it("creates a new run with status 'queued'", () => {
      const run = manager.createRun({
        mode: "writing",
        prompt: "Draft an essay on clean code.",
      });

      expect(run.id).toBeTruthy();
      expect(run.status).toBe("queued");
      expect(run.mode).toBe("writing");
      expect(run.prompt).toBe("Draft an essay on clean code.");
      expect(run.totalCostUSD).toBe(0);
      expect(run.totalIterations).toBe(0);
      expect(run.currentIteration).toBe(0);
      expect(run.bestVersionId).toBeNull();
      expect(run.completedAt).toBeNull();
    });

    it("rejects empty prompt on creation", () => {
      expect(() =>
        manager.createRun({
          mode: "code",
          prompt: "",
        })
      ).toThrow();
    });

    it("stores and retrieves run by ID", () => {
      const run = manager.createRun({
        mode: "ui",
        prompt: "Build an accessible modal component.",
      });

      const retrieved = manager.getRun(run.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(run.id);
    });

    it("throws RunNotFoundError when looking up nonexistent run with getRunOrThrow", () => {
      expect(() => manager.getRunOrThrow("nonexistent-id")).toThrow(RunNotFoundError);
    });
  });

  describe("Lifecycle Transitions", () => {
    it("transitions from queued to running", () => {
      const run = manager.createRun({
        mode: "code",
        prompt: "Implement binary search",
      });

      const runningRun = manager.startRun(run.id);
      expect(runningRun.status).toBe("running");
    });

    it("transitions from running to completed when target is met", () => {
      const run = manager.createRun({
        mode: "writing",
        prompt: "Polish product announcement",
      });

      manager.startRun(run.id);
      const completedRun = manager.completeRun(run.id, "version-001");

      expect(completedRun.status).toBe("completed");
      expect(completedRun.bestVersionId).toBe("version-001");
      expect(completedRun.completedAt).toBeTruthy();
    });

    it("transitions from running to quality_target_not_reached", () => {
      const run = manager.createRun({
        mode: "presentation",
        prompt: "Quarterly slide deck",
      });

      manager.startRun(run.id);
      const stoppedRun = manager.markQualityNotReached(
        run.id,
        "Max iterations reached without achieving citation density target"
      );

      expect(stoppedRun.status).toBe("quality_target_not_reached");
      expect(stoppedRun.errorMessage).toContain("Max iterations reached");
      expect(stoppedRun.completedAt).toBeTruthy();
    });

    it("transitions to failed with error message", () => {
      const run = manager.createRun({
        mode: "ui",
        prompt: "Complex data grid",
      });

      manager.startRun(run.id);
      const failedRun = manager.failRun(run.id, new Error("API rate limit exceeded permanently"));

      expect(failedRun.status).toBe("failed");
      expect(failedRun.errorMessage).toBe("API rate limit exceeded permanently");
      expect(failedRun.completedAt).toBeTruthy();
    });
  });

  describe("Invalid State Transitions Enforcement", () => {
    it("rejects transition from queued directly to completed", () => {
      const run = manager.createRun({
        mode: "code",
        prompt: "Quick test",
      });

      expect(() => manager.completeRun(run.id)).toThrow(InvalidStateTransitionError);
    });

    it("rejects transition from terminal status 'completed' back to 'running'", () => {
      const run = manager.createRun({
        mode: "writing",
        prompt: "Quick test",
      });

      manager.startRun(run.id);
      manager.completeRun(run.id);

      expect(() => manager.startRun(run.id)).toThrow(InvalidStateTransitionError);
    });

    it("rejects transition from terminal status 'failed' to 'completed'", () => {
      const run = manager.createRun({
        mode: "code",
        prompt: "Quick test",
      });

      manager.failRun(run.id, "Fatal error");
      expect(() => manager.completeRun(run.id)).toThrow(InvalidStateTransitionError);
    });
  });

  describe("Progress Tracking", () => {
    it("updates iterations and cost metrics during running status", () => {
      const run = manager.createRun({
        mode: "code",
        prompt: "Optimize matrix multiplication",
      });

      manager.startRun(run.id);
      manager.updateProgress(run.id, {
        iteration: 1,
        costIncrementUSD: 0.005,
        bestVersionId: "v-001",
      });

      const updated = manager.getRunOrThrow(run.id);
      expect(updated.currentIteration).toBe(1);
      expect(updated.totalIterations).toBe(1);
      expect(updated.totalCostUSD).toBeCloseTo(0.005);
      expect(updated.bestVersionId).toBe("v-001");
    });

    it("rejects progress updates once run has reached a terminal state", () => {
      const run = manager.createRun({
        mode: "writing",
        prompt: "Short post",
      });

      manager.startRun(run.id);
      manager.completeRun(run.id);

      expect(() =>
        manager.updateProgress(run.id, { iteration: 2, costIncrementUSD: 0.01 })
      ).toThrow(/terminal status/i);
    });
  });

  describe("Listing and Filtering Runs", () => {
    it("lists runs filtered by mode", () => {
      manager.createRun({ mode: "writing", prompt: "Post 1" });
      manager.createRun({ mode: "code", prompt: "Function 1" });
      manager.createRun({ mode: "writing", prompt: "Post 2" });

      const writingRuns = manager.listRuns({ mode: "writing" });
      expect(writingRuns.length).toBe(2);

      const codeRuns = manager.listRuns({ mode: "code" });
      expect(codeRuns.length).toBe(1);
    });
  });
});
