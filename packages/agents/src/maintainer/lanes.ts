/**
 * Auto-Maintainer lane agents. CodePolish, DocPolish and WritePolish own an
 * artifact each; SecurityPolish reviews CodePolish's work and gates it.
 */

import type {
  AggregatedTestResults,
  ArtifactVersion,
  EvaluateResult,
  EvaluatorAgent,
  EvaluatorOutput,
  RepairAttempt,
  RepairResult,
  RepairerAgent,
  Run,
  TestCheck,
  TestResult,
  TesterAgent,
} from "@thepolisher/core";
import { StructuredOutputError, completeStructured, type ChatClient } from "../llm/chat-client.js";
import { EvaluationSchema, RepairSchema, toEvaluatorOutput } from "../schemas/agent-output.js";
import type { CheckSnapshot } from "../memory/experience.js";
import { adaptStrategy, type AdaptStrategy } from "./adapt.js";
import { codeStaticChecks, docChecks, prChecks, uxChecks } from "./checks.js";
import { discardNotes, isTestPath, ownedFiles, parseFiles, serializeFiles, type FileMap, type PrBundle, type PrWorkspace } from "./bundle.js";
import {
  FilesRepairSchema,
  buildLaneEvaluationMessages,
  buildLaneRepairMessages,
  type MaintainerLane,
} from "./prompts.js";
import { validationChecks, validationFailureChecks, type SandboxClient, type Validation } from "./sandbox.js";

export type OwnerLane = Exclude<MaintainerLane, "security">;
export type LaneActivity = "evaluating" | "testing" | "validating" | "repairing" | "reviewing";

export interface RepairInfo {
  before: CheckSnapshot[];
  scoreBefore: number;
  strategies: string[];
  model: string;
}

export interface SecurityReview {
  score: number;
  findings: Array<{ severity: string; description: string }>;
}

/** Validation results by serialized code patch; shared so other lanes can read the current one. */
export class ValidationBoard {
  private readonly results = new Map<string, Validation>();
  record(code: FileMap, v: Validation): void {
    this.results.set(serializeFiles(code), v);
  }
  forCode(code: FileMap): Validation | null {
    return this.results.get(serializeFiles(code)) ?? null;
  }
}

export interface MaintainerLaneOptions {
  lane: OwnerLane;
  client: ChatClient;
  workspace: PrWorkspace;
  board: ValidationBoard;
  sandbox?: SandboxClient;
  onActivity: (activity: LaneActivity) => void;
  recall?: (failing: string[]) => string;
  onRepaired?: (info: RepairInfo) => void;
  /** Called when rejections make the agent change approach. */
  onAdapt?: (strategy: AdaptStrategy) => void;
  /** CodePolish only: SecurityPolish's critic verdict and the sandbox's security scan, for the dashboard. */
  onSecurityReview?: (review: SecurityReview) => void;
  onSecurityChecks?: (checks: TestCheck[]) => void;
}

const EVALUATION_TEMPERATURE = 0;
const REPAIR_TEMPERATURE = 0.3;
/** A narrowed, smallest-edit repair should vary less. */
const MINIMAL_REPAIR_TEMPERATURE = 0.1;

export class MaintainerLaneAgent implements EvaluatorAgent, RepairerAgent, TesterAgent {
  /** The candidate being judged this round; test() also runs on the previous best (re-test), which must not be reported as new. */
  private candidate: string | null = null;

  constructor(private readonly o: MaintainerLaneOptions) {}

  /** The lane's artifact as stored in the LoopController. */
  static serialize(lane: OwnerLane, bundle: PrBundle): string {
    return lane === "code" ? serializeFiles(bundle.code) : lane === "doc" ? serializeFiles(bundle.docs) : bundle.pr;
  }

  private bundleWith(content: string): PrBundle {
    const { lane } = this.o;
    return this.o.workspace.with(lane === "code" ? { code: parseFiles(content) } : lane === "doc" ? { docs: parseFiles(content) } : { pr: content });
  }

  private async validate(code: FileMap): Promise<Validation | null> {
    const known = this.o.board.forCode(code);
    if (known || !this.o.sandbox) return known;
    const snap = this.o.workspace.snapshot;
    this.o.onActivity("validating");
    const v = await this.o.sandbox.validate({
      repo: `${snap.owner}/${snap.repo}`,
      sha: snap.sha,
      changes: { ...code },
      newTests: Object.keys(code).filter(isTestPath),
    });
    this.o.board.record(code, v);
    return v;
  }

