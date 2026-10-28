/**
 * Auto-Maintainer: checks, GitHub client (fake HTTP), and full runs on the
 * scripted demo repo. Model text and sandbox results are scripted; the
 * orchestrator, gate, checks and memory are real.
 */

import { describe, it, expect } from "vitest";
import { runMaintainer } from "../src/maintainer/orchestrator.js";
import { DEMO_SNAPSHOT, createSimulatedMaintainerClient, createSimulatedSandbox } from "../src/maintainer/simulated.js";
import { GitHubClient, parseIssueUrl } from "../src/maintainer/github.js";
import { codeStaticChecks, docChecks, prChecks, uxChecks } from "../src/maintainer/checks.js";
import { validationChecks, type Validation } from "../src/maintainer/sandbox.js";
import { diffFile, splitPr } from "../src/maintainer/bundle.js";
import { MemoryExperienceStore } from "../src/memory/experience.js";
import type { MaintainerEvent } from "../src/maintainer/events.js";

const fast = { min: 0, max: 0 };
const failing = (checks: ReturnType<typeof codeStaticChecks>) => checks.filter((c) => !c.passed).map((c) => c.testType);
const SRC = "tinyslug/__init__.py";
const TESTS = "tests/test_slugify.py";
const base = DEMO_SNAPSHOT.files;

async function demoRun(overrides: { sandbox?: boolean; store?: MemoryExperienceStore } = {}) {
  const events: MaintainerEvent[] = [];
  const result = await runMaintainer(
    { kind: "snapshot", snapshot: DEMO_SNAPSHOT },
    {
      client: createSimulatedMaintainerClient(fast),
      sandbox: overrides.sandbox === false ? undefined : createSimulatedSandbox(fast),
      onEvent: (e) => events.push(e),
      experience: overrides.store,
      provider: "simulated",
    }
  );
  return { events, result };
}

describe("parseIssueUrl", () => {
  it("accepts GitHub issue links", () => {
    expect(parseIssueUrl("https://github.com/psf/requests/issues/6000#issuecomment-1")).toEqual({ owner: "psf", repo: "requests", number: 6000 });
  });

  it("rejects anything else", () => {
    for (const bad of ["http://github.com/a/b/issues/1", "https://github.com/a/b/pull/1", "https://evil.com/a/b/issues/1", "https://github.com/a/../issues/1"]) {
      expect(() => parseIssueUrl(bad)).toThrow(/GitHub issue link/);
    }
  });
});

describe("code checks", () => {
  it("catch deleted tests even when the test count stays the same", () => {
    const tests = base[TESTS].replace("def test_custom_separator", "def test_something_else");
    expect(failing(codeStaticChecks({ [TESTS]: tests }, DEMO_SNAPSHOT))).toContain("tests_intact");
  });

  it("catch debug prints in library code but not in tests", () => {
    const src = base[SRC].replace("    text = text", '    print(text)\n    text = text');
    const tests = `${base[TESTS]}\n\ndef test_x():\n    print("ok")\n    assert True\n`;
    const checks = codeStaticChecks({ [SRC]: src, [TESTS]: tests }, DEMO_SNAPSHOT);
    expect(checks.find((c) => c.testType === "debug_leftovers")!.message).toMatch(/__init__\.py/);
    expect(checks.find((c) => c.testType === "debug_leftovers")!.message).not.toMatch(/test_slugify/);
  });

  it("refuse config, workflow and non-Python files", () => {
    const checks = codeStaticChecks({ "pyproject.toml": "x", ".github/workflows/ci.yml": "x", "notes.md": "x" }, DEMO_SNAPSHOT);
    expect(checks.find((c) => c.testType === "patch_scope")!.problemCount).toBe(3);
  });

  it("require at least one new test", () => {
    expect(failing(codeStaticChecks({ [SRC]: base[SRC].replace("lower()", "casefold()") }, DEMO_SNAPSHOT))).toContain("tests_included");
  });
});

