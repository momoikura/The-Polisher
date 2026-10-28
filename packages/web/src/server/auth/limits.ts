/**
 * Run limits. Users bring their own Meta key, but every run still uses the
 * Modal sandbox on the owner's account, so these keep one person or a burst of
 * traffic from running up that bill or overloading the sandbox.
 */

export interface RunLimits {
  perUserActive: number;
  perUserDaily: number;
  globalActive: number;
}

export interface RunUsage {
  userActive: number;
  userToday: number;
  globalActive: number;
}

const positive = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function runLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): RunLimits {
  return {
    perUserActive: positive(env.THEPOLISHER_RUNS_PER_USER_ACTIVE, 1),
    perUserDaily: positive(env.THEPOLISHER_RUNS_PER_USER_DAILY, 10),
    globalActive: positive(env.THEPOLISHER_RUNS_GLOBAL_ACTIVE, 5),
  };
}

/** Why a run can't start right now, or null if it can. */
export function checkRunLimits(usage: RunUsage, limits: RunLimits): string | null {
  if (usage.userActive >= limits.perUserActive) return "You already have a run going. Wait for it to finish.";
  if (usage.userToday >= limits.perUserDaily) return `You've used your ${limits.perUserDaily} runs today. Try again tomorrow.`;
  if (usage.globalActive >= limits.globalActive) return "ThePolisher is busy with other people's runs right now. Try again in a few minutes.";
  return null;
}
