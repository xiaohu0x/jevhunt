-- Authored project explanations and translations are stored outside catalog
-- payloads so a listing never downloads every project's full body in 15 locales.
CREATE TABLE IF NOT EXISTS project_content (
  repo TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL,
  version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  relationship TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reviewed','source-limited')),
  reviewed_at TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload))
);
CREATE UNIQUE INDEX IF NOT EXISTS project_content_identity ON project_content(github_id);

CREATE TABLE IF NOT EXISTS project_content_locales (
  repo TEXT NOT NULL,
  locale TEXT NOT NULL,
  summary TEXT NOT NULL,
  search_text TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  content_hash TEXT NOT NULL,
  PRIMARY KEY (repo, locale)
);

CREATE TABLE IF NOT EXISTS project_content_queue (
  repo TEXT PRIMARY KEY,
  github_id INTEGER,
  source_commit TEXT,
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','prepared','reviewed','published','unavailable')),
  queued_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS project_content_pending ON project_content_queue(state, queued_at);
