ALTER TABLE submissions ADD COLUMN consent_at INTEGER;
ALTER TABLE submissions ADD COLUMN reviewed_at INTEGER;
ALTER TABLE submissions ADD COLUMN reviewed_by TEXT;
ALTER TABLE submissions ADD COLUMN review_note TEXT;
ALTER TABLE submissions ADD COLUMN evidence_url TEXT;
ALTER TABLE submissions ADD COLUMN relationship TEXT;
CREATE INDEX idx_submissions_quota ON submissions(user_id, created_at);
CREATE INDEX idx_submissions_duplicate ON submissions(user_id, lower(url), status);
CREATE INDEX idx_submissions_review ON submissions(status, created_at, id);
