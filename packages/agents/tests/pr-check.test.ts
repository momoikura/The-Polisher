import { describe, expect, it } from "vitest";
import { isPullUrl, judgePr, parsePullUrl, prCheckComment, runPrCheck } from "../src/maintainer/pr-check.js";
import { createRescue } from "../src/maintainer/rescue.js";
import { proofFrom } from "../src/maintainer/proof.js";
import type { ChatClient } from "../src/llm/chat-client.js";
import type { GitHubClient } from "../src/maintainer/github.js";
import type { MaintainerEvent } from "../src/maintainer/events.js";
import type { SandboxClient, ValidateRequest, Validation } from "../src/maintainer/sandbox.js";

type Ftp = { failedOnBase: boolean; passedAfter: boolean; baseFailures?: { reproduced: number; missingCode: number; example: string } };

function validation(tests: Partial<Validation["tests"]>, ftp: Ftp | null): Validation {
  return {
    install: { ok: true, logTail: "" },
    compile: { ok: true, errors: [] },
    lint: { issues: [] },
    security: { newIssues: [] },
    tests: { ran: true, total: 100, passed: 100, failed: 0, errors: 0, skipped: 0, failures: [], outputTail: "", ...tests },
    failToPass: ftp && { newTests: ["tests/test_a.py"], baseFailures: { reproduced: 1, missingCode: 0, example: "assert" }, ...ftp },
    durationMs: 1,
  } as unknown as Validation;
}
const judge = (v: Validation) => judgePr(v, proofFrom(v));
const works: Ftp = { failedOnBase: true, passedAfter: true };

describe("the link to a pull request", () => {
  it("accepts a PR and its tabs", () => {
    expect(parsePullUrl("https://github.com/o/r/pull/12")).toEqual({ owner: "o", repo: "r", number: 12 });
    expect(parsePullUrl("https://github.com/o/r/pull/12/files")).toMatchObject({ number: 12 });
  });

  it("refuses anything else", () => {
    expect(isPullUrl("https://github.com/o/r/issues/12")).toBe(false);
    expect(isPullUrl("https://evil.example/o/r/pull/12")).toBe(false);
    expect(isPullUrl("https://github.com/../r/pull/12")).toBe(false);
  });
});

describe("the verdict on a pull request", () => {
  it("is proven when its tests fail before and pass after, with nothing else broken", () => {
    expect(judge(validation({}, works)).verdict).toBe("proven");
  });

  it("names tests it newly breaks, ahead of its own tests passing", () => {
    const v = judge(validation({ failed: 2, passed: 98 }, works));
    expect(v.verdict).toBe("new_failures");
    expect(v.headline).toContain("2 tests");
  });

  it("doesn't blame the PR for tests that already failed", () => {
    expect(judge(validation({ failed: 3, passed: 97, preexistingCount: 3 }, works)).verdict).toBe("proven");
  });

  it("says so when no tests come with it", () => {
    expect(judge(validation({}, null)).verdict).toBe("no_tests");
    expect(judge(validation({ failed: 1, passed: 99 }, null)).verdict).toBe("new_failures");
  });

  it("catches tests that prove nothing", () => {
    expect(judge(validation({}, { failedOnBase: false, passedAfter: true })).verdict).toBe("tests_pass_without_it");
    expect(judge(validation({ failed: 1, passed: 99 }, { failedOnBase: true, passedAfter: false })).verdict).toBe("tests_fail");
  });

  it("doesn't call a new feature's tests a bug being fixed", () => {
    const missing = { failedOnBase: true, passedAfter: true, baseFailures: { reproduced: 0, missingCode: 2, example: "ImportError" } };
    expect(judge(validation({}, missing)).verdict).toBe("only_new_code");
  });

  it("claims nothing when the suite didn't run", () => {
    expect(judge(validation({ ran: false, total: 0, passed: 0 }, null)).verdict).toBe("not_run");
    expect(judge(validation({ total: 95, passed: 0, failed: 95, preexistingCount: 95 }, works)).verdict).toBe("not_run");
  });
});

describe("the comment for the maintainer", () => {
  const check = { headline: "Its tests show it works", detail: "All good.", notApplied: [] as string[] };

  it("reports the result and what wasn't tested", () => {
    const comment = prCheckComment({ ...check, notApplied: ["data.json"] }, null, "https://site/runs/1");
    expect(comment).toContain("**Its tests show it works.**");
    expect(comment).toContain("`data.json`");
    expect(comment).toContain("https://site/runs/1");
  });

  it("includes the independent tests, and whether the PR caused a failure", () => {
    const challenge = { model: "muse-wonder-1.0", total: 3, passed: 2, tests: "", ideas: [], failures: [{ test: "t::x`y", message: "", failsOnOriginal: false }] };
    const comment = prCheckComment(check, challenge, null);
    expect(comment).toContain("2 of 3 pass");
    expect(comment).toContain("`t::x'y` doesn't pass, but passes on the original code");
  });
});

