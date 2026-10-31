/**
 * Tests for the Cost Tracker.
 *
 * Verifies:
 * 1. Cost estimation from token counts
 * 2. Budget enforcement
 * 3. Warning threshold detection
 * 4. Multi-call accumulation
 * 5. Unknown model fallback pricing
 */

import { describe, it, expect } from "vitest";
import { CostTracker } from "../src/controller/cost-tracker.js";
import { DEFAULT_RUN_CONFIG } from "../src/types/run.js";

describe("CostTracker", () => {
  it("starts with zero cost", () => {
    const tracker = new CostTracker(DEFAULT_RUN_CONFIG);
    const status = tracker.getStatus();

    expect(status.totalCostUSD).toBe(0);
    expect(status.budgetUSD).toBe(DEFAULT_RUN_CONFIG.maxCostUSD);
    expect(status.isOverBudget).toBe(false);
    expect(status.isWarning).toBe(false);
  });

  it("calculates cost from token counts using known model pricing", () => {
    const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: 10 });

    // muse-spark-1.3-contributor: $0.10/1M input, $0.20/1M output
    const cost = tracker.recordCall("generator", "muse-spark-1.3-contributor", 1000, 500);

    // Expected: (1000 * 0.1 + 500 * 0.2) / 1_000_000 = 0.0002
    expect(cost).toBeCloseTo(0.0002, 6);
    expect(tracker.getTotalCost()).toBeCloseTo(0.0002, 6);
  });

  it("uses default pricing for unknown models", () => {
    const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: 10 });

    // Unknown model: $5/1M input, $15/1M output (conservative defaults)
    const cost = tracker.recordCall("generator", "unknown-model-xyz", 1000, 500);

    // Expected: (1000 * 5 + 500 * 15) / 1_000_000 = (5000 + 7500) / 1_000_000 = 0.0125
    expect(cost).toBeCloseTo(0.0125, 4);
  });

  it("prices Muse Spark at Meta's published rate", () => {
    const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: 10 });

    // $1.25/1M input, $4.25/1M output: (1000 * 1.25 + 500 * 4.25) / 1_000_000 = 0.003375
    const cost = tracker.recordCall("generator", "muse-spark-1.3", 1000, 500);

    expect(cost).toBeCloseTo(0.003375, 6);
  });

  it("accumulates costs across multiple calls", () => {
    const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: 10 });

    tracker.recordCall("generator", "muse-spark-1.3-contributor", 2000, 1000);
    tracker.recordCall("evaluator", "muse-spark-1.3-contributor", 1500, 800);
    tracker.recordCall("repairer", "muse-spark-1.3-contributor", 2000, 1200);

    const status = tracker.getStatus();
    expect(status.totalCostUSD).toBeGreaterThan(0);
    expect(status.records).toHaveLength(3);
  });

  it("detects when budget is exhausted", () => {
    const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: 0.001 });

    // This call will exceed the tiny budget
    tracker.recordCall("generator", "muse-spark-1.3", 100_000, 50_000);

    expect(tracker.canAffordCall()).toBe(false);
    expect(tracker.getStatus().isOverBudget).toBe(true);
  });

  it("triggers warning at 80% utilization", () => {
    const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: 0.0045 });

    // muse-spark-1.3: push past 80% of $0.0045
    tracker.recordCall("generator", "muse-spark-1.3", 1000, 500);
    // Cost = $0.003375 = 75% of the budget, not yet a warning

    const statusBefore = tracker.getStatus();
    expect(statusBefore.isWarning).toBe(false);

    // Another small call should push past 80%
    tracker.recordCall("evaluator", "muse-spark-1.3", 200, 100);

    const statusAfter = tracker.getStatus();
    expect(statusAfter.isWarning).toBe(true);
  });

  it("can still afford a call when under budget", () => {
    const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: 10 });
    tracker.recordCall("generator", "muse-spark-1.3-contributor", 1000, 500);

    expect(tracker.canAffordCall()).toBe(true);
  });

  it("records accurate timestamps on each call", () => {
    const tracker = new CostTracker(DEFAULT_RUN_CONFIG);
    tracker.recordCall("generator", "muse-spark-1.3", 100, 50);

    const status = tracker.getStatus();
    expect(status.records[0].timestamp).toBeTruthy();
    expect(new Date(status.records[0].timestamp).getTime()).not.toBeNaN();
  });
});
