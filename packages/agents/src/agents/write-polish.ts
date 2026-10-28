/**
 * WritePolish — writing specialist.
 *
 * evaluate() and repair() are separate model calls. test() is fully
 * deterministic. None of them decides acceptance; the controller does.
 */

import type {
  AggregatedTestResults,
  ArtifactVersion,
  EvaluateResult,
  EvaluatorAgent,
  EvaluatorOutput,
  RepairResult,
  RepairerAgent,
  Run,
  TestResult,
  TesterAgent,
} from "@thepolisher/core";
import { completeStructured, type ChatClient } from "../llm/chat-client.js";
import { EvaluationSchema, RepairSchema, toEvaluatorOutput } from "../schemas/agent-output.js";
import {
  WRITING_PROMPT_VERSION,
  buildWritingEvaluationMessages,
  buildWritingRepairMessages,
} from "../prompts/writing.js";
import type { TaskContext } from "../prompts/shared.js";
import { runWritingChecks } from "../verification/writing-checks.js";

export interface WritePolishOptions {
  /** Client for evaluation calls. */
  evaluatorClient: ChatClient;
  /** Client for repair calls; may be a different model for independence. Defaults to evaluatorClient. */
  repairerClient?: ChatClient;
}

const EVALUATION_TEMPERATURE = 0;
const REPAIR_TEMPERATURE = 0.3;

export function taskContextFromRun(run: Run): TaskContext {
  return {
    task: run.prompt,
    audience: run.config.audience,
    requiredPhrases: run.config.requiredPhrases,
    minWords: run.config.minWords,
    maxWords: run.config.maxWords,
    styleGuide: run.config.styleGuide,
  };
}

export class WritePolish implements EvaluatorAgent, RepairerAgent, TesterAgent {
  readonly name = "WritePolish";
  readonly promptVersion = WRITING_PROMPT_VERSION;
  private readonly evaluatorClient: ChatClient;
  private readonly repairerClient: ChatClient;

  constructor(options: WritePolishOptions) {
    this.evaluatorClient = options.evaluatorClient;
    this.repairerClient = options.repairerClient ?? options.evaluatorClient;
  }

  async evaluate(run: Run, _artifact: ArtifactVersion, content: string): Promise<EvaluateResult> {
    const result = await completeStructured(
      this.evaluatorClient,
      buildWritingEvaluationMessages(taskContextFromRun(run), content),
      EvaluationSchema,
      { temperature: EVALUATION_TEMPERATURE }
    );
    return {
      output: toEvaluatorOutput(result.data),
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }

  async repair(
    run: Run,
    _artifact: ArtifactVersion,
    content: string,
    evaluation: EvaluatorOutput,
    testResults: AggregatedTestResults
  ): Promise<RepairResult> {
    const failedChecks = testResults.checks.filter((c) => !c.passed).map((c) => `${c.testType}: ${c.message}`);
    const result = await completeStructured(
      this.repairerClient,
      buildWritingRepairMessages(taskContextFromRun(run), content, evaluation.issues, failedChecks),
      RepairSchema,
      { temperature: REPAIR_TEMPERATURE }
    );
    return {
      content: result.data.candidateArtifact,
      changesMade: result.data.changesMade,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }

  async test(run: Run, _artifact: ArtifactVersion, content: string): Promise<TestResult> {
    return { checks: runWritingChecks(content, run.config) };
  }
}
