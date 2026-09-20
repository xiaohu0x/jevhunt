-- ============================================================================
-- JevHunt — initial schema
-- Cloudflare D1 (SQLite)
-- ============================================================================

-- Users -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT    PRIMARY KEY,           -- internal uuid
  google_sub    TEXT    UNIQUE NOT NULL,       -- Google "sub" claim (stable id)
  email         TEXT    UNIQUE NOT NULL,
  name          TEXT,
  picture       TEXT,
  created_at    INTEGER NOT NULL,              -- unix seconds
  last_login_at INTEGER
);

-- Sessions ----------------------------------------------------------------
-- We store only the SHA-256 hash of the session token, never the token itself.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,              -- sha256(token) hex
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT,
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Submissions (used by the "submit app" flow) ----------------------------
CREATE TABLE IF NOT EXISTS submissions (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  url         TEXT    NOT NULL,
  description TEXT,
  category    TEXT,
  status      TEXT    NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_user   ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);

-- OAuth state (short-lived CSRF nonces) -----------------------------------
CREATE TABLE IF NOT EXISTS oauth_states (
  state      TEXT    PRIMARY KEY,
  next       TEXT,                             -- post-login redirect (local path)
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_expires ON oauth_states(expires_at);
