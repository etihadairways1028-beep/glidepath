-- Glidepath accounts on Cloudflare D1. Safe to run again: it only creates what's missing.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  monthly_email INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS flights (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  status TEXT NOT NULL,
  off_block_at INTEGER,
  summary TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS flights_time ON flights(user_id, off_block_at);
CREATE TABLE IF NOT EXISTS bridges (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bridge_id TEXT NOT NULL,
  name TEXT,
  addresses TEXT NOT NULL DEFAULT '[]',
  port INTEGER NOT NULL DEFAULT 4810,
  token TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, bridge_id)
);
CREATE TABLE IF NOT EXISTS login_fails (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS email_log (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  period TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, period)
);
