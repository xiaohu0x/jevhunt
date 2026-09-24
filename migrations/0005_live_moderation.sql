CREATE TRIGGER IF NOT EXISTS queue_approved_catalog_submission
AFTER UPDATE OF status, category, relationship, evidence_url ON submissions
WHEN NEW.status = 'approved'
BEGIN
  DELETE FROM catalog_withdrawals WHERE repo = lower(substr(NEW.url, 20));
  INSERT INTO catalog_candidates(repo,payload,priority,due_at)
  VALUES(lower(substr(NEW.url, 20)),
    json_object('repo',substr(NEW.url,20),'name',NEW.name,'description',NEW.description,
      'category',NEW.category,'relationship',NEW.relationship,'provenance',json_array('approved-submissions')),
    0, unixepoch())
  ON CONFLICT(repo) DO UPDATE SET payload=excluded.payload,priority=0,due_at=excluded.due_at;
  UPDATE catalog_control SET revision=lower(hex(randomblob(16))),published_at=unixepoch() WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS withdraw_catalog_submission
AFTER UPDATE OF status ON submissions
WHEN OLD.status = 'approved' AND NEW.status != 'approved'
BEGIN
  INSERT INTO catalog_withdrawals(repo,updated_at,reviewed_by)
  VALUES(lower(substr(NEW.url,20)),unixepoch(),NEW.reviewed_by)
  ON CONFLICT(repo) DO UPDATE SET updated_at=excluded.updated_at,reviewed_by=excluded.reviewed_by;
  DELETE FROM catalog_candidates WHERE repo=lower(substr(NEW.url,20));
  UPDATE catalog_control SET revision=lower(hex(randomblob(16))),published_at=unixepoch() WHERE id=1;
END;
