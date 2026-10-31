-- Lets the sync worker verify recently created repositories before the older
-- backlog. The expression must stay identical to the one in its queries.
CREATE INDEX IF NOT EXISTS idx_catalog_candidate_created
  ON catalog_candidates(priority, json_extract(payload, '$.created'), due_at);
