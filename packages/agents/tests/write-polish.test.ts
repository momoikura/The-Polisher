/**
 * WritePolish wired into the real LoopController with a scripted fake model.
 * These are mocked-model tests: they prove the loop logic, not model quality.
 */

import { describe, it, expect } from "vitest";
import { LoopController, type LoopEvent } from "../../core/src/controller/loop-controller.js";
import { RunLifecycleManager } from "../../core/src/lifecycle/run-lifecycle.js";
import type { ArtifactVersion } from "../../core/src/types/artifact.js";
import type { Run } from "../../core/src/types/run.js";
import { WritePolish } from "../src/agents/write-polish.js";
import type { ChatClient } from "../src/llm/chat-client.js";
import type { ChatMessage } from "../src/llm/meta-client.js";

const DRAFT =
  "In today's fast paced world, our tool helps teams. Our tool helps teams. It is the best solution. [insert pricing]";
const GOOD = "Linthub flags style violations in pull requests before review, so reviewers spend time on design instead.";
// Same objective failures as the draft (no required phrase, placeholder) but a lower score.
const WORSE = "Our tool is great. [insert pricing]";

function evaluation(score: number, critical = false) {
  return JSON.stringify({
    score,
    dimensionScores: { clarity: score },
    findings: critical
      ? [{ id: "F1", severity: "critical", category: "requirements", description: "Placeholder left in", evidence: "[insert pricing]", recommendedFix: "Remove it" }]
      : [],
    criticalFailures: [],
    requiredFixes: [],
    recommendedChecks: [],
  });
}

function repair(candidate: string) {
  return JSON.stringify({ candidateArtifact: candidate, changesMade: ["rewrote"], addressedFindingIds: ["F1"], unresolvedIssues: [] });
}

/** Evaluator fake: scores the artifact it is shown, keyed by content. */
function evaluatorFake(scores: Record<string, number>): ChatClient & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen,
    async complete(messages) {
      seen.push(messages);
      const user = messages[messages.length - 1].content;
      const key = Object.keys(scores).find((k) => user.includes(k))!;
      return { text: evaluation(scores[key], key === DRAFT), model: "eval-model", promptTokens: 100, completionTokens: 50 };
    },
  };
}

function repairerFake(candidates: string[]): ChatClient & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen,
    async complete(messages) {
      seen.push(messages);
      const next = candidates[Math.min(seen.length - 1, candidates.length - 1)];
      return { text: repair(next), model: "repair-model", promptTokens: 200, completionTokens: 150 };
    },
  };
}

function memoryArtifacts() {
  const versions: ArtifactVersion[] = [];
  const contents = new Map<string, string>();
  return {
    versions,
    contents,
    saveVersion(runId: string, versionNumber: number, content: string, contentType: string, source: string) {
      const v = { id: `v${versions.length}`, runId, versionNumber, contentHash: "", contentPath: "", contentType, isBest: false, source, createdAt: "" } as ArtifactVersion;
      versions.push(v);
      contents.set(v.id, content);
      return v;
    },
    getContent: (a: ArtifactVersion) => contents.get(a.id)!,
    markAsBest() {},
  };
}

function runStore() {
  const lifecycle = new RunLifecycleManager();
  const runs = new Map<string, Run>();
  return {
    createRun: (input: Parameters<RunLifecycleManager["createRun"]>[0]) => {
      const run = lifecycle.createRun(input);
      runs.set(run.id, run);
      return run;
    },
    updateRun: (id: string, updates: Partial<Run>) => {
      const next = { ...runs.get(id)!, ...updates };
      runs.set(id, next);
      return next;
    },
    getRun: (id: string) => runs.get(id) ?? null,
  };
}

function controllerFor(agent: WritePolish, events: LoopEvent[] = []) {
  const artifacts = memoryArtifacts();
  const controller = new LoopController({
    evaluator: agent,
    repairer: agent,
    tester: agent,
    runStore: runStore(),
    artifactStore: artifacts,
    onEvent: (e) => events.push(e),
  });
  return { controller, artifacts };
}

const input = {
  mode: "writing" as const,
  prompt: "Tighten this product blurb for engineering managers.",
  initialContent: DRAFT,
  config: { requiredPhrases: ["Linthub"], maxIterations: 4, qualityThresholds: { minScore: 8, requireAllTestsPass: true, maxCriticalDefects: 0 } },
};

describe("WritePolish in the loop (mocked model)", () => {
  it("rejects a worse rewrite, keeps the draft as best, then accepts a real improvement", async () => {
    const evaluatorClient = evaluatorFake({ [DRAFT]: 40, [WORSE]: 30, [GOOD]: 88 });
    const repairerClient = repairerFake([WORSE, GOOD]);
    const events: LoopEvent[] = [];
    const { controller, artifacts } = controllerFor(new WritePolish({ evaluatorClient, repairerClient }), events);

    const result = await controller.execute(input);

    const decisions = events.flatMap((e) => (e.type === "gate_decision" ? [e.decision.accepted] : []));
    expect(decisions).toEqual([true, false, true]);
    expect(result.status).toBe("accepted");
    expect(artifacts.contents.get(result.bestVersionId!)).toBe(GOOD);
    // The second repair started from the draft, not the rejected candidate.
    expect(repairerClient.seen[1][1].content).toContain(DRAFT);
    expect(repairerClient.seen[1][1].content).not.toContain(WORSE);
  });

  it("passes failing objective checks and findings into the repair prompt", async () => {
    const evaluatorClient = evaluatorFake({ [DRAFT]: 40, [GOOD]: 88 });
    const repairerClient = repairerFake([GOOD]);
    const { controller } = controllerFor(new WritePolish({ evaluatorClient, repairerClient }));

    await controller.execute(input);

    const repairPrompt = repairerClient.seen[0][1].content;
    expect(repairPrompt).toContain("required_content");
    expect(repairPrompt).toContain("placeholder_text");
    expect(repairPrompt).toContain("Placeholder left in");
  });

  it("uses separate model calls for evaluation and repair", async () => {
    const evaluatorClient = evaluatorFake({ [DRAFT]: 40, [GOOD]: 88 });
    const repairerClient = repairerFake([GOOD]);
    const { controller } = controllerFor(new WritePolish({ evaluatorClient, repairerClient }));

    await controller.execute(input);

    expect(evaluatorClient.seen[0][0].content).toContain("EVALUATOR MODE");
    expect(repairerClient.seen[0][0].content).toContain("REPAIR MODE");
    expect(evaluatorClient.seen.every((m) => !m[0].content.includes("REPAIR MODE"))).toBe(true);
  });

  it("fails the run, keeping the draft as best, when the evaluator never returns valid JSON", async () => {
    const broken: ChatClient = {
      async complete() {
        return { text: "Looks great to me!", model: "eval-model", promptTokens: 1, completionTokens: 1 };
      },
    };
    const { controller } = controllerFor(new WritePolish({ evaluatorClient: broken }));

    const result = await controller.execute(input);

    expect(result.status).toBe("failed");
    expect(result.bestVersionId).toBeNull();
    expect(result.errorMessage).toMatch(/structured output invalid/i);
  });
});
