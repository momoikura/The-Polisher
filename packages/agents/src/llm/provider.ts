/**
 * LLM Provider abstraction — wraps the Vercel AI SDK for PolishLoop.
 *
 * Provides a unified interface for calling any supported LLM provider
 * with automatic token tracking for the cost system.
 */

import { generateText, generateObject, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { z } from "zod";

/** Supported LLM providers. */
export type ProviderName = "openai" | "anthropic" | "google";

/** Result from an LLM call, including token usage. */
export interface LLMResult<T = string> {
  output: T;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/** Configuration for creating an LLM provider. */
export interface ProviderConfig {
  provider: ProviderName;
  apiKey: string;
  modelId: string;
}

/**
 * Detect which providers are available based on environment variables.
 */
export function getAvailableProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  if (process.env.OPENAI_API_KEY) {
    providers.push({
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      modelId: "gpt-4o",
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    providers.push({
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      modelId: "claude-sonnet-4-20250514",
    });
  }

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    providers.push({
      provider: "google",
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      modelId: "gemini-2.5-pro",
    });
  }

  return providers;
}

/**
 * Create a Vercel AI SDK LanguageModel from a provider config.
 */
export function createModel(config: ProviderConfig): LanguageModel {
  switch (config.provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey: config.apiKey });
      return openai(config.modelId);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: config.apiKey });
      return anthropic(config.modelId);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
      return google(config.modelId);
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Call an LLM with a text prompt and return the result with token usage.
 */
export async function callLLM(
  model: LanguageModel,
  modelId: string,
  system: string,
  prompt: string
): Promise<LLMResult<string>> {
  const result = await generateText({
    model,
    system,
    prompt,
    maxRetries: 3,
  });

  return {
    output: result.text,
    model: modelId,
    promptTokens: result.usage?.promptTokens ?? 0,
    completionTokens: result.usage?.completionTokens ?? 0,
  };
}

/**
 * Call an LLM with structured output (JSON schema validation via Zod).
 */
export async function callLLMStructured<T>(
  model: LanguageModel,
  modelId: string,
  system: string,
  prompt: string,
  schema: z.ZodType<T>,
  schemaName: string
): Promise<LLMResult<T>> {
  const result = await generateObject({
    model,
    system,
    prompt,
    schema,
    schemaName,
    maxRetries: 3,
  });

  return {
    output: result.object,
    model: modelId,
    promptTokens: result.usage?.promptTokens ?? 0,
    completionTokens: result.usage?.completionTokens ?? 0,
  };
}
