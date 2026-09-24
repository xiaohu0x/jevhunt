CREATE TABLE IF NOT EXISTS catalog_entries (
  repo TEXT PRIMARY KEY,
  github_id INTEGER,
  payload TEXT NOT NULL,
  preview TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  relationship TEXT NOT NULL,
  language TEXT,
  stars INTEGER NOT NULL DEFAULT 0,
  created TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  checked_at INTEGER NOT NULL,
  next_check_at INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_github_id ON catalog_entries(github_id) WHERE github_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_order ON catalog_entries(active, stars DESC, created DESC, name);
CREATE INDEX IF NOT EXISTS idx_catalog_category ON catalog_entries(active, category, stars DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_check ON catalog_entries(next_check_at);

CREATE TABLE IF NOT EXISTS catalog_candidates (
  repo TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  due_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_catalog_candidate_due ON catalog_candidates(priority, due_at);

CREATE TABLE IF NOT EXISTS catalog_aliases (
  old_repo TEXT PRIMARY KEY,
  new_repo TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision TEXT NOT NULL DEFAULT 'uninitialized',
  published_at INTEGER NOT NULL DEFAULT 0,
  last_tick_at INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  meta TEXT NOT NULL DEFAULT '{}'
);
INSERT OR IGNORE INTO catalog_control (id) VALUES (1);

CREATE TABLE IF NOT EXISTS catalog_sources (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT '{}',
  last_checked_at INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER NOT NULL DEFAULT 0,
  next_due_at INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT
);

CREATE TABLE IF NOT EXISTS catalog_runs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
CREATE INDEX IF NOT EXISTS idx_catalog_runs_started ON catalog_runs(started_at DESC);
