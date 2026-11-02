import { describe, expect, it } from "vitest";
import { CHALLENGE_PATH, runChallenge } from "../src/maintainer/challenge.js";
import type { ChatClient, ChatOptions } from "../src/llm/chat-client.js";
import { DEMO_SNAPSHOT, createSimulatedMaintainerClient, createSimulatedSandbox } from "../src/maintainer/simulated.js";
import { runMaintainer } from "../src/maintainer/orchestrator.js";
import type { MaintainerEvent } from "../src/maintainer/events.js";
import type { SandboxClient, ValidateRequest, Validation } from "../src/maintainer/sandbox.js";

const TESTS = `from tinyslug import slugify


def test_only_punctuation():
    assert slugify("!!!") == ""


async def test_unicode():
    assert slugify("Cafe") == "cafe"
`;
const bundle = { code: { "tinyslug/__init__.py": "fixed = True\n" }, docs: {}, pr: "" };

const replyWith = (text: string) => {
  const seen: ChatOptions[] = [];
  const client: ChatClient = {
    complete: async (_messages, options) => {
      seen.push(options ?? {});
      return { text, model: "muse-wonder-1.0", promptTokens: 100, completionTokens: 50 };
    },
  };
  return { client, seen };
};
const tests = (failures: Array<{ test: string; message: string }>, ran = true) =>
  ({ ran, total: 10, passed: 10 - failures.length, failed: failures.length, errors: 0, skipped: 0, failures, outputTail: "" }) as Validation["tests"];
const sandboxWith = (result: Partial<Validation>) => {
  const requests: ValidateRequest[] = [];
  const sandbox: SandboxClient = {
    validate: async (req) => {
      requests.push(req);
      return { install: { ok: true, logTail: "" }, compile: { ok: true, errors: [] }, lint: { issues: [] }, tests: tests([]), failToPass: null, durationMs: 1, ...result } as Validation;
    },
  };
  return { sandbox, requests };
};
const challenge = (client: ChatClient, sandbox: SandboxClient) => runChallenge({ client, sandbox, snapshot: DEMO_SNAPSHOT, bundle, model: "muse-wonder-1.0" });
const toPass = { newTests: [CHALLENGE_PATH], failedOnBase: false, passedAfter: true };
const json = JSON.stringify({ tests: TESTS, ideas: ["only punctuation"] });

describe("runChallenge", () => {
  it("asks the stronger model for its own tests, and runs them against the final patch", async () => {
    const { client, seen } = replyWith(json);
    const { sandbox, requests } = sandboxWith({ failToPass: toPass });

    const result = await challenge(client, sandbox);

    expect(seen[0].model).toBe("muse-wonder-1.0");
    expect(requests[0].changes).toMatchObject({ ...bundle.code, [CHALLENGE_PATH]: TESTS });
    expect(requests[0].newTests).toEqual([CHALLENGE_PATH]);
    expect(result).toMatchObject({ model: "muse-wonder-1.0", total: 2, passed: 2, failures: [] });
  });

  it("reports which of its tests the fix didn't survive", async () => {
    const { client } = replyWith(json);
    const failure = { test: "tests.test_thepolisher_challenge::test_unicode", message: "assert 'x' == 'cafe'" };
    const other = { test: "tests.test_other::test_old", message: "unrelated" };
    const { sandbox } = sandboxWith({ tests: tests([failure, other]), failToPass: { ...toPass, passedAfter: false } });

    const result = await challenge(client, sandbox);

    expect(result).toMatchObject({ total: 2, passed: 1, failures: [failure] });
  });

  describe("a failing test, checked on the original code", () => {
    const failure = { test: "tests.test_thepolisher_challenge::test_unicode", message: "boom" };
    const run = async (onOriginal: () => Validation) => {
      const { client } = replyWith(json);
      const requests: ValidateRequest[] = [];
      const sandbox: SandboxClient = {
        validate: async (req) => {
          requests.push(req);
          if (!("tinyslug/__init__.py" in req.changes)) return onOriginal();
          return { install: { ok: true, logTail: "" }, compile: { ok: true, errors: [] }, lint: { issues: [] }, tests: tests([failure]), failToPass: { ...toPass, passedAfter: false }, durationMs: 1 } as Validation;
        },
      };
      return { result: await challenge(client, sandbox), requests };
    };
    const original = (failures: Array<{ test: string; message: string }>, ran = true) => ({ tests: tests(failures, ran) }) as Validation;

    it("is a likely wrong guess when it fails there too", async () => {
      const { result } = await run(() => original([failure]));
      expect(result?.failures[0].failsOnOriginal).toBe(true);
    });

    it("is a regression when it passes there", async () => {
      const { result } = await run(() => original([]));
      expect(result?.failures[0].failsOnOriginal).toBe(false);
    });

    it("stays unknown when the original code can't tell us", async () => {
      expect((await run(() => original([], false))).result?.failures[0].failsOnOriginal).toBeUndefined();
      expect((await run(() => original([{ test: "::tests.test_thepolisher_challenge", message: "import" }]))).result?.failures[0].failsOnOriginal).toBeUndefined();
      const failed = await run(() => {
        throw new Error("sandbox down");
      });
      expect(failed.result?.failures[0].failsOnOriginal).toBeUndefined();
    });
  });

  it("lets the model fix a test that also fails on the original code", async () => {
    const replies = [json, JSON.stringify({ tests: TESTS.replace("== \"cafe\"", "== \"cafe!\""), ideas: [] })];
    const asked: string[] = [];
    const client: ChatClient = {
      complete: async (messages) => {
        asked.push(String(messages.at(-1)?.content ?? ""));
        return { text: replies.shift() ?? json, model: "muse-wonder-1.0", promptTokens: 1, completionTokens: 1 };
      },
    };
    const failure = { test: "tests.test_thepolisher_challenge::test_unicode", message: "boom" };
    let patchedRuns = 0;
    const sandbox: SandboxClient = {
      validate: async (req) => {
        const onPatch = "tinyslug/__init__.py" in req.changes;
        if (onPatch) patchedRuns++;
        // The first version fails on both; the revised one passes on the patch.
        const failing = patchedRuns === 1 || !onPatch ? [failure] : [];
        return { install: { ok: true, logTail: "" }, compile: { ok: true, errors: [] }, lint: { issues: [] }, tests: tests(failing), failToPass: { ...toPass, passedAfter: failing.length === 0 }, durationMs: 1 } as Validation;
      },
    };

    const result = await challenge(client, sandbox);

    expect(asked[1]).toContain("also fail on the original code");
    expect(result).toMatchObject({ total: 2, passed: 2, failures: [] });
  });

  it("claims nothing when the tests didn't really run", async () => {
    const { client } = replyWith(json);

    expect(await challenge(client, sandboxWith({ tests: tests([], false), failToPass: toPass }).sandbox)).toBeNull();
    expect(await challenge(client, sandboxWith({ failToPass: { ...toPass, passedAfter: false } }).sandbox)).toBeNull();
  });

  it("claims nothing when pytest couldn't import the file", async () => {
    const { client } = replyWith(json);
    const broken = { test: "::tests.test_thepolisher_challenge", message: "collection failure" };

    expect(await challenge(client, sandboxWith({ tests: tests([broken]), failToPass: { ...toPass, passedAfter: false } }).sandbox)).toBeNull();
  });

  it("charges for the model call even when the tests can't be used", async () => {
    const { client } = replyWith(JSON.stringify({ tests: "x = 1\n", ideas: [] }));
    const charged: string[] = [];

    await runChallenge({ client, sandbox: sandboxWith({}).sandbox, snapshot: DEMO_SNAPSHOT, bundle, model: "muse-wonder-1.0", charge: (u) => charged.push(u.model) });

    expect(charged).toEqual(["muse-wonder-1.0"]);
  });

  it("shows the model the changed code in full, not just the diff", async () => {
    let prompt = "";
    const client: ChatClient = {
      complete: async (messages) => {
        prompt = JSON.stringify(messages);
        return { text: json, model: "muse-wonder-1.0", promptTokens: 1, completionTokens: 1 };
      },
    };
    const code = { "tinyslug/__init__.py": "# a line the change didn't touch\nfixed = True\n" };

    await runChallenge({ client, sandbox: sandboxWith({ failToPass: toPass }).sandbox, snapshot: { ...DEMO_SNAPSHOT, files: { ...DEMO_SNAPSHOT.files, "tinyslug/__init__.py": "# a line the change didn't touch\nfixed = False\n" } }, bundle: { code, docs: {}, pr: "" }, model: "muse-wonder-1.0" });

    expect(prompt).toContain("a line the change didn't touch");
  });

  it("claims nothing when the model wrote no tests", async () => {
    const { client } = replyWith(JSON.stringify({ tests: "x = 1\n", ideas: [] }));

    expect(await challenge(client, sandboxWith({ failToPass: toPass }).sandbox)).toBeNull();
  });
});

