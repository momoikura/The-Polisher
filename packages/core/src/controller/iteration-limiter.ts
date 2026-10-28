/**
 * Iteration Limiter — enforces iteration and consecutive-rejection limits.
 *
 * The Controller consults this before each loop iteration to decide
 * whether the run should continue or stop.
 */

import type { RunConfig, RunStatus } from "../types/run.js";

/** Why the limiter wants to stop the run. */
export interface LimitCheckResult {
  shouldContinue: boolean;
  stopReason: RunStatus | null;
  message: string;
}

export class IterationLimiter {
  private readonly maxIterations: number;
  private readonly maxConsecutiveRejections: number;
  private currentIteration = 0;
  private consecutiveRejections = 0;

  constructor(config: RunConfig) {
    this.maxIterations = config.maxIterations;
    this.maxConsecutiveRejections = config.maxConsecutiveRejections;
  }

  /**
   * Record that an iteration completed. Call after each evaluate→test→gate cycle.
   */
  recordIteration(): void {
    this.currentIteration++;
  }

  /**
   * Record that the gate rejected a candidate.
   */
  recordRejection(): void {
    this.consecutiveRejections++;
  }

  /**
   * Record that the gate accepted a candidate. Resets the consecutive rejection counter.
   */
  recordAcceptance(): void {
    this.consecutiveRejections = 0;
  }

  /**
   * Check whether the run should continue.
   * Call BEFORE starting a new iteration.
   */
  check(): LimitCheckResult {
    if (this.currentIteration >= this.maxIterations) {
      return {
        shouldContinue: false,
        stopReason: "iteration_limited",
        message: `Iteration limit reached (${this.currentIteration}/${this.maxIterations}).`,
      };
    }

    if (this.consecutiveRejections >= this.maxConsecutiveRejections) {
      return {
        shouldContinue: false,
        stopReason: "stalled",
        message: `Stalled: ${this.consecutiveRejections} consecutive rejections (limit: ${this.maxConsecutiveRejections}).`,
      };
    }

    return {
      shouldContinue: true,
      stopReason: null,
      message: `Iteration ${this.currentIteration + 1}/${this.maxIterations}, consecutive rejections: ${this.consecutiveRejections}/${this.maxConsecutiveRejections}.`,
    };
  }

  /** Get the current iteration number (0-indexed). */
  getCurrentIteration(): number {
    return this.currentIteration;
  }

  /** Get the current consecutive rejection count. */
  getConsecutiveRejections(): number {
    return this.consecutiveRejections;
  }
}