describe("UX checks (UIPolish)", () => {
  it("flag message-less and generic exceptions and swallowed errors in new code only", () => {
    const src = `${base[SRC]}\n\ndef a():\n    raise ValueError()\n\n\ndef b():\n    raise TypeError("Invalid input")\n\n\ndef c():\n    try:\n        pass\n    except Exception:\n        pass\n`;
    const check = uxChecks({ [SRC]: src }, DEMO_SNAPSHOT)[0];
    expect(check.problemCount).toBe(3);
  });
});

describe("doc checks", () => {
  it("flag functions and files that don't exist, and hype", () => {
    const readme = `${base["README.md"]}\nUse \`normalize()\` from tinyslug/core.py. Blazing-fast.\n`;
    const checks = docChecks({ "README.md": readme }, { code: {}, docs: {}, pr: "x" }, DEMO_SNAPSHOT);
    const accuracy = checks.find((c) => c.testType === "docs_accuracy")!;
    expect(accuracy.message).toMatch(/normalize/);
    expect(accuracy.message).toMatch(/core\.py/);
    expect(failing(checks)).toContain("slop_phrases");
  });
});

describe("PR checks (WritePolish)", () => {
  const v = (passed: number, failed = 0): Validation => ({
    install: { ok: true, logTail: "" },
    compile: { ok: true, errors: [] },
    lint: { issues: [] },
    tests: { ran: true, total: passed + failed, passed, failed, errors: 0, skipped: 0, failures: [], outputTail: "" },
    failToPass: null,
    durationMs: 1,
  });
  const bundle = { code: { [SRC]: base[SRC] + "\n# changed\n" }, docs: {}, pr: "" };

  it("catch claims the sandbox does not support", () => {
    const pr = `# Drop punctuation in slugify\n\n## Summary\nFixes #7\n\n## Changes\n- ${SRC}\n\n## Testing\nAll tests pass. 9 tests pass.`;
    const honest = prChecks(pr, bundle, DEMO_SNAPSHOT, v(3, 1)).find((c) => c.testType === "pr_honest_claims")!;
    expect(honest.passed).toBe(false);
    expect(honest.problemCount).toBe(2);
  });

  it("require the issue link and every changed file", () => {
    const pr = "# Drop punctuation in slugify\n\n## Summary\nx\n## Changes\nx\n## Testing\nx";
    expect(failing(prChecks(pr, bundle, DEMO_SNAPSHOT, v(3)))).toEqual(expect.arrayContaining(["pr_links_issue", "pr_files_listed"]));
  });

  it("splits title and body", () => {
    expect(splitPr("# Title here\n\nBody")).toEqual({ title: "Title here", body: "Body" });
  });
});

describe("sandbox checks", () => {
  it("require new tests that fail before the fix", () => {
    const checks = validationChecks({
      install: { ok: true, logTail: "" },
      compile: { ok: true, errors: [] },
      lint: { issues: [] },
      tests: { ran: true, total: 3, passed: 3, failed: 0, errors: 0, skipped: 0, failures: [], outputTail: "" },
      failToPass: { newTests: [TESTS], failedOnBase: false, passedAfter: true },
      durationMs: 1,
    });
    expect(checks.find((c) => c.testType === "fail_to_pass")!.message).toMatch(/already pass on the original code/);
  });
});

describe("diffFile", () => {
  it("keeps three lines of context and marks gaps", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 2", "LINE 2").replace("line 17", "LINE 17");
    const d = diffFile("a.py", before, after);
    expect(d.added).toBe(2);
    expect(d.lines.some((l) => l.type === "gap")).toBe(true);
  });
});

