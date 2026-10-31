-- The launch board reads a 30-day window of creation dates on every homepage render.
CREATE INDEX IF NOT EXISTS idx_catalog_created ON catalog_entries(active, created);
