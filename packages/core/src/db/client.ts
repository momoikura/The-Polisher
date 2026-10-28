/**
 * Database client factory using Node 24 built-in native SQLite (DatabaseSync).
 *
 * Configures connection with WAL mode and foreign key enforcement
 * for high performance and zero external native compilation dependencies.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = DatabaseSync;

let _db: DatabaseSync | null = null;

/**
 * Get or create the SQLite database connection.
 * Uses WAL mode for concurrent read support.
 */
export function getDb(dbPath?: string): DatabaseSync {
  if (_db) return _db;

  const path = dbPath ?? process.env.DATABASE_PATH ?? "./data/polishloop.db";
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  _db = new DatabaseSync(path);

  // Enable WAL mode and foreign keys
  if (path !== ":memory:") {
    _db.exec("PRAGMA journal_mode = WAL;");
  }
  _db.exec("PRAGMA foreign_keys = ON;");

  return _db;
}

/**
 * Close the database connection.
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Get the raw database instance for direct execution and migrations.
 */
export function getRawDb(dbPath?: string): DatabaseSync {
  return getDb(dbPath);
}
