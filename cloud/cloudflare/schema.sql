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
CREATE TABLE IF NOT EXISTS email_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  debrief INTEGER NOT NULL DEFAULT 1,
  inflight INTEGER NOT NULL DEFAULT 1,
  signin INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS live_shares (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER,
  data TEXT,
  trail TEXT
);
CREATE INDEX IF NOT EXISTS live_shares_user ON live_shares(user_id);
CREATE TABLE IF NOT EXISTS challenge (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  joined_at INTEGER NOT NULL
);

-- Connect anywhere: a PC signed in to an account gets a key (only its SHA-256 is kept).
CREATE TABLE IF NOT EXISTS relay_keys (
  key_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bridge_id TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS relay_keys_user ON relay_keys(user_id);
