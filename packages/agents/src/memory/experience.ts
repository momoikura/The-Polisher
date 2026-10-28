/**
 * Experience memory: what each repair tried, and what the gate made of it.
 *
 * Recorded automatically after every gate decision; recalled automatically
 * before every repair. Lessons are prompt hints only: the gate still decides,
 * so a remembered strategy can never make a bad candidate pass. No model
 * weights change.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LANES, type LaneId } from "../lanes.js";

export const ExperienceSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  lane: z.enum(LANES),
  model: z.string(),
  promptVersion: z.string(),
  provider: z.string().min(1),
  briefKeywords: z.array(z.string()).max(12),
  /** Failing objective checks on the version the repair started from. */
  targeted: z.array(z.string()),
  /** Checks that went from failing to passing / passing to failing. */
  fixed: z.array(z.string()),
  broke: z.array(z.string()),
  problemsBefore: z.number(),
  problemsAfter: z.number(),
  scoreBefore: z.number().nullable(),
  scoreAfter: z.number().nullable(),
  accepted: z.boolean(),
  reason: z.string(),
  strategies: z.array(z.string().max(240)).max(6),
});
export type Experience = z.infer<typeof ExperienceSchema>;

export interface ExperienceStore {
  list(): Promise<Experience[]>;
  append(experience: Experience): Promise<void>;
}

// ─── Storage ──────────────────────────────────────────────────────────────

const MAX_LOADED = 5000;

/** Append-only JSON Lines file. Corrupt lines are skipped, never fatal. */
export class FileExperienceStore implements ExperienceStore {
  private readonly file: string;
  constructor(dir: string) {
    this.file = path.join(dir, "experiences.jsonl");
  }

  async list(): Promise<Experience[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch {
      return [];
    }
    return raw
      .split("\n")
      .slice(-MAX_LOADED)
      .flatMap((line) => {
        if (!line.trim()) return [];
        try {
          const parsed = ExperienceSchema.safeParse(JSON.parse(line));
          return parsed.success ? [parsed.data] : [];
        } catch {
          return [];
        }
      });
  }

  async append(experience: Experience): Promise<void> {
    const valid = ExperienceSchema.parse(experience);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.appendFile(this.file, `${JSON.stringify(valid)}\n`, "utf8");
  }
}

export class MemoryExperienceStore implements ExperienceStore {
  private items: Experience[] = [];
  constructor(initial: Experience[] = []) {
    this.items = [...initial];
  }
  async list(): Promise<Experience[]> {
    return [...this.items];
  }
  async append(experience: Experience): Promise<void> {
    this.items = [...this.items, ExperienceSchema.parse(experience)];
  }
}

// ─── Recording ────────────────────────────────────────────────────────────

export interface CheckSnapshot {
  testType: string;
  passed: boolean;
  problemCount?: number;
}

const problems = (checks: CheckSnapshot[]) =>
  checks.reduce((n, c) => n + (c.passed ? 0 : Math.max(c.problemCount ?? 1, 1)), 0);

export interface ExperienceInput {
  lane: LaneId;
  model: string;
  promptVersion: string;
  provider: string;
  brief: string;
  before: CheckSnapshot[];
  after: CheckSnapshot[];
  scoreBefore: number | null;
  scoreAfter: number | null;
  accepted: boolean;
  reason: string;
  strategies: string[];
}

export function buildExperience(input: ExperienceInput): Experience {
  const beforeFailing = new Set(input.before.filter((c) => !c.passed).map((c) => c.testType));
  const beforePassing = new Set(input.before.filter((c) => c.passed).map((c) => c.testType));
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    lane: input.lane,
    model: input.model,
    promptVersion: input.promptVersion,
    provider: input.provider,
    briefKeywords: keywords(input.brief),
    targeted: [...beforeFailing],
    fixed: input.after.filter((c) => c.passed && beforeFailing.has(c.testType)).map((c) => c.testType),
    broke: input.after.filter((c) => !c.passed && beforePassing.has(c.testType)).map((c) => c.testType),
    problemsBefore: problems(input.before),
    problemsAfter: problems(input.after),
    scoreBefore: input.scoreBefore,
    scoreAfter: input.scoreAfter,
    accepted: input.accepted,
    reason: input.reason,
    strategies: input.strategies.map((s) => s.trim().slice(0, 240)).filter(Boolean).slice(0, 6),
  };
}

const STOPWORDS = new Set("a an and the for of to with in on at by from that this is are be it its as or page site".split(" "));

export function keywords(text: string): string[] {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length > 2 && !STOPWORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
}

// ─── Recall ───────────────────────────────────────────────────────────────

export interface Lesson {
  strategy: string;
  /** Checks this strategy fixed (for "worked") or broke (for "avoid"). */
  checks: string[];
  kept: number;
  rejected: number;
  regressions: number;
  weight: number;
}

export interface RecalledLessons {
  worked: Lesson[];
  avoid: Lesson[];
  consulted: number;
}

const HALF_LIFE_DAYS = 30;
const MAX_WORKED = 4;
const MAX_AVOID = 3;
const REGRESSION_PENALTY = 2;
const DAY_MS = 86_400_000;

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

