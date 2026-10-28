/**
 * Tests for the Iteration Limiter.
 *
 * Verifies:
 * 1. Allows iterations up to the max
 * 2. Stops at iteration limit
 * 3. Stops after consecutive rejections
 * 4. Resets rejection counter on acceptance
 */

import { describe, it, expect } from "vitest";
import { IterationLimiter } from "../src/controller/iteration-limiter.js";
import { DEFAULT_RUN_CONFIG } from "../src/types/run.js";

describe("IterationLimiter", () => {
  it("allows the first iteration", () => {
    const limiter = new IterationLimiter(DEFAULT_RUN_CONFIG);
    const check = limiter.check();

    expect(check.shouldContinue).toBe(true);
    expect(check.stopReason).toBeNull();
  });

  it("stops at iteration limit", () => {
    const limiter = new IterationLimiter({
      ...DEFAULT_RUN_CONFIG,
      maxIterations: 3,
    });

    // Simulate 3 iterations
    limiter.recordIteration();
    limiter.recordIteration();
    limiter.recordIteration();

    const check = limiter.check();
    expect(check.shouldContinue).toBe(false);
    expect(check.stopReason).toBe("iteration_limited");
  });

  it("allows iteration right before the limit", () => {
    const limiter = new IterationLimiter({
      ...DEFAULT_RUN_CONFIG,
      maxIterations: 3,
    });

    limiter.recordIteration();
    limiter.recordIteration();

    const check = limiter.check();
    expect(check.shouldContinue).toBe(true);
  });

  it("stops after maxConsecutiveRejections", () => {
    const limiter = new IterationLimiter({
      ...DEFAULT_RUN_CONFIG,
      maxConsecutiveRejections: 2,
    });

    limiter.recordRejection();
    limiter.recordRejection();

    const check = limiter.check();
    expect(check.shouldContinue).toBe(false);
    expect(check.stopReason).toBe("stalled");
  });

  it("resets consecutive rejections on acceptance", () => {
    const limiter = new IterationLimiter({
      ...DEFAULT_RUN_CONFIG,
      maxConsecutiveRejections: 3,
    });

    limiter.recordRejection();
    limiter.recordRejection();
    // 2 rejections, then an acceptance
    limiter.recordAcceptance();

    expect(limiter.getConsecutiveRejections()).toBe(0);

    // Should still be able to continue
    const check = limiter.check();
    expect(check.shouldContinue).toBe(true);
  });

  it("tracks current iteration correctly", () => {
    const limiter = new IterationLimiter(DEFAULT_RUN_CONFIG);

    expect(limiter.getCurrentIteration()).toBe(0);
    limiter.recordIteration();
    expect(limiter.getCurrentIteration()).toBe(1);
    limiter.recordIteration();
    expect(limiter.getCurrentIteration()).toBe(2);
  });

  it("iteration limit takes priority over rejection limit", () => {
    const limiter = new IterationLimiter({
      ...DEFAULT_RUN_CONFIG,
      maxIterations: 2,
      maxConsecutiveRejections: 5,
    });

    limiter.recordIteration();
    limiter.recordIteration();

    const check = limiter.check();
    expect(check.shouldContinue).toBe(false);
    expect(check.stopReason).toBe("iteration_limited");
  });
});
