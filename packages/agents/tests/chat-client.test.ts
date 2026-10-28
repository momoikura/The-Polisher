import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  completeStructured,
  extractJson,
  StructuredOutputError,
  type ChatClient,
} from "../src/llm/chat-client.js";

function scripted(replies: string[]): ChatClient & { calls: number } {
  const client = {
    calls: 0,
    async complete() {
      const text = replies[Math.min(client.calls, replies.length - 1)];
      client.calls++;
      return { text, model: "fake", promptTokens: 5, completionTokens: 7 };
    },
  };
  return client;
}

const Schema = z.object({ score: z.number().min(0).max(100) });

describe("extractJson", () => {
  it("parses JSON wrapped in a code fence with surrounding prose", () => {
    expect(extractJson('Here you go:\n```json\n{"score": 80}\n```\nThanks')).toEqual({ score: 80 });
  });

  it("is not fooled by code fences inside JSON string values", () => {
    const value = { readme: "Usage:\n```python\nslugify('a b')\n```\n" };
    expect(extractJson(JSON.stringify(value))).toEqual(value);
  });

  it("throws when the reply contains no JSON object", () => {
    expect(() => extractJson("I cannot help with that.")).toThrow(StructuredOutputError);
  });
});

describe("completeStructured", () => {
  it("returns validated data on the first valid reply", async () => {
    const client = scripted(['{"score": 72}']);
    const result = await completeStructured(client, [{ role: "user", content: "x" }], Schema);
    expect(result.data.score).toBe(72);
    expect(client.calls).toBe(1);
  });

  it("retries once after a schema violation and sums token usage", async () => {
    const client = scripted(['{"score": 150}', '{"score": 90}']);
    const result = await completeStructured(client, [{ role: "user", content: "x" }], Schema);
    expect(result.data.score).toBe(90);
    expect(client.calls).toBe(2);
    expect(result.promptTokens).toBe(10);
  });

  it("throws instead of defaulting when every reply is malformed", async () => {
    const client = scripted(["not json", '{"score": "high"}']);
    await expect(
      completeStructured(client, [{ role: "user", content: "x" }], Schema)
    ).rejects.toThrow(/invalid after 2 attempts/);
  });
});
