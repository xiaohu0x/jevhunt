import { applyProjectContent, matchingProjectContent } from "../../shared/project-content.js";
import { projectContentHash } from "./project-content.mjs";
import { activeClause } from "../../shared/catalog-data.js";

export const sqlValue = value => value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";

export function projectContentStatements(project, record, now) {
  if (!matchingProjectContent(project, record)) throw new Error(`Content identity mismatch: ${record.repo}`);
  const p = applyProjectContent(project, record), repo = p.repo.toLowerCase(), hash = projectContentHash(record);
  const exists = `EXISTS (SELECT 1 FROM catalog_entries WHERE repo=${sqlValue(repo)} AND github_id=${record.repositoryId} AND ${activeClause})`;
  const statements = [
    `DELETE FROM project_content_locales WHERE repo IN (SELECT repo FROM project_content WHERE github_id=${record.repositoryId} AND repo!=${sqlValue(repo)}) AND ${exists};`,
    `DELETE FROM project_content_queue WHERE github_id=${record.repositoryId} AND repo!=${sqlValue(repo)} AND ${exists};`,
    `DELETE FROM project_content WHERE github_id=${record.repositoryId} AND repo!=${sqlValue(repo)} AND ${exists};`,
    `INSERT INTO project_content(repo,github_id,version,content_hash,source_commit,relationship,category,status,reviewed_at,payload)
     SELECT ${[repo, record.repositoryId, record.version, hash, record.sources[0].commit, record.relationship, record.category, record.status, record.reviewedAt, JSON.stringify(record)].map(sqlValue).join(",")} WHERE ${exists}
     ON CONFLICT(repo) DO UPDATE SET github_id=excluded.github_id,version=excluded.version,content_hash=excluded.content_hash,source_commit=excluded.source_commit,
     relationship=excluded.relationship,category=excluded.category,status=excluded.status,reviewed_at=excluded.reviewed_at,payload=excluded.payload;`,
  ];
  for (const [locale, content] of Object.entries(record.locales)) {
    statements.push(`INSERT INTO project_content_locales(repo,locale,summary,search_text,description,payload,content_hash)
      SELECT ${[repo, locale, content.summary, content.summary.toLowerCase(), content.description, JSON.stringify(content), hash].map(sqlValue).join(",")} WHERE ${exists}
      ON CONFLICT(repo,locale) DO UPDATE SET summary=excluded.summary,search_text=excluded.search_text,description=excluded.description,payload=excluded.payload,content_hash=excluded.content_hash;`);
  }
  // Patch only authored fields. Never overwrite stars, activity, archival state,
  // current commit, or other metadata a concurrent scheduled refresh updated.
  statements.push(`UPDATE catalog_entries SET name=${sqlValue(p.name)},category=${sqlValue(p.cat)},relationship=${sqlValue(p.relationship)},
    payload=json_set(payload,'$.name',${sqlValue(p.name)},'$.repositoryName',${sqlValue(p.repositoryName)},'$.cat',${sqlValue(p.cat)},'$.relationship',${sqlValue(p.relationship)},
      '$.content',json(${sqlValue(JSON.stringify(p.content))}),'$.content.sourceChanged',json(CASE WHEN json_extract(payload,'$.commit')=${sqlValue(record.sources[0].commit)} THEN 'false' ELSE 'true' END),
      '$.evidence',${sqlValue(p.evidence)},'$.evidenceLevel',${sqlValue(p.evidenceLevel)},'$.verification',${sqlValue(p.verification)},'$.evidenceCheckedAt',${sqlValue(p.evidenceCheckedAt)},'$.evidenceDetail',json(${sqlValue(JSON.stringify(p.evidenceDetail))})),
    preview=json_set(preview,'$.id',${record.repositoryId},'$.name',${sqlValue(p.name)},'$.cat',${sqlValue(p.cat)},'$.relationship',${sqlValue(p.relationship)},'$.desc',${sqlValue(record.locales.en.summary)},'$.evidence',${sqlValue(p.evidence)},'$.evidenceLevel',${sqlValue(p.evidenceLevel)})
    WHERE repo=${sqlValue(repo)} AND github_id=${record.repositoryId} AND ${activeClause};`);
  statements.push(`INSERT INTO project_content_queue(repo,github_id,source_commit,reason,state,queued_at,updated_at)
    SELECT ${sqlValue(repo)},${record.repositoryId},json_extract(payload,'$.commit'),
      CASE WHEN json_extract(payload,'$.commit')=${sqlValue(record.sources[0].commit)} THEN 'reviewed-content' ELSE 'source-changed' END,
      CASE WHEN json_extract(payload,'$.commit')=${sqlValue(record.sources[0].commit)} THEN 'published' ELSE 'pending' END,${now},${now}
    FROM catalog_entries WHERE repo=${sqlValue(repo)} AND github_id=${record.repositoryId} AND ${activeClause}
    ON CONFLICT(repo) DO UPDATE SET github_id=excluded.github_id,source_commit=excluded.source_commit,reason=excluded.reason,state=excluded.state,updated_at=excluded.updated_at,last_error=NULL;`);
  for (const statement of statements) if (Buffer.byteLength(statement) > 95_000) throw new Error(`${record.repo}: content exceeds the D1 statement safety budget`);
  return statements;
}

