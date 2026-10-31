-- Lets the sync worker verify repositories with enough stars for the launch
-- board first. About one new repository in a hundred qualifies, so the index
-- stays small. Its expressions and WHERE clause must match the worker's query.
CREATE INDEX IF NOT EXISTS idx_catalog_candidate_notable
  ON catalog_candidates(json_extract(payload, '$.created'), due_at)
  WHERE priority = 0 AND json_extract(payload, '$.stars') >= 5;
