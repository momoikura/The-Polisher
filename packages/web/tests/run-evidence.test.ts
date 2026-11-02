import { describe, expect, it } from "vitest";
import type { Challenge, Proof } from "@thepolisher/agents";
import { withProofSection } from "../src/server/pr-proof.js";
import { buildReceipt, patchHash } from "../src/maintainer/receipt.js";
import { pageFromPath, pathForRun, runIdFromPath } from "../src/maintainer/routes.js";
import { publicRun } from "../src/server/history.js";

const proof: Proof = {
  proven: true,
  newTests: ["tests/test_a.py"],
  failedOnBase: true,
  passedAfter: true,
  baseFailure: "AssertionError: assert 12 == 10\nmore detail",
  reproduced: 1,
  missingCode: 0,
  testsPassed: 950,
  testsTotal: 983,
  preexisting: 8,
  newFailing: 0,
  fullSuite: true,
};
const challenge: Challenge = { model: "muse-wonder-1.0", total: 3, passed: 3, failures: [], tests: "", ideas: [] };
const URL = "https://thepolisher.pages.dev/runs/abc";

describe("the proof in the pull request", () => {
  it("adds the evidence for the maintainer reading the PR", () => {
    const pr = withProofSection("# Title\n\nBody", proof, challenge, URL);

    expect(pr.startsWith("# Title\n\nBody")).toBe(true);
    expect(pr).toContain("`tests/test_a.py`");
    expect(pr).toContain("assert 12 == 10");
    expect(pr).not.toContain("more detail");
    expect(pr).toContain("950 of 983");
    expect(pr).toContain("8 already failed on the original code");
    expect(pr).toContain("3 of 3");
    expect(pr).toContain(URL);
  });

  it("names a challenge test the fix didn't survive", () => {
    const failed = { ...challenge, passed: 2, failures: [{ test: "t::test_x", message: "boom" }] };

    expect(withProofSection("# T", proof, failed, URL)).toContain("2 of 3");
    expect(withProofSection("# T", proof, failed, URL)).toContain("t::test_x");
  });

  it("claims nothing when the fix isn't proven", () => {
    expect(withProofSection("# T", { ...proof, proven: false }, null, URL)).toBe("# T");
    expect(withProofSection("# T", null, null, URL)).toBe("# T");
  });

  it("works without a challenge or a public address", () => {
    const pr = withProofSection("# T", proof, null, null);

    expect(pr).toContain("950 of 983");
    expect(pr).not.toContain("Muse Wonder");
    expect(pr).not.toContain("Full run");
  });
});

describe("the receipt", () => {
  const diffs = [{ path: "a.py", added: 1, removed: 0, lines: [{ type: "added", text: "x = 1" }] }] as never;

  it("hashes the patch the same way every time, so anyone can check it", async () => {
    expect(await patchHash(diffs)).toBe(await patchHash(diffs));
    expect(await patchHash(diffs)).toMatch(/^[0-9a-f]{64}$/);
    expect(await patchHash([] as never)).not.toBe(await patchHash(diffs));
  });

  it("records what was proven, on which commit", async () => {
    const receipt = await buildReceipt({ repo: "o/r", sha: "abc", issueUrl: "u", proof, challenge, diffs });

    expect(receipt).toMatchObject({ repo: "o/r", commit: "abc", issue: "u", proven: true, tests: { passed: 950, total: 983, alreadyFailing: 8, newFailing: 0 }, challenge: { passed: 3, total: 3 } });
    expect(receipt.patchSha256).toBe(await patchHash(diffs));
  });
});

describe("a run saved as running", () => {
  const STARTED = "2026-11-02T06:00:00.000Z";
  const record = { id: "1", issueUrl: "u", repo: "o/r", issueNumber: 1, title: "", status: "running", totalUSD: 0, model: "m", startedAt: STARTED, finishedAt: null, user: "someone" } as const;
  const after = (minutes: number) => Date.parse(STARTED) + minutes * 60_000;

  it("still shows running while it can be", () => {
    expect(publicRun(record, after(20)).status).toBe("running");
  });

  it("stops showing running once no run could still be going", () => {
    expect(publicRun(record, after(41)).status).toBe("failed");
  });

  it("never shows who started it", () => {
    expect(publicRun(record, after(1))).not.toHaveProperty("user");
  });
});

describe("a run's own address", () => {
  const ID = "e53f63a5-4ee2-4823-aff1-2323ff801c76";

  it("opens that run on the Runs page", () => {
    expect(pageFromPath(`/runs/${ID}`)).toBe("runs");
    expect(runIdFromPath(`/runs/${ID}`)).toBe(ID);
    expect(runIdFromPath(pathForRun(ID))).toBe(ID);
  });

  it("finds no run in other addresses", () => {
    expect(runIdFromPath("/runs")).toBeNull();
    expect(runIdFromPath("/runs/not-a-run")).toBeNull();
    expect(runIdFromPath("/")).toBeNull();
    expect(pageFromPath("/runs/not-a-run")).toBe("maintainer");
  });
});
