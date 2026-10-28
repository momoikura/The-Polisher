import { describe, it, expect } from "vitest";
import {
  LoopController,
  type ArtifactStore,
  type EvaluatorAgent,
  type LoopEvent,
  type RepairerAgent,
  type RunStore,
  type TesterAgent,
} from "../src/controller/loop-controller.js";
import { DEFAULT_RUN_CONFIG, type CreateRunInput, type Run } from "../src/types/run.js";
import type { ArtifactVersion } from "../src/types/artifact.js";
import type { EvaluatorOutput } from "../src/types/evaluation.js";
import type { TestCheck } from "../src/types/test.js";

// ── In-memory fakes ──────────────────────────────────────────────────────────

class MemoryRunStore implements RunStore {
  runs = new Map<string, Run>();
  createRun(input: CreateRunInput): Run {
    const now = new Date().toISOString();
    const run: Run = {
      id: `run-${this.runs.size + 1}`,
      mode: input.mode,
      status: "queued",
      prompt: input.prompt,
      config: { ...DEFAULT_RUN_CONFIG, ...(input.config ?? {}) },
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
    this.runs.set(run.id, run);
    return run;
  }
  updateRun(id: string, updates: Partial<Run>): Run {
    const next = { ...this.runs.get(id)!, ...updates };
    this.runs.set(id, next);
    return next;
  }
  getRun(id: string): Run | null {
    return this.runs.get(id) ?? null;
  }
}

class MemoryArtifactStore implements ArtifactStore {
  versions: ArtifactVersion[] = [];
  contents = new Map<string, string>();
  bestId: string | null = null;
  saveVersion(runId: string, versionNumber: number, content: string, contentType: string, source: string) {
    const version: ArtifactVersion = {
      id: `v${this.versions.length}`,
      runId,
      versionNumber,
      contentHash: "",
      contentPath: "",
      contentType: contentType as ArtifactVersion["contentType"],
      isBest: false,
      source: source as ArtifactVersion["source"],
      createdAt: new Date().toISOString(),
    };
    this.versions.push(version);
    this.contents.set(version.id, content);
    return version;
  }
  getContent(artifact: ArtifactVersion): string {
    return this.contents.get(artifact.id)!;
  }
  markAsBest(_runId: string, versionId: string): void {
    this.bestId = versionId;
  }
}

// ── Scripted agents ──────────────────────────────────────────────────────────
// Content strings encode the "truth" so tests read clearly: "score:7|fail:1|crit:0".

function parse(content: string) {
  const fields = Object.fromEntries(content.split("|").map((p) => p.split(":")));
  return { score: Number(fields.score), fail: Number(fields.fail ?? 0), crit: Number(fields.crit ?? 0) };
}

const evaluator: EvaluatorAgent = {
  async evaluate(_run, _artifact, content) {
    const { score, crit } = parse(content);
    const output: EvaluatorOutput = {
      scores: { overall: score, dimensions: {}, rationale: "" },
      issues: Array.from({ length: crit }, () => ({
        category: "x",
        severity: "critical" as const,
        description: "critical problem",
      })),
    };
    return { output, model: "mock", promptTokens: 10, completionTokens: 10 };
  },
};

const tester: TesterAgent = {
  async test(_run, _artifact, content) {
    const { fail } = parse(content);
    const types = ["readability", "grammar", "consistency"] as const;
    const checks: TestCheck[] = types.map((t, i) => ({
      testType: t,
      authority: "objective",
      passed: i >= fail,
      message: "",
    }));
    return { checks };
  },
};

function scriptedRepairer(outputs: string[]): RepairerAgent & { sources: string[] } {
  const sources: string[] = [];
  let i = 0;
  return {
    sources,
    async repair(_run, _artifact, content) {
      sources.push(content);
      const next = outputs[Math.min(i, outputs.length - 1)];
      i++;
      return { content: next, model: "mock", promptTokens: 10, completionTokens: 10 };
    },
  };
}

function setup(repairOutputs: string[], evaluatorOverride?: EvaluatorAgent) {
  const runStore = new MemoryRunStore();
  const artifactStore = new MemoryArtifactStore();
  const repairer = scriptedRepairer(repairOutputs);
  const events: LoopEvent[] = [];
  const controller = new LoopController({
    evaluator: evaluatorOverride ?? evaluator,
    repairer,
    tester,
    runStore,
    artifactStore,
    onEvent: (e) => events.push(e),
  });
  return { controller, runStore, artifactStore, repairer, events };
}

const run = (initialContent: string, config: CreateRunInput["config"] = {}): CreateRunInput => ({
  mode: "writing",
  prompt: "polish this",
  initialContent,
  config,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("LoopController", () => {
  it("stops as accepted when the baseline already meets the quality target", async () => {
    const { controller, artifactStore, repairer } = setup([]);
    const result = await controller.execute(run("score:9|fail:0"));

    expect(result.status).toBe("accepted");
    expect(result.bestVersionId).toBe("v0");
    expect(repairer.sources).toHaveLength(0);
    expect(artifactStore.versions[0].source).toBe("user_supplied");
  });

  it("promotes an improved candidate and stops when the target is reached", async () => {
    const { controller } = setup(["score:9|fail:0"]);
    const result = await controller.execute(run("score:5|fail:2"));

    expect(result.status).toBe("accepted");
    expect(result.bestVersionId).toBe("v1");
  });

  it("rejects a worse candidate and keeps repairing from the original best", async () => {
    const { controller, artifactStore, repairer, events } = setup(["score:3|fail:3", "score:9|fail:0"]);
    const result = await controller.execute(run("score:5|fail:1"));

    const decisions = events.filter((e) => e.type === "gate_decision");
    expect(decisions.map((d) => d.type === "gate_decision" && d.decision.accepted)).toEqual([true, false, true]);
    // Second repair must start from the baseline, not the rejected candidate.
    expect(repairer.sources).toEqual(["score:5|fail:1", "score:5|fail:1"]);
    expect(result.bestVersionId).toBe("v2");
    expect(artifactStore.getContent(artifactStore.versions[0])).toBe("score:5|fail:1");
  });

  it("rejects a high-scoring candidate that breaks a passing check", async () => {
    const { controller, events } = setup(["score:10|fail:2"], undefined);
    const result = await controller.execute(run("score:6|fail:1", { maxIterations: 2 }));

    const decision = events.find(
      (e) => e.type === "gate_decision" && e.versionId === "v1"
    );
    expect(decision?.type === "gate_decision" && decision.decision.reason).toBe("regression_detected");
    expect(result.bestVersionId).toBe("v0");
  });

  it("does not report acceptance while a critical defect remains", async () => {
    const { controller } = setup(["score:9.5|fail:0|crit:1"]);
    const result = await controller.execute(run("score:9|fail:0|crit:1", { maxIterations: 2 }));

    expect(result.status).not.toBe("accepted");
    expect(result.status).toBe("iteration_limited");
  });

  it("stops as stalled after consecutive non-improving candidates", async () => {
    const { controller } = setup(["score:5|fail:1"]);
    const result = await controller.execute(run("score:5|fail:1", { maxIterations: 10 }));

    expect(result.status).toBe("stalled");
    expect(result.bestVersionId).toBe("v0");
  });

  it("stops at the iteration limit and returns the best version found", async () => {
    const { controller } = setup(["score:6|fail:1", "score:7|fail:1", "score:8|fail:1"]);
    const result = await controller.execute(run("score:5|fail:1", { maxIterations: 3 }));

    expect(result.status).toBe("iteration_limited");
    expect(result.bestVersionId).toBe("v2");
  });

  it("fails the run on a malformed evaluation but preserves the best version", async () => {
    let calls = 0;
    const flaky: EvaluatorAgent = {
      async evaluate(r, a, c) {
        calls++;
        if (calls === 2) {
          return {
            output: { scores: { overall: Number.NaN, dimensions: {}, rationale: "" }, issues: [] },
            model: "mock",
            promptTokens: 0,
            completionTokens: 0,
          };
        }
        return evaluator.evaluate(r, a, c);
      },
    };
    const { controller } = setup(["score:9|fail:0"], flaky);
    const result = await controller.execute(run("score:5|fail:1"));

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/malformed/i);
    expect(result.bestVersionId).toBe("v0");
  });

  it("fails cleanly when an agent times out", async () => {
    const timingOut: RepairerAgent = {
      async repair() {
        throw new Error("Model request timed out after 30000ms");
      },
    };
    const controller = new LoopController({
      evaluator,
      tester,
      repairer: timingOut,
      runStore: new MemoryRunStore(),
      artifactStore: new MemoryArtifactStore(),
    });
    const result = await controller.execute(run("score:5|fail:1"));

    expect(result.status).toBe("failed");
    expect(result.bestVersionId).toBe("v0");
  });

  it("re-tests the best version against the current world when retestBestBeforeGate is on", async () => {
    // A check that depends on outside state: it passes until the world changes after round 1.
    let isWorldChanged = false;
    const worldTester: TesterAgent = {
      async test(_run, _artifact, content) {
        const { fail } = parse(content);
        const checks: TestCheck[] = [
          { testType: "consistency", authority: "objective", passed: !isWorldChanged, message: "" },
          { testType: "grammar", authority: "objective", passed: fail === 0, message: "" },
        ];
        return { checks };
      },
    };
    const repairer: RepairerAgent = {
      async repair() {
        isWorldChanged = true;
        return { content: "score:9|fail:0", model: "mock", promptTokens: 1, completionTokens: 1 };
      },
    };
    const make = (retest: boolean) =>
      new LoopController({
        evaluator,
        tester: worldTester,
        repairer,
        runStore: new MemoryRunStore(),
        artifactStore: new MemoryArtifactStore(),
        retestBestBeforeGate: retest,
      });

    isWorldChanged = false;
    const stale = await make(false).execute(run("score:5|fail:1", { maxIterations: 2 }));
    isWorldChanged = false;
    const fresh = await make(true).execute(run("score:5|fail:1", { maxIterations: 2 }));

    // Without re-testing, the outside change looks like the candidate's fault.
    expect(stale.bestVersionId).toBe("v0");
    // With re-testing, the candidate fixed grammar relative to the same world, so it wins.
    expect(fresh.bestVersionId).toBe("v1");
  });

  it("stops as accepted when the re-tested best version starts meeting the target", async () => {
    // The best version's only failure is outside the artifact; it clears after the first repair.
    let isBlocked = true;
    const tester: TesterAgent = {
      async test() {
        return { checks: [{ testType: "consistency", authority: "objective", passed: !isBlocked, message: "" }] };
      },
    };
    const repairs: string[] = [];
    const repairer: RepairerAgent = {
      async repair(_run, _artifact, content) {
        repairs.push(content);
        isBlocked = false;
        return { content: "score:8.9|fail:0", model: "mock", promptTokens: 1, completionTokens: 1 };
      },
    };
    const controller = new LoopController({
      evaluator,
      tester,
      repairer,
      runStore: new MemoryRunStore(),
      artifactStore: new MemoryArtifactStore(),
      retestBestBeforeGate: true,
    });

    const result = await controller.execute(run("score:9|fail:0", { maxIterations: 6 }));

    // The 8.9 candidate is rejected (lower score), but the 9.0 best now passes every check.
    expect(result.status).toBe("accepted");
    expect(result.bestVersionId).toBe("v0");
    expect(repairs).toHaveLength(1);
  });

  it("requires a generator when no initial content is supplied", async () => {
    const { controller } = setup([]);
    const result = await controller.execute({ mode: "writing", prompt: "write something" });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/no generator/i);
  });
});
