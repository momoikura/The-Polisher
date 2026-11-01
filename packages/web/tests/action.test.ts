import { describe, expect, it } from "vitest";

const { MARKER, runAction } = await import(new URL("../../../action/check.mjs", import.meta.url).href);

type Call = { url: string; method: string; body?: string };

function harness(overrides: { start?: Array<[number, object]>; run?: object; comments?: object[]; commentStatus?: number } = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const starts = [...(overrides.start ?? [[201, { id: "r1" }]])];
  const json = (status: number, data: unknown) => ({ ok: status < 400, status, json: async () => data });
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body as string | undefined });
    if (url.endsWith("/api/check")) return json(...(starts.shift() as [number, object]));
    if (url.includes("/api/runs/")) return json(200, overrides.run ?? { record: { status: "verified" }, events: [{ type: "pr_check", check: { headline: "Its tests show it works", comment: "the result" } }] });
    if (url.includes("/comments") && (init.method ?? "GET") === "GET") return json(200, overrides.comments ?? []);
    return json(overrides.commentStatus ?? 201, {});
  };
  const run = () =>
    runAction({
      env: { "INPUT_META-API-KEY": "secret-key", "INPUT_GITHUB-TOKEN": "gh", INPUT_SERVER: "https://site/", GITHUB_REPOSITORY: "o/r" },
      fetch,
      readEvent: () => ({ pull_request: { html_url: "https://github.com/o/r/pull/7", number: 7 } }),
      log: (m: string) => logs.push(m),
      sleep: async () => {},
    });
  return { calls, logs, run };
}

describe("the GitHub Action", () => {
  it("sends only the link and the key, waits, then comments on the PR", async () => {
    const { calls, run } = harness();

    await run();

    expect(JSON.parse(calls[0].body ?? "")).toEqual({ pullUrl: "https://github.com/o/r/pull/7", metaApiKey: "secret-key" });
    const posted = calls.at(-1);
    expect(posted).toMatchObject({ url: "https://api.github.com/repos/o/r/issues/7/comments", method: "POST" });
    expect(JSON.parse(posted?.body ?? "").body).toContain("the result");
  });

  it("updates its comment instead of adding another", async () => {
    const { calls, run } = harness({ comments: [{ id: 99, body: `${MARKER}\nold` }] });

    await run();

    expect(calls.at(-1)).toMatchObject({ url: "https://api.github.com/repos/o/r/issues/comments/99", method: "PATCH" });
  });

  it("waits its turn when the repo already has a check running", async () => {
    const { calls, run } = harness({ start: [[429, { error: "busy" }], [201, { id: "r1" }]] });

    await run();

    expect(calls.filter((c) => c.url.endsWith("/api/check"))).toHaveLength(2);
  });

  it("warns without failing the workflow, and posts nothing, when the check can't run", async () => {
    const { calls, logs, run } = harness({ start: [[400, { error: "This pull request changes no Python files" }]] });

    await expect(run()).resolves.toBeUndefined();

    expect(logs.join()).toContain("::warning::ThePolisher couldn't check this PR: This pull request changes no Python files");
    expect(calls.some((c) => c.url.includes("api.github.com"))).toBe(false);
  });

  it("reports a check that stopped with an error", async () => {
    const { logs, run } = harness({ run: { record: { status: "failed" }, events: [{ type: "error", message: "Too large" }] } });

    await run();

    expect(logs.join()).toContain("Too large");
  });

  it("hides the key in the workflow's logs", async () => {
    const { logs, run } = harness();

    await run();

    expect(logs[0]).toBe("::add-mask::secret-key");
  });
});
