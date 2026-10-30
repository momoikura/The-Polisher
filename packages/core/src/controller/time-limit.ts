/** Thrown when a run's time limit stops work in progress. The best version so far is kept. */
export class TimeLimitError extends Error {
  constructor(message = "Time limit reached; the best version so far is kept.") {
    super(message);
    this.name = "TimeLimitError";
  }
}

/** By name too, so a copy of this module loaded twice (bundles, dist vs src) still matches. */
export const isTimeLimit = (error: unknown): error is TimeLimitError =>
  error instanceof TimeLimitError || (error instanceof Error && error.name === "TimeLimitError");
