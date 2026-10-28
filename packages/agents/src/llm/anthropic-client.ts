/**
 * Claude adapter for the agents' ChatClient interface, via the official SDK.
 *
 * - Streams every request (whole HTML files are long outputs) and uses finalMessage().
 * - Sends no temperature: the Messages API rejects sampling params since 2026-10-21;
 *   ChatOptions.temperature is ignored here.
 * - Opts into server-side refusal fallbacks on the models that support them.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ChatClient, ChatCompletion, ChatOptions } from "./chat-client.js";
import { ModelClientError, textOf, type ChatMessage, type ContentPart } from "./meta-client.js";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** Design work is intelligence-sensitive, so default above Opus 5.5's own `medium`. */
const DEFAULT_EFFORT: Effort = "high";
const DEFAULT_MAX_TOKENS = 32_000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Haiku has no server-side fallback; older models are not in this list either. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

export interface ClaudeClientConfig {
  apiKey?: string;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  timeoutMs?: number;
  /** For tests: a pre-built SDK client. */
  sdk?: Pick<Anthropic, "beta">;
}

export function resolveClaudeConfig(config: ClaudeClientConfig = {}) {
  const effortEnv = process.env.CLAUDE_EFFORT as Effort | undefined;
  return {
    model: config.model || process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL,
    effort: config.effort ?? (effortEnv && EFFORTS.includes(effortEnv) ? effortEnv : DEFAULT_EFFORT),
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    timeoutMs: config.timeoutMs ?? (Number(process.env.MODEL_TIMEOUT_MS) || 300_000),
  };
}

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

// ─── Message conversion ───────────────────────────────────────────────────

type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/;

function toBlock(part: ContentPart): Anthropic.Beta.BetaContentBlockParam {
  if (part.type === "text") return { type: "text", text: part.text };
  const data = part.image_url.url.match(DATA_URL);
  if (data) return { type: "image", source: { type: "base64", media_type: data[1] as ImageMediaType, data: data[2] } };
  return { type: "image", source: { type: "url", url: part.image_url.url } };
}

/** System messages become the top-level system prompt; the rest map 1:1. */
export function toClaudeRequest(messages: ChatMessage[]): {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
} {
  const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n\n");
  const rest = messages
    .filter((m): m is ChatMessage & { role: "user" | "assistant" } => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : m.content.map(toBlock),
    }));
  return { system, messages: rest };
}

// ─── Client ───────────────────────────────────────────────────────────────

export class ClaudeChatClient implements ChatClient {
  private readonly sdk: Pick<Anthropic, "beta">;
  private readonly cfg: ReturnType<typeof resolveClaudeConfig>;

  constructor(config: ClaudeClientConfig = {}) {
    this.cfg = resolveClaudeConfig(config);
    this.sdk = config.sdk ?? new Anthropic({ apiKey: config.apiKey, timeout: this.cfg.timeoutMs, maxRetries: 2 });
  }

  getModelId(): string {
    return this.cfg.model;
  }

  async complete(messages: ChatMessage[], options?: ChatOptions): Promise<ChatCompletion> {
    const { system, messages: claudeMessages } = toClaudeRequest(messages);
    const useFallback = FALLBACK_MODELS.has(this.cfg.model);

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.sdk.beta.messages
        .stream({
          model: this.cfg.model,
          max_tokens: options?.maxTokens ?? this.cfg.maxTokens,
          ...(system ? { system } : {}),
          messages: claudeMessages,
          // Each lane re-sends the same system prompt (rulebook, references) every round.
          cache_control: { type: "ephemeral" },
          output_config: { effort: this.cfg.effort },
          ...(useFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
        })
        .finalMessage();
    } catch (err) {
      throw toModelError(err);
    }

    if (message.stop_reason === "refusal") {
      const category = message.stop_details?.category ?? "unspecified";
      throw new ModelClientError(`Claude declined this request (category: ${category}).`, "REFUSAL");
    }
    if (message.stop_reason === "max_tokens") {
      throw new ModelClientError(
        `Claude hit the ${options?.maxTokens ?? this.cfg.maxTokens}-token output limit before finishing.`,
        "MAX_TOKENS"
      );
    }

    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return {
      text,
      model: message.model,
      promptTokens: effectivePromptTokens(message.usage),
      completionTokens: message.usage.output_tokens,
    };
  }
}

const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** Input tokens priced as if uncached, so the cost tracker's per-token rate stays correct. */
export function effectivePromptTokens(usage: {
  input_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): number {
  return Math.round(
    usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) * CACHE_WRITE_MULTIPLIER +
      (usage.cache_read_input_tokens ?? 0) * CACHE_READ_MULTIPLIER
  );
}

function toModelError(err: unknown): ModelClientError {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ModelClientError("Claude rejected the API key. Check ANTHROPIC_API_KEY.", "AUTHENTICATION_ERROR", err.status);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ModelClientError("Claude rate limit reached; try again shortly.", "RATE_LIMIT_ERROR", 429);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new ModelClientError(`Claude rejected the request: ${err.message}`, "VALIDATION_ERROR", 400);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ModelClientError("Claude request timed out.", "TIMEOUT", 408);
  }
  if (err instanceof Anthropic.APIError) {
    return new ModelClientError(`Claude API error ${err.status ?? ""}: ${err.message}`, "SERVICE_ERROR", err.status);
  }
  return new ModelClientError(`Could not reach Claude: ${err instanceof Error ? err.message : String(err)}`, "SERVICE_ERROR");
}
