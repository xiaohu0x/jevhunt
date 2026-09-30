-- Detail-page titles disambiguate active repositories with the same name.
CREATE INDEX IF NOT EXISTS catalog_entries_name_nocase_idx
  ON catalog_entries(name COLLATE NOCASE);
