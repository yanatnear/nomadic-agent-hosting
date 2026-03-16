import type { Database } from "bun:sqlite";

const CREATE_USERS = `
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_admin   INTEGER NOT NULL DEFAULT 0
)`;

const CREATE_ACCESS_TOKENS = `
CREATE TABLE IF NOT EXISTS access_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  label      TEXT NOT NULL DEFAULT ''
)`;

const CREATE_INSTANCES = `
CREATE TABLE IF NOT EXISTS instances (
  name          TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_type  TEXT NOT NULL,
  nomad_job_id  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'creating',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  error_message TEXT,
  image         TEXT NOT NULL DEFAULT '',
  mem_limit     TEXT NOT NULL DEFAULT '',
  cpus          TEXT NOT NULL DEFAULT '',
  storage_size  TEXT NOT NULL DEFAULT '',
  ssh_pubkey    TEXT NOT NULL DEFAULT '',
  token         TEXT NOT NULL DEFAULT '',
  node_id       TEXT NOT NULL DEFAULT '',
  meta          TEXT NOT NULL DEFAULT '{}'
)`;

export function initSchema(db: Database): void {
  db.run(CREATE_USERS);
  db.run(CREATE_ACCESS_TOKENS);
  db.run(CREATE_INSTANCES);
}
