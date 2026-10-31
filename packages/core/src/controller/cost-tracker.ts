/**
 * Cost Tracker — monitors cumulative LLM spend for a run.
 *
 * Tracks per-call costs and enforces the run's budget limit.
 * Token counts and cost estimates are recorded but API keys are never logged.
 */

import type { RunConfig } from "../types/run.js";

/** A single LLM API call's cost record. */
export interface CostRecord {
  agentRole: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUSD: number;
  timestamp: string;
}

/** Cost status for a run. */
export interface CostStatus {
  totalCostUSD: number;
  budgetUSD: number;
  remainingUSD: number;
  utilizationPercent: number;
  isOverBudget: boolean;
  isWarning: boolean;
  records: CostRecord[];
}

/**
 * Approximate cost per 1M tokens by model.
 * These are rough estimates — actual pricing may vary.
 * Update as pricing changes.
 */
const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  // Meta Model API (dev.meta.ai/models/muse-spark, 2026-10). Cached input ($0.15) isn't tracked separately.
  "muse-spark-1.3": { input: 1.25, output: 4.25 },
  "muse-spark-1.3-contributor": { input: 0.1, output: 0.2 },
  // Scripted demo client: no real spend.
  simulated: { input: 0, output: 0 },
};

/** Default cost for unknown models (conservative estimate). */
const DEFAULT_COST_PER_MILLION = { input: 5.0, output: 15.0 };

export class CostTracker {
  private records: CostRecord[] = [];
  private totalCostUSD = 0;
  private readonly budgetUSD: number;
  private readonly warningThreshold: number;

  constructor(config: RunConfig) {
    this.budgetUSD = config.maxCostUSD;
    this.warningThreshold = 0.8; // 80% of budget
  }

  /**
   * Record an LLM API call and update the running total.
   * Returns the estimated cost of this call.
   */
  recordCall(
    agentRole: string,
    model: string,
    promptTokens: number,
    completionTokens: number
  ): number {
    const pricing = COST_PER_MILLION_TOKENS[model] ?? DEFAULT_COST_PER_MILLION;
    const estimatedCostUSD =
      (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;

    const record: CostRecord = {
      agentRole,
      model,
      promptTokens,
      completionTokens,
      estimatedCostUSD,
      timestamp: new Date().toISOString(),
    };

    this.records.push(record);
    this.totalCostUSD += estimatedCostUSD;

    return estimatedCostUSD;
  }

  /**
   * Check if the budget allows another LLM call.
   * Should be called by the Controller BEFORE dispatching an agent.
   */
  canAffordCall(): boolean {
    return this.totalCostUSD < this.budgetUSD;
  }

  /**
   * Get the current cost status for the run.
   */
  getStatus(): CostStatus {
    const remaining = Math.max(0, this.budgetUSD - this.totalCostUSD);
    const utilization =
      this.budgetUSD > 0 ? this.totalCostUSD / this.budgetUSD : 0;

    return {
      totalCostUSD: this.totalCostUSD,
      budgetUSD: this.budgetUSD,
      remainingUSD: remaining,
      utilizationPercent: utilization * 100,
      isOverBudget: this.totalCostUSD >= this.budgetUSD,
      isWarning: utilization >= this.warningThreshold,
      records: [...this.records],
    };
  }

  /**
   * Get the total cost accumulated so far.
   */
  getTotalCost(): number {
    return this.totalCostUSD;
  }
}
