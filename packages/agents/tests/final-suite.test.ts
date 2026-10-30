/**
 * The final whole-suite run decides the verdict. Found on Textualize/rich#4244: the targeted runs
 * were green, but the new test file made tests.test_panel::test_render_size fail in the whole
 * suite, and the run still reported "clean" or the generic "stopped improving" message.
 */

import { describe, it, expect } from "vitest";
import { runMaintainer, verdict } from "../src/maintainer/orchestrator.js";
import { DEMO_SNAPSHOT, createSimulatedMaintainerClient, createSimulatedSandbox } from "../src/maintainer/simulated.js";
import { prChecks } from "../src/maintainer/checks.js";
import { proofFrom } from "../src/maintainer/proof.js";
import { newFailing, type SandboxClient, type Validation } from "../src/maintainer/sandbox.js";
import type { MaintainerEvent } from "../src/maintainer/events.js";

const fast = { min: 0, max: 0 };
const NEW_FAILURE = "tests.test_panel::test_render_size";

/** The simulated sandbox, with the whole-suite runs changed; targeted runs stay as they are. */
function withFullSuite(change: (v: Validation) => Validation): SandboxClient {
  const sandbox = createSimulatedSandbox(fast);
  return {
    validate: async (req) => {
      const v = await sandbox.validate(req);
      return req.scope === "full" ? change(v) : v;
    },
  };
}

async function runWith(sandbox: SandboxClient) {
  const events: MaintainerEvent[] = [];
  const result = await runMaintainer(
    { kind: "snapshot", snapshot: DEMO_SNAPSHOT },
    { client: createSimulatedMaintainerClient(fast), sandbox, onEvent: (e) => events.push(e), provider: "simulated" }
  );
  return { events, result };
}

const addNewFailure = (v: Validation): Validation => ({
  ...v,
  tests: { ...v.tests, total: v.tests.total + 1, failed: v.tests.failed + 1, failures: [{ test: NEW_FAILURE, message: "AssertionError" }] },
});

describe("a new failure in the final whole-suite run", () => {
  it("keeps every agent's sign-off from reading as clean", () => {
    const v = verdict({ approved: ["code", "security", "doc", "write"], objectivelyPassing: false, budgetHit: false });
    expect(v.status).toBe("not_clean");
    expect(v.message).not.toMatch(/Every check passes/);
  });

  it("is named in the message instead of blaming the agents", () => {
    const v = verdict({ approved: ["code", "security", "doc"], objectivelyPassing: false, budgetHit: false, newFailures: [NEW_FAILURE] });
    expect(v.message).toContain(NEW_FAILURE);
    expect(v.message).not.toMatch(/stopped improving/);
  });

  it("shortens a long list of names", () => {
    const v = verdict({ approved: [], objectivelyPassing: false, budgetHit: false, newFailures: ["a", "b", "c", "d", "e"] });
    expect(v.message).toContain("a, b, c and 2 more");
  });

  it("ends the run not clean, on the code lane, even when all the targeted runs passed", async () => {
    const { result, events } = await runWith(withFullSuite(addNewFailure));

    expect(result.status).toBe("not_clean");
    expect(result.message).toContain(NEW_FAILURE);
    expect(result.lanes.code.clean).toBe(false);
    expect(result.lanes.code.remaining.join(" ")).toContain(NEW_FAILURE);
    expect(events.at(-1)).toMatchObject({ type: "complete", status: "not_clean" });
  });
});

describe("the Proof card's count of new failures", () => {
  it("doesn't count skipped tests or pre-existing failures", () => {
    const v: Validation = {
      install: { ok: true, logTail: "" },
      compile: { ok: true, errors: [] },
      lint: { issues: [] },
      tests: { ran: true, total: 983, passed: 949, failed: 9, errors: 0, skipped: 25, failures: [{ test: NEW_FAILURE, message: "x" }], preexistingCount: 8, outputTail: "", scope: "full" },
      failToPass: { newTests: ["t.py"], failedOnBase: true, passedAfter: true },
      durationMs: 1,
    };
    expect(newFailing(v)).toBe(1);
    expect(proofFrom(v)?.newFailing).toBe(1);
  });
});

describe("pr_honest_claims", () => {
  const validation = (tests: Partial<Validation["tests"]>): Validation => ({
    install: { ok: true, logTail: "" },
    compile: { ok: true, errors: [] },
    lint: { issues: [] },
    tests: { ran: true, total: 26, passed: 26, failed: 0, errors: 0, skipped: 0, failures: [], outputTail: "", ...tests },
    failToPass: null,
    durationMs: 1,
  });
  const honesty = (claim: string, v: Validation) => {
    const pr = `# Drop punctuation in slugify\n\n## Summary\nRefs #7\n\n## Changes\nx\n\n## Testing\n${claim}`;
    return prChecks(pr, { code: {}, docs: {}, pr: "" }, DEMO_SNAPSHOT, v).find((c) => c.testType === "pr_honest_claims")!;
  };
  const withPreexisting = validation({ total: 983, passed: 949, failed: 8, skipped: 26, preexistingCount: 8 });

  it("accepts an exact count, even when old failures remain", () => {
    expect(honesty("26/26 tests pass.", validation({})).passed).toBe(true);
    expect(honesty("949/983 tests pass.", withPreexisting).passed).toBe(true);
    expect(honesty("949 tests pass.", withPreexisting).passed).toBe(true);
  });

  it("checks both numbers of N/M", () => {
    expect(honesty("26/26 tests pass.", withPreexisting).passed).toBe(false);
    expect(honesty("949/949 tests pass.", withPreexisting).passed).toBe(false);
  });

  it("still rejects a blanket claim while any test fails, even a pre-existing one", () => {
    expect(honesty("All tests pass.", withPreexisting).passed).toBe(false);
    expect(honesty("All 949 tests pass.", withPreexisting).passed).toBe(false);
    expect(honesty("The tests pass.", withPreexisting).passed).toBe(false);
  });

  it("judges the PR against the run it describes in the before/after comparison", async () => {
    // The PR quotes the targeted count; the whole suite is larger, and that isn't a false claim.
    const more = (v: Validation): Validation => ({ ...v, tests: { ...v.tests, total: v.tests.total + 100, passed: v.tests.passed + 100 } });
    const { events } = await runWith(withFullSuite(more));
    const comparison = events.find((e) => e.type === "comparison");
    if (comparison?.type !== "comparison") throw new Error("no comparison");
    expect(comparison.after.checks.write.passed).toBe(comparison.after.checks.write.total);
  });
});
