import { describe, it, expect } from "vitest";
import type { RepairAttempt } from "@polishloop/core";
import { adaptStrategy } from "../src/maintainer/adapt.js";

const attempt = (overrides: Partial<RepairAttempt> = {}): RepairAttempt => ({
  round: 2,
  accepted: false,
  reason: "regression_detected",
  explanation: "Broke 2 passing checks.",
  regressions: ["py_compile", "py_tests"],
  changesMade: ["Added a CHANGELOG line"],
  ...overrides,
});

describe("adaptStrategy", () => {
  it("leaves the first revision alone", () => {
    expect(adaptStrategy([], ["py_tests"])).toEqual({ mode: "normal", brief: "", label: null });
  });

  it("carries on normally after a kept revision", () => {
    expect(adaptStrategy([attempt({ accepted: true, reason: "improvement", regressions: [] })], ["py_tests"]).mode).toBe("normal");
  });

  it("explains a rejected revision so the next one doesn't repeat it", () => {
    const s = adaptStrategy([attempt()], ["py_tests"]);
    expect(s.mode).toBe("rethink");
    expect(s.brief).toMatch(/rejected/i);
    expect(s.brief).toContain("Added a CHANGELOG line");
    expect(s.brief).toContain("py_compile");
    expect(s.brief).toMatch(/different approach/i);
    expect(s.label).toMatch(/rejected/);
  });

  it("narrows to the smallest fix for the top failing check after repeated rejections", () => {
    const s = adaptStrategy([attempt({ round: 2 }), attempt({ round: 3, changesMade: ["Rewrote the parser"] })], ["fail_to_pass", "debug_leftovers"]);
    expect(s.mode).toBe("minimal");
    expect(s.brief).toContain("Added a CHANGELOG line");
    expect(s.brief).toContain("Rewrote the parser");
    expect(s.brief).toMatch(/smallest/i);
    expect(s.brief).toContain("fail_to_pass");
    expect(s.label).toContain("fail to pass");
  });

  it("names a check that every rejected attempt broke", () => {
    const s = adaptStrategy([attempt({ regressions: ["py_tests"] }), attempt({ regressions: ["py_tests", "py_lint"] })], ["tests_included"]);
    expect(s.brief).toMatch(/every rejected attempt broke py_tests/i);
  });

  it("warns when a rejected revision was spent on files that were thrown away", () => {
    const s = adaptStrategy(
      [attempt({ reason: "no_improvement", regressions: [], changesMade: ["Discarded CHANGELOG.md: CodePolish may only change Python files"] })],
      []
    );
    expect(s.brief).toMatch(/thrown away/i);
    expect(s.brief).toMatch(/findings/i);
  });

  it("only looks at the rejections since the last kept revision", () => {
    const history = [attempt({ changesMade: ["Old idea"] }), attempt({ accepted: true, reason: "improvement", regressions: [] }), attempt()];
    const s = adaptStrategy(history, ["py_tests"]);
    expect(s.mode).toBe("rethink");
    expect(s.brief).not.toContain("Old idea");
  });
});
