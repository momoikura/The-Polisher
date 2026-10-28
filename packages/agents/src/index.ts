/**
 * @polishloop/agents — public API.
 *
 * Exports the LLM provider utilities and agent implementations.
 * Individual agent implementations will be added in Day 3-4.
 */

// ─── LLM Provider ────────────────────────────────────────────────────────────
export {
  createModel,
  callLLM,
  callLLMStructured,
  getAvailableProviders,
  type ProviderName,
  type ProviderConfig,
  type LLMResult,
} from "./llm/provider.js";

export { DEFAULT_MODELS, resolveModel } from "./llm/models.js";

// ─── Meta Model Client ───────────────────────────────────────────────────────
export {
  MetaModelClient,
  getMetaModelClient,
  resolveMetaConfig,
  ChatMessageSchema,
  MetaChatCompletionRequestSchema,
  ChatChoiceSchema,
  UsageSchema,
  MetaChatCompletionResponseSchema,
  ModelClientError,
  ModelTimeoutError,
  ModelAuthError,
  ModelRateLimitError,
  ModelValidationError,
  ModelServiceError,
  type MetaClientConfig,
  type ChatMessage,
  type MetaChatCompletionRequest,
  type ChatChoice,
  type Usage,
  type MetaChatCompletionResponse,
  type MetaHealthCheckResult,
} from "./llm/meta-client.js";

// ─── Claude ──────────────────────────────────────────────────────────────────
export {
  ClaudeChatClient,
  DEFAULT_CLAUDE_MODEL,
  isClaudeConfigured,
  resolveClaudeConfig,
  type ClaudeClientConfig,
} from "./llm/anthropic-client.js";

// ─── Structured chat ─────────────────────────────────────────────────────────
export {
  chatClientFromMeta,
  completeStructured,
  extractJson,
  StructuredOutputError,
  type ChatClient,
  type ChatCompletion,
  type ChatOptions,
  type StructuredResult,
} from "./llm/chat-client.js";

// ─── Shared output contract ──────────────────────────────────────────────────
export {
  FindingSchema,
  EvaluationSchema,
  RepairSchema,
  SeveritySchema,
  toEvaluatorOutput,
  type Finding,
  type Evaluation,
  type Repair,
  type Severity,
} from "./schemas/agent-output.js";

// ─── Specialist agents ───────────────────────────────────────────────────────
export { WritePolish, taskContextFromRun, type WritePolishOptions } from "./agents/write-polish.js";
export { WRITING_PROMPT_VERSION } from "./prompts/writing.js";

// ─── Lanes and shared checks ─────────────────────────────────────────────────
export { LANES, type LaneId } from "./lanes.js";
export { findSlopPhrases, SLOP_PHRASES } from "./slop/shared.js";
export { COPY_RULEBOOK, UI_RULEBOOK, DESIGN_RULES, type DesignRule, type DesignSource } from "./design/knowledge.js";
export { textOf, type ContentPart } from "./llm/meta-client.js";

// ─── Experience memory (learning from runs) ──────────────────────────────────
export {
  FileExperienceStore,
  MemoryExperienceStore,
  buildExperience,
  recallLessons,
  formatLessons,
  summarizeExperience,
  ExperienceSchema,
  type Experience,
  type ExperienceStore,
  type Lesson,
  type RecalledLessons,
  type LaneMemorySummary,
} from "./memory/experience.js";

// ─── Auto-Maintainer ─────────────────────────────────────────────────────────
export { runMaintainer, type MaintainerOptions, type MaintainerResult, type MaintainerSource } from "./maintainer/orchestrator.js";
export { GitHubClient, GitHubError, parseIssueUrl, type IssueRef, type PullRequestInput } from "./maintainer/github.js";
export { ModalSandboxClient, type SandboxClient, type Validation } from "./maintainer/sandbox.js";
export { diffBundle, splitPr, type FileDiff, type PrBundle, type RepoSnapshot } from "./maintainer/bundle.js";
export type {
  MaintainerEvent,
  MaintainerPhase,
  MaintainerStatus,
  LaneState as MaintainerLaneState,
  LaneSummary as MaintainerLaneSummary,
  SideMetrics,
} from "./maintainer/events.js";
export {
  DEMO_ISSUE_URL,
  DEMO_SNAPSHOT,
  createSimulatedMaintainerClient,
  createSimulatedSandbox,
} from "./maintainer/simulated.js";

// ─── Verification ────────────────────────────────────────────────────────────
export { runWritingChecks, findRepetition, countWords } from "./verification/writing-checks.js";
