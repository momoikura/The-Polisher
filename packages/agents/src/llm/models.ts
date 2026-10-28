/**
 * Model configuration — default model assignments per agent role.
 *
 * The system uses different models for different roles to balance
 * cost and quality. Generator/Repairer need strong models; Evaluator
 * and Tester can use cheaper ones.
 */

import type { AgentRole } from "@polishloop/core";

/** Default model for each agent role (can be overridden per-run). */
export const DEFAULT_MODELS: Record<AgentRole, string> = {
  generator: "gpt-4o",
  evaluator: "gpt-4o-mini",
  repairer: "gpt-4o",
  tester: "gpt-4o-mini",
};

/**
 * Resolve the model ID for a given agent role, considering overrides.
 */
export function resolveModel(
  role: AgentRole,
  overrides?: Partial<Record<AgentRole, string>>
): string {
  return overrides?.[role] ?? DEFAULT_MODELS[role];
}
