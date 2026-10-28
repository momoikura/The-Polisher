import { describe, it, expect } from "vitest";
import { DEFAULT_RUN_CONFIG, type RunConfig } from "../../core/src/types/run.js";
import { findRepetition, runWritingChecks } from "../src/verification/writing-checks.js";

const config = (overrides: Partial<RunConfig> = {}): RunConfig => ({ ...DEFAULT_RUN_CONFIG, ...overrides });
const byType = (checks: ReturnType<typeof runWritingChecks>, type: string) =>
  checks.find((c) => c.testType === type);

describe("runWritingChecks", () => {
  it("omits requirement checks that were not configured instead of passing them", () => {
    const checks = runWritingChecks("A short clean sentence.", config());
    expect(byType(checks, "required_content")).toBeUndefined();
    expect(byType(checks, "length_limits")).toBeUndefined();
  });

  it("fails when a required phrase is missing (case-insensitive match otherwise)", () => {
    const checks = runWritingChecks("Our API uses OAuth 2.0.", config({ requiredPhrases: ["oauth 2.0", "rate limits"] }));
    const check = byType(checks, "required_content")!;
    expect(check.passed).toBe(false);
    expect(check.message).toContain("rate limits");
  });

  it("enforces word-count bounds", () => {
    const text = "one two three four five";
    expect(byType(runWritingChecks(text, config({ maxWords: 4 })), "length_limits")!.passed).toBe(false);
    expect(byType(runWritingChecks(text, config({ minWords: 3, maxWords: 10 })), "length_limits")!.passed).toBe(true);
  });

  it("flags placeholder and boilerplate text", () => {
    const check = byType(runWritingChecks("Pricing: [insert price here]. TODO", config()), "placeholder_text")!;
    expect(check.passed).toBe(false);
  });

  it("passes clean, non-repetitive text", () => {
    const checks = runWritingChecks("The cache cut p95 latency from 400ms to 90ms. Reads now hit memory first.", config());
    expect(checks.every((c) => c.passed)).toBe(true);
    expect(checks.every((c) => c.authority === "objective")).toBe(true);
  });
});

describe("findRepetition", () => {
  it("detects duplicated sentences", () => {
    const problems = findRepetition("Our product is fast and easy to use. Teams love it. Our product is fast and easy to use.");
    expect(problems.some((p) => p.startsWith("Sentence repeated"))).toBe(true);
  });

  it("detects a long phrase repeated three or more times", () => {
    const phrase = "in today's fast paced digital world";
    const problems = findRepetition(`${phrase} we ship. ${phrase} we test. ${phrase} we learn.`);
    expect(problems.some((p) => p.startsWith("Phrase repeated"))).toBe(true);
  });
});
