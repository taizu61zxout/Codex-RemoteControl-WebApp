import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

function hasColumn(database: DatabaseSync, table: string, column: string) {
  const columns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;

  return columns.some((entry) => entry.name === column);
}

export function initializeDatabase() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.sessionsDir, { recursive: true });

  const database = new DatabaseSync(config.databasePath);

  database.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      codex_thread_id TEXT,
      working_directory TEXT,
      model TEXT,
      intelligence TEXT,
      sandbox_mode TEXT,
      approval_policy TEXT,
      full_access_enabled INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS approval_rules (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      command_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_rules_session_prefix
      ON approval_rules(session_id, command_prefix);
  `);

  database.prepare(
    `
      INSERT INTO app_metadata (key, value)
      VALUES ('schema_version', 'phase-4')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    `
  ).run();

  if (!hasColumn(database, "sessions", "codex_thread_id")) {
    database.exec(
      "ALTER TABLE sessions ADD COLUMN codex_thread_id TEXT"
    );
  }

  if (!hasColumn(database, "sessions", "archived_at")) {
    database.exec(
      "ALTER TABLE sessions ADD COLUMN archived_at TEXT"
    );
  }

  return database;
}
