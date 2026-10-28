/**
 * Shared memory that only learns from runs the sandbox verified.
 *
 * Every user's agents recall from one shared store, so a lesson is a message to
 * other people's prompts. During a run its lessons are held back; they're shared
 * only if the run ends clean or verified, trimmed, so one bad or malicious run
 * can't plant long instructions for everyone else.
 */

import type { Experience, ExperienceStore } from "@thepolisher/agents";
import type { RunStatus } from "./types.js";

const SHARED_STATUSES: ReadonlySet<RunStatus> = new Set(["clean", "verified"]);
const MAX_STRATEGY_CHARS = 240;
const MAX_STRATEGIES = 5;

const trim = (e: Experience): Experience => ({
  ...e,
  strategies: e.strategies.slice(0, MAX_STRATEGIES).map((s) => (s.length > MAX_STRATEGY_CHARS ? `${s.slice(0, MAX_STRATEGY_CHARS - 1)}…` : s)),
});

export class VerifiedMemory implements ExperienceStore {
  private readonly pending: Experience[] = [];

  constructor(private readonly shared: ExperienceStore) {}

  /** Shared lessons plus this run's own, so the run learns from itself as it goes. */
  async list(): Promise<Experience[]> {
    return [...(await this.shared.list()), ...this.pending];
  }

  async append(experience: Experience): Promise<void> {
    this.pending.push(experience);
  }

  /** Share this run's lessons if its outcome was verified; otherwise drop them. */
  async commit(status: RunStatus): Promise<number> {
    if (!SHARED_STATUSES.has(status)) return 0;
    for (const e of this.pending) await this.shared.append(trim(e));
    return this.pending.length;
  }
}
