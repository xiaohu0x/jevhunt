-- 1) The withdrawn/aliased filter in `activeClause` joins catalog_aliases by
--    new_repo, which had no index, so the correlated subquery could not be
--    satisfied from an index. Add the missing one.
CREATE INDEX IF NOT EXISTS idx_catalog_aliases_new ON catalog_aliases(new_repo);

-- 2) Materialised catalogue metadata. The publish `revision` in catalog_control
--    changes only when the catalogue actually changes, so the expensive
--    aggregates (per-category counts, distinct languages) and the "recently
--    pushed" preview list can be computed once per revision instead of on
--    every page/API request. This table holds one row with the snapshot.
CREATE TABLE IF NOT EXISTS catalog_snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision TEXT NOT NULL,
  payload TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);
