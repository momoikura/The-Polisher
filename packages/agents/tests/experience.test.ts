import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FileExperienceStore,
  MemoryExperienceStore,
  buildExperience,
  formatLessons,
  recallLessons,
  type Experience,
} from "../src/memory/experience.js";
const DAY = 86_400_000;

function exp(overrides: Partial<Experience> = {}): Experience {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    lane: "security",
    model: "m",
    promptVersion: "v",
    provider: "meta",
    briefKeywords: [],
    targeted: ["slop_visual"],
    fixed: ["slop_visual"],
    broke: [],
    problemsBefore: 3,
    problemsAfter: 0,
    scoreBefore: 4,
    scoreAfter: 8,
    accepted: true,
    reason: "improvement",
    strategies: ["Swapped the purple gradient for a flat two-tone palette"],
    ...overrides,
  };
}

describe("buildExperience", () => {
  it("records which checks a repair fixed and which it broke", () => {
    const e = buildExperience({
      lane: "security",
      model: "m",
      promptVersion: "v",
      provider: "meta",
      brief: "coffee landing coffee",
      before: [
        { testType: "slop_visual", passed: false, problemCount: 3 },
        { testType: "html_basics", passed: true },
      ],
      after: [
        { testType: "slop_visual", passed: true },
        { testType: "html_basics", passed: false, problemCount: 2 },
      ],
      scoreBefore: 3,
      scoreAfter: 7,
      accepted: false,
      reason: "regression_detected",
      strategies: ["  Removed gradients  ", ""],
    });
    expect(e).toMatchObject({ targeted: ["slop_visual"], fixed: ["slop_visual"], broke: ["html_basics"], problemsBefore: 3, problemsAfter: 2 });
    expect(e.strategies).toEqual(["Removed gradients"]);
    expect(e.briefKeywords[0]).toBe("coffee");
  });
});

describe("recallLessons", () => {
  it("returns a kept strategy that fixed a check failing now", () => {
    const lessons = recallLessons([exp()], { lane: "security", failing: ["slop_visual"], provider: "meta" });
    expect(lessons.worked.map((l) => l.strategy)).toEqual([exp().strategies[0]]);
  });

  it("never labels a rejected repair as a success, even if it fixed the check", () => {
    const lessons = recallLessons([exp({ accepted: false }), exp({ accepted: false })], {
      lane: "security",
      failing: ["slop_visual"],
      provider: "meta",
    });
    expect(lessons.worked).toEqual([]);
    expect(lessons.avoid).toHaveLength(1);
  });

  it("puts strategies that broke a passing check on the avoid list", () => {
    const lessons = recallLessons([exp({ broke: ["focus_states"], strategies: ["Removed all outlines"] })], {
      lane: "security",
      failing: ["slop_visual"],
      provider: "meta",
    });
    expect(lessons.worked).toEqual([]);
    expect(lessons.avoid[0]).toMatchObject({ strategy: "Removed all outlines", checks: ["focus_states"] });
  });

  it("ignores other lanes, unrelated checks, and other providers' experience", () => {
    const all = [
      exp({ lane: "write" }),
      exp({ targeted: ["dom_contract"], fixed: ["dom_contract"] }),
      exp({ provider: "simulated" }),
      exp({ provider: "anthropic" }),
    ];
    const lessons = recallLessons(all, { lane: "security", failing: ["slop_visual"], provider: "meta" });
    expect(lessons.consulted).toBe(0);
    expect(lessons.worked).toEqual([]);
  });

  it("only recalls lessons from related issues when given the current issue", () => {
    const sentry = exp({ briefKeywords: ["policy", "event", "shape", "cli"], strategies: ["Validate event shape"] });
    const paths = exp({ briefKeywords: ["storage", "path", "workflows", "nested"], strategies: ["Strip a trailing workflows segment"] });
    const lessons = recallLessons([sentry, paths], {
      lane: "security",
      failing: ["slop_visual"],
      provider: "meta",
      brief: "cmd_record path becomes double-nested: storage path gets extra /workflows/",
    });
    expect(lessons.worked.map((l) => l.strategy)).toEqual(["Strip a trailing workflows segment"]);
  });

  it("lets recent evidence outrank old evidence", () => {
    const now = Date.now();
    const old = exp({ createdAt: new Date(now - 120 * DAY).toISOString(), strategies: ["Old trick"] });
    const fresh = exp({ createdAt: new Date(now - DAY).toISOString(), strategies: ["New trick"] });
    const lessons = recallLessons([old, fresh], { lane: "security", failing: ["slop_visual"], provider: "meta", now });
    expect(lessons.worked.map((l) => l.strategy)).toEqual(["New trick", "Old trick"]);
    expect(lessons.worked[1].weight).toBeLessThan(0.1);
  });

  it("frames lessons as hints below the brief and the gate", () => {
    const text = formatLessons(recallLessons([exp()], { lane: "security", failing: ["slop_visual"], provider: "meta" }));
    expect(text).toMatch(/brief and the rules come first/);
    expect(text).toMatch(/gate checks everything again/);
  });
});

describe("FileExperienceStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "thepolisher-exp-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends and reloads experiences, skipping corrupt lines", async () => {
    const store = new FileExperienceStore(dir);
    await store.append(exp({ strategies: ["one"] }));
    await appendFile(path.join(dir, "experiences.jsonl"), "{broken\n");
    await store.append(exp({ strategies: ["two"] }));
    expect((await new FileExperienceStore(dir).list()).map((e) => e.strategies[0])).toEqual(["one", "two"]);
  });
});
