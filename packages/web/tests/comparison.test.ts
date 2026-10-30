import { describe, expect, it } from "vitest";
import type { SideMetrics } from "@thepolisher/agents";
import { rows } from "../src/components/Comparison.js";

const side = (testsPassed: number, testsTotal: number): SideMetrics => ({
  testsPassed,
  testsTotal,
  provesFix: true,
  lintIssues: 0,
  checks: { code: { passed: 1, total: 1 }, security: { passed: 1, total: 1 }, doc: { passed: 1, total: 1 }, write: { passed: 1, total: 1 } },
  scores: { code: 90, security: 90, doc: 90, write: 90 },
  files: 1,
  linesAdded: 1,
});
const testsRow = (before: SideMetrics, after: SideMetrics) => rows(before, after).find((r) => r.label === "Tests")!;

describe("the Tests row", () => {
  it("is not worse when the result has one fewer new test and no more not passing", () => {
    expect(testsRow(side(951, 984), side(950, 983)).better).toBeNull();
  });

  it("is better with fewer tests not passing, and worse with more", () => {
    expect(testsRow(side(950, 984), side(950, 983)).better).toBe(true);
    expect(testsRow(side(950, 983), side(950, 984)).better).toBe(false);
  });
});