export interface RecallQuery {
  lane: LaneId;
  failing: string[];
  provider: string;
  /** The current issue. When given, only lessons from issues sharing a few keywords with it are recalled. */
  brief?: string;
  now?: number;
}

/** How many issue keywords a past run must share to count as related. */
const MIN_SHARED_KEYWORDS = 2;

/**
 * Lessons for the checks failing right now, from the same lane. Only gate
 * outcomes count: a strategy is "worked" only if it was kept AND fixed at
 * least one of the checks failing now, with no regression.
 */
export function recallLessons(all: Experience[], query: RecallQuery): RecalledLessons {
  const now = query.now ?? Date.now();
  const failing = new Set(query.failing);
  // A fix for one repo's bug ("validate event shape") is noise in an unrelated issue.
  const briefWords = query.brief === undefined ? null : new Set(keywords(query.brief));
  const isRelated = (e: Experience) =>
    !briefWords || e.briefKeywords.filter((w) => briefWords.has(w)).length >= MIN_SHARED_KEYWORDS;
  const relevant = all.filter(
    (e) => e.lane === query.lane && e.provider === query.provider && e.targeted.some((t) => failing.has(t)) && isRelated(e)
  );

  const byStrategy = new Map<string, { strategy: string; fixed: Set<string>; broke: Set<string>; kept: number; rejected: number; regressions: number; weight: number }>();
  for (const e of relevant) {
    const ageDays = Math.max(0, (now - Date.parse(e.createdAt)) / DAY_MS);
    const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const helpedNow = e.fixed.filter((c) => failing.has(c));
    const isWin = e.accepted && helpedNow.length > 0 && e.broke.length === 0;
    const delta = (isWin ? 1 : e.accepted ? 0 : -1) - REGRESSION_PENALTY * (e.broke.length > 0 ? 1 : 0);

    for (const raw of e.strategies) {
      const key = normalize(raw);
      if (!key) continue;
      const entry = byStrategy.get(key) ?? { strategy: raw, fixed: new Set(), broke: new Set(), kept: 0, rejected: 0, regressions: 0, weight: 0 };
      if (isWin) helpedNow.forEach((c) => entry.fixed.add(c));
      e.broke.forEach((c) => entry.broke.add(c));
      entry.kept += isWin ? 1 : 0;
      entry.rejected += e.accepted ? 0 : 1;
      entry.regressions += e.broke.length > 0 ? 1 : 0;
      entry.weight += delta * decay;
      byStrategy.set(key, entry);
    }
  }

  const entries = [...byStrategy.values()];
  const worked = entries
    .filter((s) => s.kept > 0 && s.weight > 0 && s.regressions === 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_WORKED)
    .map((s) => ({ strategy: s.strategy, checks: [...s.fixed], kept: s.kept, rejected: s.rejected, regressions: s.regressions, weight: s.weight }));
  const avoid = entries
    .filter((s) => s.regressions > 0 || (s.kept === 0 && s.rejected >= 2))
    .sort((a, b) => a.weight - b.weight)
    .slice(0, MAX_AVOID)
    .map((s) => ({ strategy: s.strategy, checks: [...s.broke], kept: s.kept, rejected: s.rejected, regressions: s.regressions, weight: s.weight }));

  return { worked, avoid, consulted: relevant.length };
}

export function formatLessons(lessons: RecalledLessons): string {
  if (!lessons.worked.length && !lessons.avoid.length) return "";
  const pretty = (checks: string[]) => checks.map((c) => c.replace(/_/g, " ")).join(", ");
  const worked = lessons.worked.map(
    (l) => `- "${l.strategy}" (fixed ${pretty(l.checks)}; kept ${l.kept}x)`
  );
  const avoid = lessons.avoid.map(
    (l) => `- "${l.strategy}" (${l.regressions ? `broke ${pretty(l.checks) || "a passing check"}` : `rejected ${l.rejected}x`})`
  );
  return [
    "LESSONS FROM EARLIER RUNS. These come from the gate's verdicts, not from a model's opinion. Use them as hints: the brief and the rules come first, and the gate checks everything again.",
    worked.length ? `Worked before for checks failing now:\n${worked.join("\n")}` : "",
    avoid.length ? `Did not work (rejected or broke something):\n${avoid.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Summary for the dashboard ────────────────────────────────────────────

export interface LaneMemorySummary {
  lane: LaneId;
  attempts: number;
  kept: number;
  rejected: number;
  topStrategies: Array<{ strategy: string; checks: string[]; kept: number }>;
}

export function summarizeExperience(all: Experience[], provider: string): LaneMemorySummary[] {
  return LANES.map((lane) => {
    const mine = all.filter((e) => e.lane === lane && e.provider === provider);
    const failingEver = [...new Set(mine.flatMap((e) => e.targeted))];
    const lessons = recallLessons(all, { lane, failing: failingEver, provider });
    return {
      lane,
      attempts: mine.length,
      kept: mine.filter((e) => e.accepted).length,
      rejected: mine.filter((e) => !e.accepted).length,
      topStrategies: lessons.worked.slice(0, 3).map((l) => ({ strategy: l.strategy, checks: l.checks, kept: l.kept })),
    };
  });
}
