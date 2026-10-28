/**
 * Database migration script.
 *
 * Creates all tables if they don't exist. Uses raw SQL CREATE TABLE
 * statements for reliability (Drizzle push can be flaky for SQLite).
 * Run with: pnpm --filter @polishloop/core db:migrate
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getRawDb, closeDb } from "./client.js";

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    prompt TEXT NOT NULL,
    config_json TEXT NOT NULL,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    total_iterations INTEGER NOT NULL DEFAULT 0,
    current_iteration INTEGER NOT NULL DEFAULT 0,
    consecutive_rejections INTEGER NOT NULL DEFAULT 0,
    best_version_id TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS artifact_versions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    version_number INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    content_path TEXT NOT NULL,
    content_type TEXT NOT NULL,
    is_best INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS evaluations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
    evaluator_model TEXT NOT NULL,
    subjective_scores_json TEXT NOT NULL,
    issues_json TEXT NOT NULL,
    prompt_tokens REAL NOT NULL DEFAULT 0,
    completion_tokens REAL NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS repairs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    source_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
    result_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
    repairer_model TEXT NOT NULL,
    issues_addressed_json TEXT NOT NULL,
    strategy_used TEXT,
    prompt_tokens REAL NOT NULL DEFAULT 0,
    completion_tokens REAL NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS test_executions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
    test_type TEXT NOT NULL,
    authority TEXT NOT NULL,
    objective_pass INTEGER NOT NULL,
    results_json TEXT NOT NULL,
    evidence_path TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS learned_strategies (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    issue_pattern TEXT NOT NULL,
    strategy_description TEXT NOT NULL,
    times_used INTEGER NOT NULL DEFAULT 0,
    times_successful INTEGER NOT NULL DEFAULT 0,
    success_rate REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ─── Indexes ───────────────────────────────────────────────────────────────

  `CREATE INDEX IF NOT EXISTS idx_artifact_versions_run_id ON artifact_versions(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_versions_is_best ON artifact_versions(is_best) WHERE is_best = 1`,
  `CREATE INDEX IF NOT EXISTS idx_evaluations_run_id ON evaluations(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evaluations_artifact_version_id ON evaluations(artifact_version_id)`,
  `CREATE INDEX IF NOT EXISTS idx_repairs_run_id ON repairs(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_test_executions_run_id ON test_executions(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_test_executions_artifact_version_id ON test_executions(artifact_version_id)`,
  `CREATE INDEX IF NOT EXISTS idx_learned_strategies_mode ON learned_strategies(mode)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)`,
];

export function runMigrations(dbPath?: string): void {
  const path = dbPath ?? process.env.DATABASE_PATH ?? "./data/polishloop.db";

  // Ensure the data directory exists
  mkdirSync(dirname(path), { recursive: true });

  const db = getRawDb(path);

  console.log(`Running migrations on ${path}...`);

  for (const sql of MIGRATIONS) {
    db.exec(sql);
  }

  console.log(`Migrations complete. ${MIGRATIONS.length} statements executed.`);
  closeDb();
}

// Run directly if invoked as a script
const isMain =
  process.argv[1]?.endsWith("migrate.ts") ||
  process.argv[1]?.endsWith("migrate.js");

if (isMain) {
  runMigrations();
}
