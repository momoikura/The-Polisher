import { describe, it, expect } from "vitest";
import { chooseCandidate, type CandidateScore } from "../src/maintainer/candidates.js";

const cand = (overrides: Partial<CandidateScore>): CandidateScore => ({
  index: 0,
  provesFix: false,
  objectiveFailing: 3,
  linesAdded: 20,
  ...overrides,
});

describe("chooseCandidate", () => {
  it("prefers a candidate whose new tests prove the fix", () => {
    const pick = chooseCandidate([
      cand({ index: 0, provesFix: false, objectiveFailing: 0 }),
      cand({ index: 1, provesFix: true, objectiveFailing: 1 }),
    ]);
    expect(pick).toBe(1);
  });

  it("then the one with the fewest failing objective checks", () => {
    const pick = chooseCandidate([
      cand({ index: 0, provesFix: true, objectiveFailing: 2 }),
      cand({ index: 1, provesFix: true, objectiveFailing: 0 }),
    ]);
    expect(pick).toBe(1);
  });

  it("then the smallest change, since maintainers merge small diffs", () => {
    const pick = chooseCandidate([
      cand({ index: 0, provesFix: true, objectiveFailing: 0, linesAdded: 120 }),
      cand({ index: 1, provesFix: true, objectiveFailing: 0, linesAdded: 40 }),
      cand({ index: 2, provesFix: true, objectiveFailing: 0, linesAdded: 90 }),
    ]);
    expect(pick).toBe(1);
  });

  it("keeps the earliest candidate on a full tie", () => {
    expect(chooseCandidate([cand({ index: 0 }), cand({ index: 1 })])).toBe(0);
  });
});