describe("checking a pull request", () => {
  const github = (files: Array<{ path: string; status: string }>) =>
    ({
      getPullRequest: async () => ({ title: "Fix it", body: "text", baseSha: "base", baseBranch: "main", headSha: "head", headOwner: "fork", headRepo: "r", files }),
      getFile: async (owner: string, _repo: string, path: string, sha: string) => {
        if (sha === "base" && path.includes("test_")) throw new Error("404");
        return `# ${owner} ${sha} ${path}\n`;
      },
    }) as unknown as GitHubClient;
  const wonder: ChatClient = {
    complete: async () => ({ text: JSON.stringify({ tests: "def test_a():\n    assert True\n", ideas: [] }), model: "muse-wonder-1.0", promptTokens: 1000, completionTokens: 1000 }),
  };
  const sandbox = (requests: ValidateRequest[]): SandboxClient => ({
    validate: async (req) => {
      requests.push(req);
      return validation({}, { ...works, failedOnBase: req.newTests[0] !== "tests/test_thepolisher_challenge.py" });
    },
  });
  const files = [
    { path: "pkg/a.py", status: "modified" },
    { path: "tests/test_a.py", status: "added" },
    { path: "data.json", status: "modified" },
    { path: "pkg/old.py", status: "removed" },
  ];

  it("runs the PR's code on the commit it branched from, and reports what it couldn't apply", async () => {
    const events: MaintainerEvent[] = [];
    const requests: ValidateRequest[] = [];

    const result = await runPrCheck("https://github.com/o/r/pull/7", { github: github(files), sandbox: sandbox(requests), client: wonder, challengeModel: "muse-wonder-1.0", budgetUSD: 3, onEvent: (e) => events.push(e) });

    expect(requests[0]).toMatchObject({ repo: "o/r", sha: "base", newTests: ["tests/test_a.py"], scope: "full" });
    expect(Object.keys(requests[0].changes)).toEqual(["pkg/a.py", "tests/test_a.py"]);
    expect(requests[0].changes["pkg/a.py"]).toContain("fork head");
    expect(result.check.verdict).toBe("proven");
    expect(result.check.notApplied).toEqual(["data.json", "pkg/old.py"]);
    expect(result.challenge).toMatchObject({ passed: 1, total: 1 });
    expect(result.totalUSD).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ type: "complete", canOpenPr: false, status: "verified" });
    expect(events.some((e) => e.type === "pr_check")).toBe(true);
  });

  it("still reports the check when the stronger model fails", async () => {
    const broken: ChatClient = {
      complete: async () => {
        throw new Error("model unavailable");
      },
    };
    const result = await runPrCheck("https://github.com/o/r/pull/7", { github: github(files), sandbox: sandbox([]), client: broken, challengeModel: "muse-wonder-1.0", budgetUSD: 3, onEvent: () => {} });

    expect(result.check.verdict).toBe("proven");
    expect(result.challenge).toBeNull();
  });

  it("stops early on a PR with no Python to run", async () => {
    const run = runPrCheck("https://github.com/o/r/pull/7", { github: github([{ path: "README.md", status: "modified" }]), sandbox: sandbox([]), client: wonder, budgetUSD: 3, onEvent: () => {} });
    await expect(run).rejects.toThrow("no Python files");
  });
});

describe("the rescue when Muse Spark is stuck", () => {
  const rescue = (over: Partial<{ hasRoom: () => boolean; isProven: () => boolean }> = {}) => {
    const used: string[] = [];
    return { used, ...createRescue({ model: "muse-wonder-1.0", hasRoom: () => true, isProven: () => false, onUse: (m) => used.push(m), ...over }) };
  };

  it("leaves everything to Muse Spark until it's stuck", () => {
    const r = rescue();
    expect(r.modelForRepair()).toBeUndefined();
    expect(r.used).toEqual([]);
  });

  it("takes one revision, then hands back", () => {
    const r = rescue();
    r.markStuck();
    expect(r.modelForRepair()).toBe("muse-wonder-1.0");
    expect(r.modelForRepair()).toBeUndefined();
    expect(r.used).toHaveLength(1);
  });

  it("is limited to two per run", () => {
    const r = rescue();
    for (let i = 0; i < 3; i++) {
      r.markStuck();
      r.modelForRepair();
    }
    expect(r.used).toHaveLength(2);
  });

  it("isn't used on a proven fix or without the budget", () => {
    const proven = rescue({ isProven: () => true });
    proven.markStuck();
    expect(proven.modelForRepair()).toBeUndefined();
    const poor = rescue({ hasRoom: () => false });
    poor.markStuck();
    expect(poor.modelForRepair()).toBeUndefined();
  });
});
