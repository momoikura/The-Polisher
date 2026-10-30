import { describe, it, expect } from "vitest";
import { TimeLimitError } from "@thepolisher/core";
import { clientUntil, sandboxUntil } from "../src/maintainer/deadline.js";
import type { ChatClient, ChatOptions } from "../src/llm/chat-client.js";
import type { SandboxClient, Validation } from "../src/maintainer/sandbox.js";

const never = <T>() => new Promise<T>(() => {});
const reply = { text: "{}", model: "m", promptTokens: 1, completionTokens: 1 };
const request = { repo: "o/r", sha: "abc", changes: {}, newTests: [] };

describe("clientUntil", () => {
  it("passes calls through before the deadline, with the signal for cancelling them", async () => {
    let seen: ChatOptions | undefined;
    const client: ChatClient = { complete: async (_m, options) => ((seen = options), reply) };
    const stop = new AbortController();

    await expect(clientUntil(client, stop.signal).complete([], { temperature: 0 })).resolves.toEqual(reply);
    expect(seen).toMatchObject({ temperature: 0, signal: stop.signal });
  });

  it("stops a call in flight when the deadline passes", async () => {
    const stop = new AbortController();
    const call = clientUntil({ complete: never }, stop.signal).complete([]);

    stop.abort();

    await expect(call).rejects.toBeInstanceOf(TimeLimitError);
  });

  it("starts no call after the deadline", async () => {
    let calls = 0;
    const stop = new AbortController();
    stop.abort();

    await expect(clientUntil({ complete: async () => (calls++, reply) }, stop.signal).complete([])).rejects.toBeInstanceOf(TimeLimitError);
    expect(calls).toBe(0);
  });
});

describe("sandboxUntil", () => {
  it("stops waiting for a sandbox run when the deadline passes", async () => {
    const stop = new AbortController();
    const sandbox: SandboxClient = { validate: never<Validation> };
    const run = sandboxUntil(sandbox, stop.signal).validate(request);

    stop.abort();

    await expect(run).rejects.toBeInstanceOf(TimeLimitError);
  });
});
