CREATE TABLE IF NOT EXISTS catalog_withdrawals (
  repo TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  reviewed_by TEXT NOT NULL
);
