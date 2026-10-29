/**
 * Automated tests for MetaModelClient.
 *
 * Verifies:
 * 1. Configuration loading & defaults
 * 2. Typed Zod request validation
 * 3. Typed Zod response parsing
 * 4. Configurable timeout behavior (ModelTimeoutError)
 * 5. Authentication and error handling without credential leakage
 * 6. Health check logic
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MetaModelClient,
  ModelTimeoutError,
  ModelAuthError,
  ModelValidationError,
  ModelRateLimitError,
  ModelServiceError,
  resolveMetaConfig,
} from "../src/llm/meta-client.js";

describe("MetaModelClient", () => {
  beforeEach(() => {
    delete process.env.META_API_KEY;
    delete process.env.MODEL_API_KEY;
    delete process.env.META_BASE_URL;
    delete process.env.MODEL_BASE_URL;
    delete process.env.META_MODEL_ID;
    delete process.env.MODEL_ID;
    delete process.env.MODEL_TIMEOUT_MS;
  });

  describe("Configuration & Environment Variables", () => {
    it("uses default values when env vars are not set", () => {
      const config = resolveMetaConfig();
      expect(config.baseUrl).toBe("https://api.meta.ai/v1");
      expect(config.modelId).toBe("muse-spark-1.3-contributor");
      expect(config.timeoutMs).toBe(30000);
      expect(config.apiKey).toBe("");
    });

    it("treats blank env values as unset", () => {
      process.env.MODEL_BASE_URL = "";
      process.env.MODEL_ID = "";
      const config = resolveMetaConfig();
      expect(config.baseUrl).toBe("https://api.meta.ai/v1");
      expect(config.modelId).toBe("muse-spark-1.3-contributor");
    });

    it("respects environment variables when provided", () => {
      process.env.MODEL_BASE_URL = "https://custom.meta.endpoint/v1";
      process.env.MODEL_API_KEY = "test-secret-key-12345";
      process.env.MODEL_ID = "muse-spark-1.3-contributor";
      process.env.MODEL_TIMEOUT_MS = "15000";

      const config = resolveMetaConfig();
      expect(config.baseUrl).toBe("https://custom.meta.endpoint/v1");
      expect(config.apiKey).toBe("test-secret-key-12345");
      expect(config.modelId).toBe("muse-spark-1.3-contributor");
      expect(config.timeoutMs).toBe(15000);
    });

    it("reports configured status accurately without exposing the key", () => {
      const clientUnconfigured = new MetaModelClient({ apiKey: "" });
      expect(clientUnconfigured.isConfigured()).toBe(false);

      const clientConfigured = new MetaModelClient({ apiKey: "mock-key" });
      expect(clientConfigured.isConfigured()).toBe(true);
      expect(clientConfigured.getModelId()).toBe("muse-spark-1.3-contributor");
      expect(clientConfigured.getBaseUrl()).toBe("https://api.meta.ai/v1");
    });
  });

  describe("Request Validation", () => {
    it("throws ModelValidationError if messages array is empty", async () => {
      const client = new MetaModelClient({ apiKey: "mock-key" });
      await expect(
        client.createChatCompletion({
          messages: [],
        })
      ).rejects.toThrow(ModelValidationError);
    });

    it("throws ModelAuthError if API key is missing", async () => {
      const client = new MetaModelClient({ apiKey: "" });
      await expect(
        client.createChatCompletion({
          messages: [{ role: "user", content: "Hello" }],
        })
      ).rejects.toThrow(ModelAuthError);
    });
  });

  describe("Response Parsing & Execution", () => {
    it("sends request with Bearer authorization and parses completion response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: "chatcmpl-test-001",
          model: "muse-spark-1.3",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Here is the polished content.",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 18,
            completion_tokens: 8,
            total_tokens: 26,
          },
        }),
      });

      const client = new MetaModelClient({
        apiKey: "sk-test-token",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await client.createChatCompletion({
        messages: [{ role: "user", content: "Polish this" }],
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.meta.ai/v1/chat/completions");
      expect(options.headers["Authorization"]).toBe("Bearer sk-test-token");
      expect(result.id).toBe("chatcmpl-test-001");
      expect(result.choices[0].message.content).toBe("Here is the polished content.");
      expect(result.usage?.prompt_tokens).toBe(18);
    });

    it("generates text using helper function", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: "chatcmpl-002",
          model: "muse-spark-1.3",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Polished output" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const client = new MetaModelClient({
        apiKey: "test-key",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const response = await client.generateText("Draft input", "System prompt");
      expect(response.text).toBe("Polished output");
      expect(response.promptTokens).toBe(10);
      expect(response.completionTokens).toBe(5);
    });
  });

  describe("Timeout and Error Handling", () => {
    it("handles request timeout and throws ModelTimeoutError", async () => {
      const mockFetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      });

      const client = new MetaModelClient({
        apiKey: "test-key",
        timeoutMs: 50,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(
        client.createChatCompletion({
          messages: [{ role: "user", content: "Test timeout" }],
        })
      ).rejects.toThrow(ModelTimeoutError);
    });

    it("handles 401 unauthorized without leaking credentials in error message", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized: invalid Bearer sk-super-secret-key-12345",
      });

      const client = new MetaModelClient({
        apiKey: "sk-super-secret-key-12345",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      try {
        await client.createChatCompletion({
          messages: [{ role: "user", content: "Test auth" }],
        });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ModelAuthError);
        const error = err as ModelAuthError;
        expect(error.message).not.toContain("sk-super-secret-key-12345");
      }
    });
  });

  describe("Rate limits", () => {
    const completion = {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-rl",
        model: "muse-spark-1.3-contributor",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      }),
    };
    const tooMany = (retryAfter?: string) => ({
      ok: false,
      status: 429,
      headers: new Headers(retryAfter ? { "retry-after": retryAfter } : {}),
      text: async () => "rate limited",
    });

    it("waits and retries when Meta answers 429, then returns the completion", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(tooMany()).mockResolvedValueOnce(tooMany("0")).mockResolvedValueOnce(completion);
      const client = new MetaModelClient({ apiKey: "k", rateLimitDelayMs: 1, fetchFn: mockFetch as unknown as typeof fetch });

      const result = await client.createChatCompletion({ messages: [{ role: "user", content: "hi" }] });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.choices[0].message.content).toBe("ok");
    });

    it("gives up with ModelRateLimitError after the last retry", async () => {
      const mockFetch = vi.fn().mockResolvedValue(tooMany());
      const client = new MetaModelClient({ apiKey: "k", rateLimitDelayMs: 1, fetchFn: mockFetch as unknown as typeof fetch });

      await expect(client.createChatCompletion({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(ModelRateLimitError);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("does not retry other errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
      const client = new MetaModelClient({ apiKey: "k", rateLimitDelayMs: 1, fetchFn: mockFetch as unknown as typeof fetch });

      await expect(client.createChatCompletion({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(ModelServiceError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("Health Check", () => {
    it("returns unconfigured status when no API key is set", async () => {
      const client = new MetaModelClient({ apiKey: "" });
      const health = await client.healthCheck();
      expect(health.status).toBe("unconfigured");
      expect(health.message).toContain("missing");
    });

    it("returns healthy status when endpoint probe succeeds", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const client = new MetaModelClient({
        apiKey: "valid-key",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const health = await client.healthCheck();
      expect(health.status).toBe("healthy");
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});