// Verify the imported records as well as the denormalized listing/search fields.
// Read only the selected identities; unrelated live catalog updates may continue.
export function projectContentVerificationSql(records) {
  const repos = [...records.keys()].map(sqlValue).join(",");
  return `SELECT c.repo,c.github_id,c.content_hash,c.payload AS content_payload,
    e.github_id AS catalog_id,e.name,e.category,e.relationship,e.payload AS project_payload,e.preview,
    q.state AS queue_state,q.reason AS queue_reason,q.source_commit AS queue_commit,
    (SELECT COUNT(*) FROM project_content_locales l WHERE l.repo=c.repo) AS locale_count,
    (SELECT COUNT(*) FROM project_content_locales l WHERE l.repo=c.repo AND (
      l.content_hash IS NOT c.content_hash OR
      l.summary IS NOT json_extract(c.payload,'$.locales."'||l.locale||'".summary') OR
      l.description IS NOT json_extract(c.payload,'$.locales."'||l.locale||'".description') OR
      json(l.payload) IS NOT json(json_extract(c.payload,'$.locales."'||l.locale||'"'))
    )) AS locale_mismatches,
    (SELECT json_group_array(json_object('locale',l.locale,'text',l.search_text))
      FROM project_content_locales l WHERE l.repo=c.repo) AS search_fields
    FROM project_content c JOIN catalog_entries e ON e.repo=c.repo LEFT JOIN project_content_queue q ON q.repo=c.repo
    WHERE c.repo IN (${repos}) AND ${activeClause.replaceAll("catalog_entries.", "e.")};`;
}

export function verifyPublishedProjectContent(rows, records) {
  const actual = new Map(rows.map(row => [row.repo, row]));
  const errors = [];
  let localePages = 0;
  for (const [repo, record] of records) {
    const row = actual.get(repo);
    const check = (condition, message) => { if (!condition) errors.push(`${repo}: ${message}`); };
    if (!row) { check(false, "reviewed content missing from the active catalog"); continue; }
    check(row.github_id === record.repositoryId && row.catalog_id === record.repositoryId, "repository identity differs");
    const hash = projectContentHash(record);
    check(row.content_hash === hash && projectContentHash(JSON.parse(row.content_payload)) === hash, "content hash differs");
    const payload = JSON.parse(row.project_payload), preview = JSON.parse(row.preview);
    for (const [surface, value] of [["catalog", row], ["detail", payload], ["preview", preview]]) {
      check(value.relationship === record.relationship && (value.category || value.cat) === record.category, `${surface} classification differs`);
      if (record.displayName) check(value.name === record.displayName, `${surface} project name differs`);
    }
    check(payload.id === record.repositoryId && preview.id === record.repositoryId, "public identity differs");
    check(payload.content?.version === record.version && payload.content?.summary === record.locales.en.summary, "compact content metadata differs");
    if (payload.commit !== record.sources[0].commit) check(row.queue_state === "pending" && row.queue_reason === "source-changed" && row.queue_commit === payload.commit, "changed source is missing from the review queue");
    check(preview.desc === record.locales.en.summary, "English listing summary differs");
    check(row.locale_count === Object.keys(record.locales).length && row.locale_mismatches === 0, "locale data incomplete or inconsistent");
    const searches = new Map(JSON.parse(row.search_fields).map(field => [field.locale, field.text]));
    for (const [locale, copy] of Object.entries(record.locales)) check(searches.get(locale) === copy.summary.toLowerCase(), `${locale} search text differs`);
    localePages += row.locale_count;
  }
  if (errors.length) throw new Error("Content publication verification failed:\n" + errors.join("\n"));
  return { repositories: records.size, localePages };
}