  async evaluate(_run: Run, _a: ArtifactVersion, content: string): Promise<EvaluateResult> {
    this.candidate = content;
    const bundle = this.bundleWith(content);
    const snap = this.o.workspace.snapshot;
    let validation: Validation | null = null;
    try {
      validation = this.o.lane === "code" ? await this.validate(bundle.code) : this.o.board.forCode(bundle.code);
    } catch {
      validation = null; // the tester reports it as "not verified"
    }

    this.o.onActivity("evaluating");
    const own = completeStructured(this.o.client, buildLaneEvaluationMessages(this.o.lane, snap, bundle, validation), EvaluationSchema, {
      temperature: EVALUATION_TEMPERATURE,
    });
    if (this.o.lane !== "code") {
      const r = await own;
      return { output: toEvaluatorOutput(r.data), model: r.model, promptTokens: r.promptTokens, completionTokens: r.completionTokens };
    }

    // CodePolish is critiqued by its own critic and by SecurityPolish; both must sign off.
    const sec = completeStructured(this.o.client, buildLaneEvaluationMessages("security", snap, bundle, validation), EvaluationSchema, {
      temperature: EVALUATION_TEMPERATURE,
    });
    const [codeR, secR] = await Promise.all([own, sec]);
    const secOut = toEvaluatorOutput(secR.data);
    this.o.onSecurityReview?.({ score: secR.data.score, findings: secOut.issues.slice(0, 4).map((i) => ({ severity: i.severity, description: i.description })) });
    const codeOut = toEvaluatorOutput(codeR.data);
    return {
      output: {
        scores: {
          overall: Math.min(codeOut.scores.overall, secOut.scores.overall),
          // Both critics' own verdicts, so the dashboard can show each agent's score separately.
          dimensions: { ...codeOut.scores.dimensions, code_review: codeOut.scores.overall, security_review: secOut.scores.overall },
          rationale: codeOut.scores.rationale,
        },
        issues: [...codeOut.issues, ...secOut.issues.map((i) => ({ ...i, description: `SecurityPolish: ${i.description}` }))],
      },
      model: codeR.model,
      promptTokens: codeR.promptTokens + secR.promptTokens,
      completionTokens: codeR.completionTokens + secR.completionTokens,
    };
  }

  async test(_run: Run, _a: ArtifactVersion, content: string): Promise<TestResult> {
    this.o.onActivity("testing");
    const bundle = this.bundleWith(content);
    const snap = this.o.workspace.snapshot;

    if (this.o.lane === "doc") return { checks: docChecks(bundle.docs, bundle, snap) };
    if (this.o.lane === "write") return { checks: prChecks(bundle.pr, bundle, snap, this.o.board.forCode(bundle.code)) };

    let sandboxChecks: TestCheck[];
    if (!this.o.sandbox) {
      sandboxChecks = validationFailureChecks("no sandbox configured");
    } else {
      // A sandbox hiccup is not the agent's fault: retry once before it counts against the code.
      const attempt = () => this.validate(bundle.code);
      try {
        const v = await attempt().catch(attempt);
        sandboxChecks = v ? validationChecks(v) : validationFailureChecks("no result");
      } catch (err) {
        sandboxChecks = validationFailureChecks(err instanceof Error ? err.message : String(err));
      }
    }
    if (content === this.candidate) this.o.onSecurityChecks?.(sandboxChecks.filter((c) => c.testType === "security_scan"));
    return { checks: [...codeStaticChecks(bundle.code, snap), ...uxChecks(bundle.code, snap), ...sandboxChecks] };
  }

  async repair(
    _run: Run,
    _a: ArtifactVersion,
    content: string,
    evaluation: EvaluatorOutput,
    tests: AggregatedTestResults,
    history: readonly RepairAttempt[] = []
  ): Promise<RepairResult> {
    this.o.onActivity("repairing");
    const bundle = this.bundleWith(content);
    const snap = this.o.workspace.snapshot;
    // Objective checks (tests, compile) come before opinion checks: they decide what "the top failing check" is.
    const failing = tests.checks
      .filter((c) => !c.passed)
      .sort((a, b) => Number(b.authority === "objective") - Number(a.authority === "objective"));
    const lessons = this.o.recall?.(failing.map((c) => c.testType)) ?? "";
    const strategy = adaptStrategy(history, failing.map((c) => c.testType));
    if (strategy.label) this.o.onAdapt?.(strategy);
    const temperature = strategy.mode === "minimal" ? MINIMAL_REPAIR_TEMPERATURE : REPAIR_TEMPERATURE;
    const messages = buildLaneRepairMessages(
      this.o.lane,
      snap,
      bundle,
      this.o.board.forCode(bundle.code),
      evaluation.issues,
      failing.map((c) => `${c.testType}: ${c.message}`),
      [strategy.brief, lessons].filter(Boolean).join("\n\n")
    );

    let next: string;
    let changes: string[];
    let model: string;
    let promptTokens: number;
    let completionTokens: number;
    try {
      if (this.o.lane === "write") {
        const r = await completeStructured(this.o.client, messages, RepairSchema, { temperature });
        ({ model, promptTokens, completionTokens } = r);
        next = r.data.candidateArtifact;
        changes = r.data.changesMade;
      } else {
        const r = await completeStructured(this.o.client, messages, FilesRepairSchema, { temperature });
        ({ model, promptTokens, completionTokens } = r);
        const current = parseFiles(content);
        // A revision may only touch its own files; a stray CHANGELOG in CodePolish's patch would block the sandbox.
        const fileLane = this.o.lane === "doc" ? "doc" : "code";
        const existing = new Set(snap.tree);
        const owned = ownedFiles(fileLane, r.data.files, existing);
        const merged: Record<string, string> = { ...current, ...owned };
        for (const p of r.data.removeFromPatch ?? []) delete merged[p];
        next = serializeFiles(merged);
        changes = [...r.data.changesMade, ...discardNotes(fileLane, r.data.files, existing)];
      }
    } catch (err) {
      // One unusable reply is a failed attempt, not the end of the lane: hand back the current
      // version so the gate rejects it and the next round adapts, with the tokens still charged.
      if (!(err instanceof StructuredOutputError)) throw err;
      const usage = err.usage ?? { model: "", promptTokens: 0, completionTokens: 0 };
      return { content, changesMade: [`Reply was unusable (${err.message}); nothing was changed`], ...usage };
    }

    this.o.onRepaired?.({
      before: tests.checks.filter((c) => c.authority === "objective"),
      scoreBefore: evaluation.scores.overall,
      strategies: changes,
      model,
    });
    return { content: next, changesMade: changes, model, promptTokens, completionTokens };
  }
}
