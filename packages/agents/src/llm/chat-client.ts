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

/** Tokens a call consumed, so a failed call still counts against the budget. */
export interface TokenUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export class StructuredOutputError extends Error {
  constructor(message: string, readonly usage?: TokenUsage) {
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

const MAX_CANDIDATES = 50;

/** End index of the balanced {...} starting at `start`, skipping braces inside strings; -1 if unbalanced. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Every JSON object in a reply, in order. The whole reply is tried first: JSON
 * values often contain markdown with their own code fences (READMEs). After that,
 * each balanced {...} is tried, so prose before or after the object (or a second
 * object) doesn't sink a valid answer.
 */
export function extractJsonCandidates(text: string): unknown[] {
  const trimmed = text.trim();
  const whole = tryParse(trimmed);
  if (whole.ok) return [whole.value];

  const found: unknown[] = [];
  let firstError = "";
  for (let start = trimmed.indexOf("{"); start !== -1 && found.length < MAX_CANDIDATES; ) {
    const end = objectEnd(trimmed, start);
    if (end === -1) break;
    const parsed = tryParse(trimmed.slice(start, end + 1));
    if (parsed.ok) {
      found.push(parsed.value);
      start = trimmed.indexOf("{", end + 1);
    } else {
      firstError ||= parsed.error;
      start = trimmed.indexOf("{", start + 1);
    }
  }
  if (found.length) return found;
  throw new StructuredOutputError(
    firstError ? `Model reply contained invalid JSON: ${firstError}` : "Model reply did not contain a JSON object."
  );
}

/** The first JSON object in a reply that may be wrapped in prose or a ```json fence. */
export function extractJson(text: string): unknown {
  return extractJsonCandidates(text)[0];
}

const MAX_ATTEMPTS = 2;

/**
 * Ask for JSON and validate it. One corrective retry is allowed; a reply that
 * still fails validation is an error, never a silently-defaulted result.
 */
export async function completeStructured<T>(
  client: ChatClient,
  messages: ChatMessage[],
  // Input type left open so schemas with .default() infer T as their parsed output.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options?: ChatOptions
): Promise<StructuredResult<T>> {
  let conversation = [...messages];
  let promptTokens = 0;
  let completionTokens = 0;
  let lastError = "";
  let model = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const reply = await client.complete(conversation, options);
    model = reply.model;
    promptTokens += reply.promptTokens;
    completionTokens += reply.completionTokens;

    try {
      const candidates = extractJsonCandidates(reply.text).map((c) => schema.safeParse(c));
      const valid = candidates.find((c) => c.success);
      if (valid?.success) {
        return { data: valid.data, model: reply.model, promptTokens, completionTokens };
      }
      lastError = (candidates[0]?.error?.issues ?? [])
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

  throw new StructuredOutputError(`Structured output invalid after ${MAX_ATTEMPTS} attempts: ${lastError}`, {
    model,
    promptTokens,
    completionTokens,
  });
}
