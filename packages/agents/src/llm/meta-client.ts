/**
 * Meta Model API Client abstraction for PolishLoop.
 *
 * Provides a typed, secure client for Meta's Model API (e.g. Muse Spark models).
 *
 * Security Invariants:
 * - API keys are NEVER exposed in error messages, logs, or client responses.
 * - All requests and responses are strictly validated using Zod schemas.
 * - Configurable request timeout with graceful cancellation.
 */

import { z } from "zod";

// ─── Environment & Configuration ─────────────────────────────────────────────

export interface MetaClientConfig {
  /** Base URL for the Meta Model API (defaults to process.env.META_BASE_URL || process.env.MODEL_BASE_URL || "https://api.meta.ai/v1") */
  baseUrl?: string;
  /** API Key (defaults to process.env.META_API_KEY || process.env.MODEL_API_KEY) */
  apiKey?: string;
  /** Model ID (defaults to process.env.META_MODEL_ID || process.env.MODEL_ID || "muse-spark-1.3") */
  modelId?: string;
  /** Request timeout in milliseconds (defaults to 30000) */
  timeoutMs?: number;
  /** Fetch implementation override (useful for testing) */
  fetchFn?: typeof fetch;
}

export function resolveMetaConfig(config?: MetaClientConfig): Required<Omit<MetaClientConfig, "fetchFn">> & { fetchFn: typeof fetch } {
  // `||` on purpose: a blank line in .env (MODEL_ID=) means "unset", not "empty string".
  const baseUrl = (
    config?.baseUrl ||
    process.env.META_BASE_URL ||
    process.env.MODEL_BASE_URL ||
    "https://api.meta.ai/v1"
  ).replace(/\/+$/, "");

  const apiKey =
    config?.apiKey ??
    (process.env.META_API_KEY || process.env.MODEL_API_KEY || "");

  const modelId =
    config?.modelId ||
    process.env.META_MODEL_ID ||
    process.env.MODEL_ID ||
    "muse-spark-1.3";

  const timeoutMs =
    config?.timeoutMs ??
    (process.env.MODEL_TIMEOUT_MS ? parseInt(process.env.MODEL_TIMEOUT_MS, 10) : 30000);

  const fetchFn = config?.fetchFn ?? globalThis.fetch;

  return {
    baseUrl,
    apiKey,
    modelId,
    timeoutMs,
    fetchFn,
  };
}

// ─── Typed Zod Schemas ───────────────────────────────────────────────────────

/** OpenAI-compatible multimodal parts. Image parts only work with a vision-capable model. */
export const ContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image_url"), image_url: z.object({ url: z.string() }) }),
]);

export type ContentPart = z.infer<typeof ContentPartSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([z.string(), z.array(ContentPartSchema)]),
  name: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** The text of a message, ignoring image parts. */
export function textOf(content: ChatMessage["content"] | null | undefined): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
}

export const MetaChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1, "At least one message is required"),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
});

export type MetaChatCompletionRequest = z.infer<typeof MetaChatCompletionRequestSchema>;

export const ChatChoiceSchema = z.object({
  index: z.number().optional().default(0),
  message: ChatMessageSchema,
  finish_reason: z.string().nullable().optional(),
});

export type ChatChoice = z.infer<typeof ChatChoiceSchema>;

export const UsageSchema = z.object({
  prompt_tokens: z.number().default(0),
  completion_tokens: z.number().default(0),
  total_tokens: z.number().default(0),
});

export type Usage = z.infer<typeof UsageSchema>;

export const MetaChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.string().optional(),
  created: z.number().optional(),
  model: z.string(),
  choices: z.array(ChatChoiceSchema).min(1, "At least one choice is required"),
  usage: UsageSchema.optional().default({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }),
});

export type MetaChatCompletionResponse = z.infer<typeof MetaChatCompletionResponseSchema>;

// ─── Custom Typed Errors ─────────────────────────────────────────────────────

export class ModelClientError extends Error {
  constructor(message: string, public readonly code: string, public readonly statusCode?: number) {
    // Sanitize any accidental credentials from error messages
    super(sanitizeMessage(message));
    this.name = "ModelClientError";
  }
}

export class ModelTimeoutError extends ModelClientError {
  constructor(timeoutMs: number) {
    super(`Model request timed out after ${timeoutMs}ms`, "TIMEOUT", 408);
    this.name = "ModelTimeoutError";
  }
}

export class ModelAuthError extends ModelClientError {
  constructor(message = "Authentication failed with Meta Model API. Check your API key.") {
    super(message, "AUTHENTICATION_ERROR", 401);
    this.name = "ModelAuthError";
  }
}

export class ModelRateLimitError extends ModelClientError {
  constructor(message = "Meta Model API rate limit exceeded.") {
    super(message, "RATE_LIMIT_ERROR", 429);
    this.name = "ModelRateLimitError";
  }
}

export class ModelValidationError extends ModelClientError {
  constructor(message: string, public readonly issues?: z.ZodIssue[]) {
    super(`Schema validation failed: ${message}`, "VALIDATION_ERROR", 400);
    this.name = "ModelValidationError";
  }
}

export class ModelServiceError extends ModelClientError {
  constructor(message: string, statusCode = 500) {
    super(message, "SERVICE_ERROR", statusCode);
    this.name = "ModelServiceError";
  }
}

