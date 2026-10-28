import { describe, it, expect } from "vitest";
import { findSlopPhrases } from "../src/slop/shared.js";

describe("findSlopPhrases", () => {
  it("matches stock phrases case-insensitively, including curly apostrophes", () => {
    expect(findSlopPhrases("In today’s fast-paced world we Unleash value")).toEqual(
      expect.arrayContaining(["in today's fast-paced", "unleash"])
    );
  });

  it("does not match inside other words", () => {
    expect(findSlopPhrases("The journeyman fixed the boastful sign")).toEqual([]);
  });
});
