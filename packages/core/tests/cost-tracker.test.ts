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

    // gpt-4o: $2.50/1M input, $10/1M output
    const cost = tracker.recordCall("generator", "gpt-4o", 1000, 500);

    // Expected: (1000 * 2.5 + 500 * 10) / 1_000_000 = (2500 + 5000) / 1_000_000 = 0.0075
    expect(cost).toBeCloseTo(0.0075, 4);
    expect(tracker.getTotalCost()).toBeCloseTo(0.0075, 4);
  });

  it("uses default pricing for unknown models", () => {
    const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: 10 });

    // Unknown model: $5/1M input, $15/1M output (conservative defaults)
    const cost = tracker.recordCall("generator", "unknown-model-xyz", 1000, 500);

    // Expected: (1000 * 5 + 500 * 15) / 1_000_000 = (5000 + 7500) / 1_000_000 = 0.0125
    expect(cost).toBeCloseTo(0.0125, 4);
  });

  it("accumulates costs across multiple calls", () => {
    const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: 10 });

    tracker.recordCall("generator", "gpt-4o-mini", 2000, 1000);
    tracker.recordCall("evaluator", "gpt-4o-mini", 1500, 800);
    tracker.recordCall("repairer", "gpt-4o-mini", 2000, 1200);

    const status = tracker.getStatus();
    expect(status.totalCostUSD).toBeGreaterThan(0);
    expect(status.records).toHaveLength(3);
  });

  it("detects when budget is exhausted", () => {
    const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: 0.001 });

    // This call will exceed the tiny budget
    tracker.recordCall("generator", "gpt-4o", 100_000, 50_000);

    expect(tracker.canAffordCall()).toBe(false);
    expect(tracker.getStatus().isOverBudget).toBe(true);
  });

  it("triggers warning at 80% utilization", () => {
    const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: 0.01 });

    // gpt-4o: push past 80% of $0.01
    tracker.recordCall("generator", "gpt-4o", 1000, 500);
    // Cost ≈ $0.0075 = 75% of $0.01 — not yet warning

    const statusBefore = tracker.getStatus();
    expect(statusBefore.isWarning).toBe(false);

    // Another small call should push past 80%
    tracker.recordCall("evaluator", "gpt-4o", 200, 100);

    const statusAfter = tracker.getStatus();
    expect(statusAfter.isWarning).toBe(true);
  });

  it("can still afford a call when under budget", () => {
    const tracker = new CostTracker({ ...DEFAULT_RUN_CONFIG, maxCostUSD: 10 });
    tracker.recordCall("generator", "gpt-4o-mini", 1000, 500);

    expect(tracker.canAffordCall()).toBe(true);
  });

  it("records accurate timestamps on each call", () => {
    const tracker = new CostTracker(DEFAULT_RUN_CONFIG);
    tracker.recordCall("generator", "gpt-4o", 100, 50);

    const status = tracker.getStatus();
    expect(status.records[0].timestamp).toBeTruthy();
    expect(new Date(status.records[0].timestamp).getTime()).not.toBeNaN();
  });
});
