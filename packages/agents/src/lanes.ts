/** The four agents. Each owns one part of the pull request. */
export const LANES = ["write", "ui", "code", "doc"] as const;
export type LaneId = (typeof LANES)[number];
