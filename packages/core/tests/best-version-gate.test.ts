/**
 * Tests for the Best-Version Gate — the most critical component in the system.
 *
 * These tests verify that:
 * 1. First versions are always accepted (as baseline)
 * 2. Regressions are always rejected
 * 3. Improvements are accepted
 * 4. Objective ties need an independent score gain >= epsilon
 * 5. More failures are rejected
 * 6. Scores can never override a regression
 */

import { describe, it, expect } from "vitest";
import {
  evaluateCandidate,
  meetsAcceptanceCriteria,
} from "../src/controller/best-version-gate.js";
import { aggregateTestResults } from "../src/types/test.js";
import type { TestCheck, AggregatedTestResults } from "../src/types/test.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeResults(
  checks: TestCheck[],
  id = "test-version"
): AggregatedTestResults {
  return aggregateTestResults(id, checks);
}

function passingCheck(testType: string): TestCheck {
  return {
    testType: testType as any,
    authority: "objective",
    passed: true,
    message: `${testType} passed`,
  };
}

function failingCheck(testType: string): TestCheck {
  return {
    testType: testType as any,
    authority: "objective",
    passed: false,
    message: `${testType} failed`,
  };
}

function hybridCheck(testType: string, passed: boolean): TestCheck {
  return {
    testType: testType as any,
    authority: "hybrid",
    passed,
    message: `${testType} ${passed ? "passed" : "failed"}`,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Best-Version Gate", () => {
  describe("First version (no current best)", () => {
    it("accepts first version when all objectives pass", () => {
      const candidate = makeResults([
        passingCheck("linting"),
        passingCheck("user_tests"),
      ]);

      const decision = evaluateCandidate(candidate, null);

      expect(decision.accepted).toBe(true);
      expect(decision.reason).toBe("first_version_accepted");
      expect(decision.regressions).toEqual([]);
    });

    it("accepts first version even with failures (baseline)", () => {
      const candidate = makeResults([
        passingCheck("linting"),
        failingCheck("user_tests"),
      ]);

      const decision = evaluateCandidate(candidate, null);

      expect(decision.accepted).toBe(true);
      expect(decision.reason).toBe("first_version_accepted");
    });
  });

  describe("Regression detection", () => {
    it("rejects candidate when a previously-passing test now fails", () => {
      const best = makeResults([
        passingCheck("linting"),
        passingCheck("user_tests"),
        failingCheck("type_checking"),
      ]);

      const candidate = makeResults([
        passingCheck("linting"),
        failingCheck("user_tests"), // REGRESSION
        passingCheck("type_checking"), // improvement, but doesn't matter
      ]);

      const decision = evaluateCandidate(candidate, best);

      expect(decision.accepted).toBe(false);
      expect(decision.reason).toBe("regression_detected");
      expect(decision.regressions).toContain("user_tests");
    });

    it("rejects candidate with multiple regressions", () => {
      const best = makeResults([
        passingCheck("linting"),
        passingCheck("user_tests"),
        passingCheck("type_checking"),
      ]);

      const candidate = makeResults([
        failingCheck("linting"),
        failingCheck("user_tests"),
        passingCheck("type_checking"),
      ]);

      const decision = evaluateCandidate(candidate, best);

      expect(decision.accepted).toBe(false);
      expect(decision.reason).toBe("regression_detected");
      expect(decision.regressions).toHaveLength(2);
      expect(decision.regressions).toContain("linting");
      expect(decision.regressions).toContain("user_tests");
    });
  });

  describe("Improvement detection", () => {
    it("accepts candidate with fewer objective failures", () => {
      const best = makeResults([
        passingCheck("linting"),
        failingCheck("user_tests"),
        failingCheck("type_checking"),
      ]);

      const candidate = makeResults([
        passingCheck("linting"),
        passingCheck("user_tests"),
        failingCheck("type_checking"),
      ]);

      const decision = evaluateCandidate(candidate, best);

      expect(decision.accepted).toBe(true);
      expect(decision.reason).toBe("improvement");
    });

    it("rejects an objective tie when no independent score is available", () => {
      const best = makeResults([passingCheck("linting"), failingCheck("user_tests")]);
      const candidate = makeResults([passingCheck("linting"), failingCheck("user_tests")]);

      const decision = evaluateCandidate(candidate, best);

      expect(decision.accepted).toBe(false);
      expect(decision.reason).toBe("no_improvement");
    });

    it("accepts an objective tie when the independent score improves by at least epsilon", () => {
      const best = makeResults([passingCheck("linting"), failingCheck("user_tests")]);
      const candidate = makeResults([passingCheck("linting"), failingCheck("user_tests")]);

      const decision = evaluateCandidate(candidate, best, { candidate: 7.5, best: 7.0, epsilon: 0.05 });

      expect(decision.accepted).toBe(true);
      expect(decision.reason).toBe("score_improvement");
    });

    it("rejects an objective tie when the score gain is below epsilon", () => {
      const best = makeResults([passingCheck("linting")]);
      const candidate = makeResults([passingCheck("linting")]);

      const decision = evaluateCandidate(candidate, best, { candidate: 7.02, best: 7.0, epsilon: 0.05 });

      expect(decision.accepted).toBe(false);
      expect(decision.reason).toBe("no_improvement");
    });

    it("rejects a tie in failing checks when problems inside them increased, even with a better score", () => {
      const best = makeResults([{ ...failingCheck("html_validation"), problemCount: 1 }]);
      const candidate = makeResults([{ ...failingCheck("html_validation"), problemCount: 3 }]);

      const decision = evaluateCandidate(candidate, best, { candidate: 9, best: 3, epsilon: 0.05 });

      expect(decision.accepted).toBe(false);
      expect(decision.reason).toBe("more_problems");
    });

    it("accepts a tie in failing checks when problems inside them decreased", () => {
      const best = makeResults([{ ...failingCheck("grammar"), problemCount: 4 }]);
      const candidate = makeResults([{ ...failingCheck("grammar"), problemCount: 1 }]);

      const decision = evaluateCandidate(candidate, best, { candidate: 5, best: 6, epsilon: 0.05 });

      expect(decision.accepted).toBe(true);
      expect(decision.reason).toBe("fewer_problems");
    });

    it("rejects a higher-scoring candidate that regresses an objective check", () => {
      const best = makeResults([passingCheck("linting"), passingCheck("user_tests")]);
      const candidate = makeResults([passingCheck("linting"), failingCheck("user_tests")]);

      const decision = evaluateCandidate(candidate, best, { candidate: 10, best: 3, epsilon: 0.05 });

      expect(decision.accepted).toBe(false);
      expect(decision.reason).toBe("regression_detected");
    });
  });

  describe("Rejection", () => {
    it("rejects candidate with more objective failures (no regression, just worse)", () => {
      const best = makeResults([
        passingCheck("linting"),
        passingCheck("user_tests"),
        failingCheck("type_checking"),
      ]);

      // Candidate has same tests passing but an extra failure
      // This is tricky: no regression (same tests pass), but more total failures
      // Actually, if the same tests pass, there can't be more failures unless
      // there are NEW tests. Let's make a proper scenario:
      const candidate = makeResults([
        passingCheck("linting"),
        passingCheck("user_tests"),
        failingCheck("type_checking"),
        failingCheck("generated_tests"), // new test, fails
      ]);

      const decision = evaluateCandidate(candidate, best);

      // More total failures (2 vs 1), but no regression on existing passing tests
      expect(decision.accepted).toBe(false);
      expect(decision.reason).toBe("more_failures");
    });
  });

  describe("Hybrid checks are tracked but don't affect gating", () => {
    it("hybrid check failures don't cause rejection", () => {
      const best = makeResults([
        passingCheck("linting"),
        hybridCheck("narrative_flow_check", true),
      ]);

      const candidate = makeResults([
        passingCheck("linting"),
        hybridCheck("narrative_flow_check", false), // hybrid regression — should not block
      ]);

      const decision = evaluateCandidate(candidate, best, { candidate: 8, best: 7, epsilon: 0.05 });

      expect(decision.accepted).toBe(true);
      expect(decision.regressions).toEqual([]);
    });
  });

  describe("meetsAcceptanceCriteria", () => {
    it("returns true when all objective checks pass", () => {
      const results = makeResults([
        passingCheck("linting"),
        passingCheck("user_tests"),
        hybridCheck("narrative_flow_check", false), // hybrid fail doesn't matter
      ]);

      expect(meetsAcceptanceCriteria(results)).toBe(true);
    });

    it("returns false when any objective check fails", () => {
      const results = makeResults([
        passingCheck("linting"),
        failingCheck("user_tests"),
      ]);

      expect(meetsAcceptanceCriteria(results)).toBe(false);
    });

    it("returns true for empty check list (vacuously true)", () => {
      const results = makeResults([]);
      expect(meetsAcceptanceCriteria(results)).toBe(true);
    });
  });
});