function sanitizeMessage(text: string): string {
  // Strip anything that looks like an API key or Bearer token
  return text
    .replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, "Bearer ***")
    .replace(/(key|token)=["']?[A-Za-z0-9_\-.]+["']?/gi, "$1=***");
}

// ─── Health Check ────────────────────────────────────────────────────────────

export interface MetaHealthCheckResult {
  status: "healthy" | "unhealthy" | "unconfigured";
  model: string;
  baseUrl: string;
  latencyMs?: number;
  message: string;
}

// ─── Meta Model Client Implementation ────────────────────────────────────────

export class MetaModelClient {
  private config: Required<Omit<MetaClientConfig, "fetchFn">> & { fetchFn: typeof fetch };

  constructor(config?: MetaClientConfig) {
    this.config = resolveMetaConfig(config);
  }

  /**
   * Return configured model ID.
   */
  public getModelId(): string {
    return this.config.modelId;
  }

  /**
   * Return configured base URL.
   */
  public getBaseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Check if client has an API key configured without exposing it.
   */
  public isConfigured(): boolean {
    return !!this.config.apiKey && this.config.apiKey.trim().length > 0;
  }

  /**
   * Send a chat completion request to the Meta Model API.
   */
  public async createChatCompletion(
    request: Partial<MetaChatCompletionRequest> & { messages: ChatMessage[] }
  ): Promise<MetaChatCompletionResponse> {
    if (!this.isConfigured()) {
      throw new ModelAuthError("Meta Model API key is not configured. Set MODEL_API_KEY or META_API_KEY.");
    }

    const payload: MetaChatCompletionRequest = {
      model: request.model ?? this.config.modelId,
      messages: request.messages,
      temperature: request.temperature,
      top_p: request.top_p,
      max_tokens: request.max_tokens,
      stream: request.stream,
      stop: request.stop,
    };

    // Validate request schema with Zod
    const validationResult = MetaChatCompletionRequestSchema.safeParse(payload);
    if (!validationResult.success) {
      throw new ModelValidationError(
        validationResult.error.message,
        validationResult.error.issues
      );
    }

    const url = `${this.config.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const response = await this.config.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(validationResult.data),
        signal: controller.signal,
      });

      clearTimeout(timeoutHandle);

      if (!response.ok) {
        let errorBody = "";
        try {
          errorBody = await response.text();
        } catch {
          // ignore
        }

        if (response.status === 401 || response.status === 403) {
          throw new ModelAuthError();
        }
        if (response.status === 429) {
          throw new ModelRateLimitError();
        }
        throw new ModelServiceError(
          `Meta Model API responded with status ${response.status}: ${errorBody.slice(0, 300)}`,
          response.status
        );
      }

      const rawJson = await response.json();
      const parseResponse = MetaChatCompletionResponseSchema.safeParse(rawJson);
      if (!parseResponse.success) {
        throw new ModelValidationError(
          `Invalid response format from Meta Model API: ${parseResponse.error.message}`,
          parseResponse.error.issues
        );
      }

      return parseResponse.data;
    } catch (error: unknown) {
      clearTimeout(timeoutHandle);

      if (error instanceof ModelClientError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new ModelTimeoutError(this.config.timeoutMs);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new ModelServiceError(`Failed to connect to Meta Model API: ${sanitizeMessage(errorMessage)}`);
    }
  }

  /**
   * Helper: Generate a text completion with simple prompt.
   */
  public async generateText(
    prompt: string,
    systemPrompt?: string
  ): Promise<{ text: string; model: string; promptTokens: number; completionTokens: number }> {
    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const completion = await this.createChatCompletion({ messages });
    const choice = completion.choices[0];
    const text = textOf(choice?.message.content);

    return {
      text,
      model: completion.model,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
    };
  }

  /**
   * Health check to verify Meta Model API readiness.
   */
  public async healthCheck(): Promise<MetaHealthCheckResult> {
    if (!this.isConfigured()) {
      return {
        status: "unconfigured",
        model: this.config.modelId,
        baseUrl: this.config.baseUrl,
        message: "Meta Model API key is missing. Set MODEL_API_KEY in environment.",
      };
    }

    const startTime = Date.now();
    try {
      // Lightweight probe request or connectivity test
      const response = await this.config.fetchFn(`${this.config.baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(Math.min(5000, this.config.timeoutMs)),
      });

      const latencyMs = Date.now() - startTime;

      if (response.ok || response.status === 404) {
        // Many compatible APIs return 200 or 404 for /models, both confirm connection & auth
        return {
          status: "healthy",
          model: this.config.modelId,
          baseUrl: this.config.baseUrl,
          latencyMs,
          message: "Meta Model API is configured and reachable.",
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          status: "unhealthy",
          model: this.config.modelId,
          baseUrl: this.config.baseUrl,
          latencyMs,
          message: "Authentication failed. Please verify your MODEL_API_KEY.",
        };
      }

      return {
        status: "healthy",
        model: this.config.modelId,
        baseUrl: this.config.baseUrl,
        latencyMs,
        message: `Endpoint reachable with status ${response.status}.`,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        status: "unhealthy",
        model: this.config.modelId,
        baseUrl: this.config.baseUrl,
        latencyMs,
        message: `Connection failed: ${sanitizeMessage(errorMsg)}`,
      };
    }
  }
}

/**
 * Singleton factory for shared client instance.
 */
let _sharedClient: MetaModelClient | null = null;

export function getMetaModelClient(config?: MetaClientConfig): MetaModelClient {
  if (config) {
    return new MetaModelClient(config);
  }
  if (!_sharedClient) {
    _sharedClient = new MetaModelClient();
  }
  return _sharedClient;
}
