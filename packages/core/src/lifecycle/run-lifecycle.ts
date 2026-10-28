/**
 * Run Lifecycle Manager — manages state transitions for PolishLoop runs.
 *
 * Implements the lifecycle:
 * queued -> running -> completed | quality_target_not_reached | failed
 */

import { ulid } from "ulid";
import {
  type Run,
  type RunStatus,
  type CreateRunInput,
  type ArtifactMode,
  DEFAULT_RUN_CONFIG,
  CreateRunInputSchema,
  isValidRunTransition,
  isTerminalRunStatus,
} from "../types/run.js";

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly runId: string,
    public readonly currentStatus: RunStatus,
    public readonly targetStatus: RunStatus
  ) {
    super(
      `Cannot transition run "${runId}" from "${currentStatus}" to "${targetStatus}". Invalid lifecycle transition.`
    );
    this.name = "InvalidStateTransitionError";
  }
}

export class RunNotFoundError extends Error {
  constructor(public readonly runId: string) {
    super(`Run with id "${runId}" not found.`);
    this.name = "RunNotFoundError";
  }
}

export class RunLifecycleManager {
  private runs: Map<string, Run> = new Map();

  /**
   * Create a new polishing run in the initial "queued" state.
   */
  public createRun(input: CreateRunInput): Run {
    const validated = CreateRunInputSchema.parse(input);
    const now = new Date().toISOString();
    const id = ulid();

    const run: Run = {
      id,
      mode: validated.mode,
      status: "queued",
      prompt: validated.prompt,
      config: {
        ...DEFAULT_RUN_CONFIG,
        ...(validated.config ?? {}),
      },
      totalCostUSD: 0,
      totalIterations: 0,
      currentIteration: 0,
      consecutiveRejections: 0,
      bestVersionId: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      errorMessage: null,
    };

    this.runs.set(id, run);
    return run;
  }

  /**
   * Transition run from "queued" to "running".
   */
  public startRun(runId: string): Run {
    return this.transitionStatus(runId, "running");
  }

  /**
   * Transition run from "running" to "completed" (quality target reached).
   */
  public completeRun(runId: string, bestVersionId?: string): Run {
    const run = this.transitionStatus(runId, "completed");
    run.completedAt = new Date().toISOString();
    if (bestVersionId) {
      run.bestVersionId = bestVersionId;
    }
    return run;
  }

  /**
   * Transition run to "quality_target_not_reached" (limits hit or stalled).
   */
  public markQualityNotReached(runId: string, reason?: string): Run {
    const run = this.transitionStatus(runId, "quality_target_not_reached");
    run.completedAt = new Date().toISOString();
    if (reason) {
      run.errorMessage = reason;
    }
    return run;
  }

  /**
   * Transition run to "failed" on unrecoverable error.
   */
  public failRun(runId: string, error: Error | string): Run {
    const message = error instanceof Error ? error.message : String(error);
    const run = this.transitionStatus(runId, "failed");
    run.completedAt = new Date().toISOString();
    run.errorMessage = message;
    return run;
  }

  /**
   * Update run metrics during execution.
   */
  public updateProgress(
    runId: string,
    updates: {
      iteration?: number;
      costIncrementUSD?: number;
      bestVersionId?: string;
      consecutiveRejections?: number;
    }
  ): Run {
    const run = this.getRunOrThrow(runId);
    if (isTerminalRunStatus(run.status)) {
      throw new Error(`Cannot update progress for run "${runId}" in terminal status "${run.status}"`);
    }

    if (updates.iteration !== undefined) {
      run.currentIteration = updates.iteration;
      run.totalIterations = Math.max(run.totalIterations, updates.iteration);
    }
    if (updates.costIncrementUSD !== undefined) {
      run.totalCostUSD += updates.costIncrementUSD;
    }
    if (updates.bestVersionId !== undefined) {
      run.bestVersionId = updates.bestVersionId;
    }
    if (updates.consecutiveRejections !== undefined) {
      run.consecutiveRejections = updates.consecutiveRejections;
    }
    run.updatedAt = new Date().toISOString();
    return run;
  }

  /**
   * Retrieve a run by ID.
   */
  public getRun(runId: string): Run | undefined {
    return this.runs.get(runId);
  }

  /**
   * Retrieve a run by ID or throw RunNotFoundError.
   */
  public getRunOrThrow(runId: string): Run {
    const run = this.runs.get(runId);
    if (!run) {
      throw new RunNotFoundError(runId);
    }
    return run;
  }

  /**
   * List all runs with optional filtering.
   */
  public listRuns(filter?: { mode?: ArtifactMode; status?: RunStatus }): Run[] {
    let result = Array.from(this.runs.values());
    if (filter?.mode) {
      result = result.filter((r) => r.mode === filter.mode);
    }
    if (filter?.status) {
      result = result.filter((r) => r.status === filter.status);
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Internal helper to perform a validated state transition.
   */
  private transitionStatus(runId: string, targetStatus: RunStatus): Run {
    const run = this.getRunOrThrow(runId);

    if (!isValidRunTransition(run.status, targetStatus)) {
      throw new InvalidStateTransitionError(runId, run.status, targetStatus);
    }

    run.status = targetStatus;
    run.updatedAt = new Date().toISOString();
    return run;
  }
}

// Global shared lifecycle manager instance
let _sharedLifecycleManager: RunLifecycleManager | null = null;

export function getRunLifecycleManager(): RunLifecycleManager {
  if (!_sharedLifecycleManager) {
    _sharedLifecycleManager = new RunLifecycleManager();
  }
  return _sharedLifecycleManager;
}