describe("runMaintainer on the demo repo", () => {
  it("turns a sloppy baseline into a clean, test-proven PR", async () => {
    const { events, result } = await demoRun();

    expect(result.status).toBe("clean");
    expect(result.final!.code[SRC]).toContain("non-empty string");
    expect(result.final!.docs["CHANGELOG.md"]).toContain("## Unreleased");
    expect(result.final!.pr).toContain("Fixes #7");

    const comparison = events.find((e) => e.type === "comparison");
    expect(comparison?.type === "comparison" && comparison.before.provesFix).toBe(false);
    expect(comparison?.type === "comparison" && comparison.after.provesFix).toBe(true);
    expect(comparison?.type === "comparison" && comparison.after.testsPassed).toBe(5);
    expect(events[events.length - 1]).toMatchObject({ type: "complete", status: "clean", canOpenPr: true });
  });

  it("keeps the single-prompt baseline for the before/after view", async () => {
    const { events, result } = await demoRun();
    const baseline = events.find((e) => e.type === "baseline");
    expect(baseline?.type === "baseline" && baseline.pr).toContain("Fixed stuff");
    expect(result.baseline!.pr).toContain("Fixed stuff");
  });

  it("rejects the repair that deletes an existing test", async () => {
    const { events } = await demoRun();
    const code = events.flatMap((e) => (e.type === "lane_decision" && e.lane === "code" ? [e] : []));
    expect(code[1]).toMatchObject({ accepted: false, reason: "regression_detected" });
  });

  it("has UIPolish review CodePolish's work and gate it", async () => {
    const { events, result } = await demoRun();
    expect(events.some((e) => e.type === "review" && e.from === "ui" && e.to === "code" && e.findings.some((f) => /no message/.test(f)))).toBe(true);
    expect(result.lanes.ui.clean).toBe(true);
  });

  it("cannot be clean without a sandbox, because tests never ran", async () => {
    const { result } = await demoRun({ sandbox: false });
    expect(result.status).toBe("not_clean");
    expect(result.lanes.code.clean).toBe(false);
  });

  it("remembers what worked and repairs faster next time", async () => {
    const store = new MemoryExperienceStore();
    const first = await demoRun({ store });
    const second = await demoRun({ store });
    const repairs = (ev: MaintainerEvent[]) => ev.filter((e) => e.type === "lane_changes").length;
    expect(second.events.some((e) => e.type === "lessons")).toBe(true);
    expect(repairs(second.events)).toBeLessThan(repairs(first.events));
    expect(second.result.status).toBe("clean");
  });
});

describe("GitHubClient.createPullRequest", () => {
  it("creates blobs, a tree, a commit, a branch and the PR, in that order", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      const path = url.replace("https://api.github.com", "");
      calls.push(`${init.method ?? "GET"} ${path}`);
      const bodies: Record<string, unknown> = {
        "/repos/o/r/git/blobs": { sha: "blob1" },
        "/repos/o/r/git/trees": { sha: "tree1" },
        "/repos/o/r/git/commits": { sha: "commit1" },
        "/repos/o/r/git/refs": { ref: "refs/heads/polishloop/issue-7" },
        "/repos/o/r/pulls": { html_url: "https://github.com/o/r/pull/9", number: 9 },
      };
      return new Response(JSON.stringify(bodies[path]), { status: 201 });
    }) as unknown as typeof fetch;

    const gh = new GitHubClient({ token: "t", fetchFn });
    const pr = await gh.createPullRequest({
      owner: "o",
      repo: "r",
      baseBranch: "main",
      baseSha: "abc",
      branch: "polishloop/issue-7",
      files: { "a.py": "print(1)\n" },
      title: "Fix",
      body: "Fixes #7",
    });

    expect(pr).toEqual({ url: "https://github.com/o/r/pull/9", number: 9 });
    expect(calls).toEqual([
      "POST /repos/o/r/git/blobs",
      "POST /repos/o/r/git/trees",
      "POST /repos/o/r/git/commits",
      "POST /repos/o/r/git/refs",
      "POST /repos/o/r/pulls",
    ]);
  });

  it("refuses without a token and rejects unsafe branch names", async () => {
    const input = { owner: "o", repo: "r", baseBranch: "main", baseSha: "a", branch: "x", files: {}, title: "t", body: "b" };
    await expect(new GitHubClient().createPullRequest(input)).rejects.toThrow(/GITHUB_TOKEN/);
    await expect(new GitHubClient({ token: "t" }).createPullRequest({ ...input, branch: "../evil" })).rejects.toThrow(/branch/);
  });
});
