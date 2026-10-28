/** Claude adapter tests against a fake SDK; no network calls, no spend. */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ClaudeChatClient,
  DEFAULT_CLAUDE_MODEL,
  effectivePromptTokens,
  resolveClaudeConfig,
  toClaudeRequest,
} from "../src/llm/anthropic-client.js";

type Params = Record<string, unknown>;

function fakeSdk(message: Record<string, unknown>) {
  const calls: Params[] = [];
  const sdk = {
    beta: {
      messages: {
        stream(params: Params) {
          calls.push(params);
          return { finalMessage: async () => message };
        },
      },
    },
  };
  return { sdk: sdk as never, calls };
}

const reply = (overrides: Record<string, unknown> = {}) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  stop_details: null,
  content: [
    { type: "thinking", thinking: "" },
    { type: "text", text: '{"ok":' },
    { type: "text", text: "true}" },
  ],
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
  ...overrides,
});

describe("toClaudeRequest", () => {
  it("lifts system messages to the top-level system prompt", () => {
    const req = toClaudeRequest([
      { role: "system", content: "Be strict." },
      { role: "user", content: "Hi" },
    ]);
    expect(req.system).toBe("Be strict.");
    expect(req.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("turns image data URLs into base64 image blocks", () => {
    const req = toClaudeRequest([
      {
        role: "user",
        content: [
          { type: "text", text: "Study this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          { type: "image_url", image_url: { url: "https://example.com/a.png" } },
        ],
      },
    ]);
    expect(req.messages[0].content).toEqual([
      { type: "text", text: "Study this" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      { type: "image", source: { type: "url", url: "https://example.com/a.png" } },
    ]);
  });
});

describe("ClaudeChatClient", () => {
  beforeEach(() => {
    delete process.env.CLAUDE_MODEL;
    delete process.env.CLAUDE_EFFORT;
  });

  it("defaults to Opus 5.5 at high effort, overridable from the environment", () => {
    expect(resolveClaudeConfig()).toMatchObject({ model: DEFAULT_CLAUDE_MODEL, effort: "high" });
    process.env.CLAUDE_MODEL = "claude-haiku-5-5";
    process.env.CLAUDE_EFFORT = "low";
    expect(resolveClaudeConfig()).toMatchObject({ model: "claude-haiku-5-5", effort: "low" });
    process.env.CLAUDE_EFFORT = "turbo";
    expect(resolveClaudeConfig().effort).toBe("high");
  });

  it("joins text blocks, skips thinking, and never sends temperature", async () => {
    const { sdk, calls } = fakeSdk(reply());
    const client = new ClaudeChatClient({ sdk });
    const result = await client.complete([{ role: "user", content: "x" }], { temperature: 0.7 });

    expect(result.text).toBe('{"ok":true}');
    expect(calls[0]).not.toHaveProperty("temperature");
    expect(calls[0]).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "high" }, cache_control: { type: "ephemeral" } });
  });

  it("opts into refusal fallbacks on Opus, but not on Haiku", async () => {
    const opus = fakeSdk(reply());
    await new ClaudeChatClient({ sdk: opus.sdk }).complete([{ role: "user", content: "x" }]);
    expect(opus.calls[0]).toMatchObject({ betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });

    const haiku = fakeSdk(reply({ model: "claude-haiku-5-5" }));
    await new ClaudeChatClient({ sdk: haiku.sdk, model: "claude-haiku-5-5" }).complete([{ role: "user", content: "x" }]);
    expect(haiku.calls[0]).not.toHaveProperty("fallbacks");
  });

  it("prices cache reads at a tenth of normal input", async () => {
    const { sdk } = fakeSdk(reply());
    const result = await new ClaudeChatClient({ sdk }).complete([{ role: "user", content: "x" }]);
    expect(result.promptTokens).toBe(200);
    expect(effectivePromptTokens({ input_tokens: 0, cache_creation_input_tokens: 100 })).toBe(125);
  });

  it("raises on a refusal instead of returning empty text", async () => {
    const { sdk } = fakeSdk(reply({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }));
    await expect(new ClaudeChatClient({ sdk }).complete([{ role: "user", content: "x" }])).rejects.toThrow(/declined.*cyber/);
  });

  it("raises when the output is cut off at max_tokens", async () => {
    const { sdk } = fakeSdk(reply({ stop_reason: "max_tokens" }));
    await expect(new ClaudeChatClient({ sdk }).complete([{ role: "user", content: "x" }])).rejects.toThrow(/output limit/);
  });
});
