/**
 * Database schema definitions and constants for ThePolisher.
 *
 * Maps directly to the database entities defined in the specification (§9).
 * All IDs are ULIDs. JSON columns store mode-specific flexible data.
 * Content lives on the filesystem; only metadata lives here.
 */

export const TABLES = {
  RUNS: "runs",
  ARTIFACT_VERSIONS: "artifact_versions",
  EVALUATIONS: "evaluations",
  REPAIRS: "repairs",
  TEST_EXECUTIONS: "test_executions",
  LEARNED_STRATEGIES: "learned_strategies",
} as const;

export interface RunRow {
  id: string;
  mode: string;
  status: string;
  prompt: string;
  config_json: string;
  total_cost_usd: number;
  total_iterations: number;
  current_iteration: number;
  consecutive_rejections: number;
  best_version_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ArtifactVersionRow {
  id: string;
  run_id: string;
  version_number: number;
  content_hash: string;
  content_path: string;
  content_type: string;
  is_best: number;
  source: string;
  created_at: string;
}

export interface EvaluationRow {
  id: string;
  run_id: string;
  artifact_version_id: string;
  evaluator_model: string;
  subjective_scores_json: string;
  issues_json: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  created_at: string;
}

export interface RepairRow {
  id: string;
  run_id: string;
  source_version_id: string;
  result_version_id: string;
  repairer_model: string;
  issues_addressed_json: string;
  strategy_used: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  created_at: string;
}

export interface TestExecutionRow {
  id: string;
  run_id: string;
  artifact_version_id: string;
  test_type: string;
  authority: string;
  objective_pass: number;
  results_json: string;
  evidence_path: string | null;
  duration_ms: number;
  created_at: string;
}

export interface LearnedStrategyRow {
  id: string;
  mode: string;
  issue_pattern: string;
  strategy_description: string;
  times_used: number;
  times_successful: number;
  success_rate: number;
  created_at: string;
  updated_at: string;
}
