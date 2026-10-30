import { describe, expect, it } from "vitest";
import { proofFrom } from "../src/maintainer/proof.js";
import type { Validation } from "../src/maintainer/sandbox.js";

const validation = (overrides: Partial<Validation> = {}): Validation => ({
  install: { ok: true, logTail: "" },
  compile: { ok: true, errors: [] },
  lint: { issues: [] },
  tests: { ran: true, total: 770, passed: 768, failed: 2, errors: 0, skipped: 0, failures: [], preexisting: ["a", "b"], preexistingCount: 2, outputTail: "", scope: "full" },
  failToPass: {
    newTests: ["tests/test_replace_empty.py"],
    failedOnBase: true,
    passedAfter: true,
    baseFailures: { reproduced: 2, missingCode: 0, example: "AssertionError: assert [None] == []" },
  },
  durationMs: 1,
  ...overrides,
});

describe("proofFrom", () => {
  it("shows the new tests failing on the original code, passing with the fix, and the rest of the suite", () => {
    expect(proofFrom(validation())).toEqual({
      proven: true,
      newTests: ["tests/test_replace_empty.py"],
      failedOnBase: true,
      passedAfter: true,
      baseFailure: "AssertionError: assert [None] == []",
      reproduced: 2,
      missingCode: 0,
      testsPassed: 768,
      testsTotal: 770,
      preexisting: 2,
      fullSuite: true,
    });
  });

  it("is not proven when the new tests only fail because the fix's code is missing", () => {
    const v = validation({ failToPass: { newTests: ["t.py"], failedOnBase: true, passedAfter: true, baseFailures: { reproduced: 0, missingCode: 1, example: "ImportError: cannot import name 'fix'" } } });

    expect(proofFrom(v)?.proven).toBe(false);
  });

  it("is null when there was no sandbox result or no new test", () => {
    expect(proofFrom(null)).toBeNull();
    expect(proofFrom(validation({ failToPass: null }))).toBeNull();
  });
});
