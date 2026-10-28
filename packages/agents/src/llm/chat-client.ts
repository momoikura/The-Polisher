/**
 * Minimal chat interface the specialist agents depend on.
 * Any provider (Meta Model API, test fakes) can satisfy it.
 */

import type { z } from "zod";
import { textOf, type ChatMessage, type MetaModelClient } from "./meta-client.js";

export interface ChatCompletion {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface ChatClient {
  complete(messages: ChatMessage[], options?: ChatOptions): Promise<ChatCompletion>;
}

export function chatClientFromMeta(client: MetaModelClient): ChatClient {
  return {
    async complete(messages, options) {
      const res = await client.createChatCompletion({
        messages,
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      });
      return {
        text: textOf(res.choices[0]?.message.content),
        model: res.model,
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
      };
    },
  };
}

// ─── Structured output ───────────────────────────────────────────────────────

export class StructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Pull the JSON object out of a reply that may be wrapped in prose or a ```json fence.
 * The whole reply is tried first: JSON values often contain markdown with their own
 * code fences (READMEs), which must not be mistaken for the wrapper.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const whole = tryParse(trimmed);
  if (whole.ok) return whole.value;

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    const inner = tryParse(fenced[1].trim());
    if (inner.ok) return inner.value;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new StructuredOutputError("Model reply did not contain a JSON object.");
  }
  const sliced = tryParse(trimmed.slice(start, end + 1));
  if (sliced.ok) return sliced.value;
  throw new StructuredOutputError(`Model reply contained invalid JSON: ${sliced.error}`);
}

const MAX_ATTEMPTS = 2;

/**
 * Ask for JSON and validate it. One corrective retry is allowed; a reply that
 * still fails validation is an error, never a silently-defaulted result.
 */
export async function completeStructured<T>(
  client: ChatClient,
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  options?: ChatOptions
): Promise<StructuredResult<T>> {
  let conversation = [...messages];
  let promptTokens = 0;
  let completionTokens = 0;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const reply = await client.complete(conversation, options);
    promptTokens += reply.promptTokens;
    completionTokens += reply.completionTokens;

    try {
      const parsed = schema.safeParse(extractJson(reply.text));
      if (parsed.success) {
        return { data: parsed.data, model: reply.model, promptTokens, completionTokens };
      }
      lastError = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    conversation = [
      ...conversation,
      { role: "assistant", content: reply.text },
      {
        role: "user",
        content: `Your reply was rejected: ${lastError}. Reply again with ONLY a JSON object matching the required schema.`,
      },
    ];
  }

  throw new StructuredOutputError(`Structured output invalid after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}