describe("the challenge in a run", () => {
  const fast = { min: 0, max: 0 };
  const WONDER = "muse-wonder-1.0";

  async function run(options: { challengeModel?: string; wonder: () => string }) {
    const spark = createSimulatedMaintainerClient(fast);
    const asked: string[] = [];
    const client: ChatClient = {
      complete: async (messages, chat) => {
        if (chat?.model !== WONDER) return spark.complete(messages, chat);
        asked.push(WONDER);
        return { text: options.wonder(), model: WONDER, promptTokens: 1000, completionTokens: 1000 };
      },
    };
    const simulated = createSimulatedSandbox(fast);
    const sandbox: SandboxClient = {
      validate: async (req) => {
        if (!req.newTests?.includes(CHALLENGE_PATH)) return simulated.validate(req);
        return { install: { ok: true, logTail: "" }, compile: { ok: true, errors: [] }, lint: { issues: [] }, tests: tests([]), failToPass: toPass, durationMs: 1 } as Validation;
      },
    };
    const events: MaintainerEvent[] = [];
    const result = await runMaintainer(
      { kind: "snapshot", snapshot: DEMO_SNAPSHOT },
      { client, sandbox, onEvent: (e) => events.push(e), provider: "simulated", ...(options.challengeModel ? { challengeModel: options.challengeModel } : {}) }
    );
    return { result, events, asked };
  }

  it("runs on a proven fix, is reported and charged, and leaves the verdict alone", async () => {
    const plain = await run({ wonder: () => json });
    const challenged = await run({ challengeModel: WONDER, wonder: () => json });

    expect(plain.asked).toEqual([]);
    expect(plain.result.challenge).toBeNull();
    expect(challenged.result.proof?.proven).toBe(true);
    expect(challenged.result.challenge).toMatchObject({ total: 2, passed: 2 });
    expect(challenged.events.some((e) => e.type === "challenge")).toBe(true);
    expect(challenged.result.status).toBe(plain.result.status);
    expect(challenged.result.totalUSD).toBeGreaterThan(plain.result.totalUSD);
  });

  it("just leaves it out when the model fails", async () => {
    const plain = await run({ wonder: () => json });
    const { result, events } = await run({
      challengeModel: WONDER,
      wonder: () => {
        throw new Error("model unavailable");
      },
    });

    expect(result.challenge).toBeNull();
    expect(events.some((e) => e.type === "challenge")).toBe(false);
    expect(result.status).toBe(plain.result.status);
  });
});
