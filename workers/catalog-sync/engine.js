import sourceConfig from "../../catalog/sources.json" with { type: "json" };
import overrides from "../../catalog/overrides.json" with { type: "json" };
import { inspectRepository, POLICY_VERSION } from "../../shared/catalog-policy.js";
import { validRepo, publicPreview, inferCategory, cleanText } from "../../shared/catalog-data.js";
import { PublicGitHub } from "./github-public.js";
import { attachProjectContent } from "../../shared/project-content-store.js";

const epoch = () => Math.floor(Date.now() / 1000);
const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const excluded = new Set(overrides.excluded.map(value => (typeof value === "string" ? value : value.repo).toLowerCase()));
const sourceCategories = { "client-libraries-and-integrations": "integrations", "agent-and-developer-tooling": "agents", "browser-agents": "browser", "applications-and-workflows": "apps", "games-and-robotics": "games", "evaluations-and-independent-research": "research", "showcases-and-field-notes": "demos" };
const FRESH_LOOKBACK_DAYS = 35;
const BACKLOG_LIMIT = 5000;
const REVISION_INTERVAL = 15 * 60;
// LAUNCH_MIN_STARS on the launch board. Changing it also takes a new partial index.
const NOTABLE_STARS = 5;
const CANDIDATE_CREATED = "json_extract(payload,'$.created')";
const CANDIDATE_NOTABLE = `priority=0 AND json_extract(payload,'$.stars')>=${NOTABLE_STARS}`;
const shiftDay = (day, days) => new Date(Date.parse(day) + days * 86400000).toISOString().slice(0, 10);

/**
 * Each query runs three scans. The fresh scan only covers repositories created
 * since its last finished pass, so a new project is found within the hour
 * however far the full historical pass has got, and an outage leaves no gap.
 * That finds most projects before anyone has starred them, so the star scan
 * asks for the few that have since reached the launch board's floor.
 */
export const catalogSources = () => [
  ...sourceConfig.githubQueries.map((query, i) => ({ id: `github-notable-${i}`, query: `${query} stars:>=${NOTABLE_STARS}`, type: "search", fresh: true, notable: true })),
  ...sourceConfig.githubQueries.map((query, i) => ({ id: `github-fresh-${i}`, query, type: "search", fresh: true })),
  ...sourceConfig.githubQueries.map((query, i) => ({ id: `github-search-${i}`, query, type: "search" })),
  ...sourceConfig.sources,
];

async function removalAllowed(DB) {
  const row = await DB.prepare(`SELECT (SELECT COUNT(*) FROM catalog_entries WHERE active=1) AS n,
    json_extract(meta,'$.automaticRemovalFloor') AS floor FROM catalog_control WHERE id=1`).first();
  return row.n > (row.floor || 100);
}

async function enqueue(DB, candidates, now) {
  const data = candidates.filter(p => validRepo(p.repo) && !excluded.has(p.repo.toLowerCase())).map(p => ({ ...p, repo: p.repo.toLowerCase() }));
  if (!data.length) return;
  // A listed repository comes back when it has changed, or to go first when it
  // has reached the launch board's floor since its last check.
  const rising = `COALESCE(json_extract(value,'$.stars'),0)>=${NOTABLE_STARS} AND e.stars<${NOTABLE_STARS}`;
  // JSON expansion happens inside D1: one statement, not thousands of calls.
  await DB.prepare(`INSERT INTO catalog_candidates (repo, payload, priority, due_at)
    SELECT json_extract(value, '$.repo'), value,
      CASE WHEN EXISTS (SELECT 1 FROM catalog_entries e WHERE e.repo = json_extract(value, '$.repo') AND NOT (${rising})) THEN 1 ELSE 0 END, ?
    FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM catalog_withdrawals w WHERE w.repo = json_extract(value, '$.repo'))
      AND (NOT EXISTS (SELECT 1 FROM catalog_entries e WHERE e.repo=json_extract(value,'$.repo'))
        OR EXISTS (SELECT 1 FROM catalog_entries e WHERE e.repo=json_extract(value,'$.repo') AND e.checked_at < ?
          AND (json_extract(value,'$.pushed') > COALESCE(json_extract(e.payload,'$.pushed'),'') OR (${rising}))))
    ON CONFLICT(repo) DO UPDATE SET payload = excluded.payload,
      priority = CASE WHEN catalog_candidates.priority=1 THEN excluded.priority ELSE catalog_candidates.priority END,
      due_at = CASE WHEN json_extract(excluded.payload,'$.pushed') > COALESCE(json_extract(catalog_candidates.payload,'$.pushed'),'')
        THEN MIN(catalog_candidates.due_at, excluded.due_at) ELSE catalog_candidates.due_at END
      WHERE catalog_candidates.payload <> excluded.payload`).bind(now, JSON.stringify(data), now - 3600).run();
}

async function discover(DB, github, source, state, now) {
  let candidates = [], nextState = {}, delay = 6 * 3600;
  if (source.type === "projects" || source.type === "resources") {
    const data = await github.request(source.url, { limit: 2_000_000 });
    if (source.type === "projects") {
      if (!Array.isArray(data?.projects)) throw new Error("Invalid project feed");
      candidates = data.projects.filter(p => p.repo && !p.gone).map(p => ({ ...p, provenance: [source.id] }));
    } else {
      if (!Array.isArray(data?.categories)) throw new Error("Invalid resource feed");
      for (const category of data.categories) for (const item of category.resources || []) {
        const match = /^https:\/\/github.com\/([a-z0-9-]+\/[a-z0-9_.-]+)\/?$/i.exec(item.url);
        if (match) candidates.push({ repo: match[1], cat: sourceCategories[category.id], provenance: [source.id] });
      }
    }
    nextState = { sourceUpdatedAt: data.updated || data.last_updated, candidates: candidates.length };
  } else {
    // Numeric source IDs survive configuration edits. A cursor only belongs to
    // the exact query that created it, including qualifiers such as fork:false.
    const sameQuery = state.query === source.query;
    const continuing = sameQuery && state.windows?.length;
    const today = new Date(now * 1000).toISOString().slice(0, 10);
    const freshFrom = sameQuery && state.coveredTo ? shiftDay(state.coveredTo, -1) : shiftDay(today, -FRESH_LOOKBACK_DAYS);
    const windows = continuing ? state.windows.map(window => ({ ...window })) : [{ from: source.fresh ? freshFrom : "2008-01-01", to: today, page: 1 }];
    state = { query: source.query, windows, partial: continuing ? !!state.partial : false,
      lastCompleteAt: sameQuery ? state.lastCompleteAt || null : null,
      lastPageAt: sameQuery ? state.lastPageAt || null : null,
      pagesScanned: continuing ? Number(state.pagesScanned || 0) : 0,
      passTo: continuing ? state.passTo : today, coveredTo: sameQuery ? state.coveredTo || null : null };
    // Persist the reset before external I/O so a rate-limit failure cannot
    // leave an old query's windows or completion timestamp masquerading as new.
    await DB.prepare(`INSERT INTO catalog_sources(id,state) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,
      last_success_at=CASE WHEN ? THEN catalog_sources.last_success_at ELSE 0 END`)
      .bind(source.id, JSON.stringify(state), sameQuery ? 1 : 0).run();
    const window = windows[0];
    const q = `${source.query} is:public created:${window.from}..${window.to}`;
    const result = await github.api(`/search/repositories?q=${encodeURIComponent(q)}&per_page=100&page=${window.page}`);
    if (!Array.isArray(result?.items)) throw new Error("Invalid search result");
    let partial = state.partial || result.incomplete_results;
    if (result.total_count > 1000 && window.from !== window.to) {
      const left = Date.parse(window.from), right = Date.parse(window.to);
      const mid = new Date(left + Math.floor((right - left) / 172800000) * 86400000).toISOString().slice(0, 10);
      const after = new Date(Date.parse(mid) + 86400000).toISOString().slice(0, 10);
      const older = { from: window.from, to: mid, page: 1 }, newer = { from: after, to: window.to, page: 1 };
      windows.splice(0, 1, ...(source.fresh ? [newer, older] : [older, newer]));
    } else {
      candidates = result.items.filter(p => !p.private).map(p => ({ repo: p.full_name, description: p.description, language: p.language, stars: p.stargazers_count, pushed: p.pushed_at?.slice(0,10), created: p.created_at?.slice(0,10), provenance: ["github-search"] }));
      if (result.total_count > 1000) partial = true;
      if (window.page < Math.min(10, Math.ceil(result.total_count / 100))) window.page++;
      else windows.shift();
    }
    nextState = { query: source.query, windows, partial: !!partial, lastCompleteAt: windows.length ? state.lastCompleteAt || null : now,
      lastPageAt: now, pagesScanned: state.pagesScanned + 1, passTo: state.passTo, coveredTo: windows.length || source.notable ? state.coveredTo : state.passTo };
    if (source.fresh) delay = windows.length ? 30 : 3600;
    // Scanning faster than the queue drains only makes the queue longer.
    else if (windows.length) delay = await DB.prepare("SELECT 1 FROM catalog_candidates WHERE priority=0 AND due_at<=? LIMIT 1 OFFSET ?").bind(now, BACKLOG_LIMIT).first() ? 2 * 3600 : 20 * 60;
  }
  await enqueue(DB, candidates, now);
  await DB.prepare(`INSERT INTO catalog_sources(id,state,last_checked_at,last_success_at,next_due_at,status,error)
    VALUES(?,?,?,?,?,'ok',NULL) ON CONFLICT(id) DO UPDATE SET state=excluded.state,last_checked_at=excluded.last_checked_at,
    last_success_at=excluded.last_success_at,next_due_at=excluded.next_due_at,status='ok',error=NULL`)
    .bind(source.id, JSON.stringify(nextState), now, now, now + delay).run();
  return { message: `${source.id}: ${candidates.length} candidates`, checked: 0, published: 0 };
}

async function verify(DB, github, candidate, prior, now) {
  const key = candidate.repo.toLowerCase();
  if (excluded.has(key)) return { excluded: true };
  const metadata = await github.metadata(candidate, prior);
  if (!metadata) throw Object.assign(new Error("Repository is unavailable or no longer public"), { unavailable: true });
  if (metadata.empty) return { rejected: true, reason: "Repository has no commits yet" };
  const repo = metadata.repo, canonical = repo.toLowerCase();
  const stableId = Number.isSafeInteger(Number(metadata.id)) && Number(metadata.id) > 0 ? Number(metadata.id) : null;
  const identityRow = stableId ? await DB.prepare("SELECT repo,payload FROM catalog_entries WHERE github_id=?").bind(stableId).first() : null;
  const canonicalRow = !prior || key !== canonical ? await DB.prepare("SELECT payload FROM catalog_entries WHERE repo=?").bind(canonical).first() : null;
  const previous = [prior, canonicalRow ? JSON.parse(canonicalRow.payload) : null, identityRow ? JSON.parse(identityRow.payload) : null]
    .filter(item => item && (!stableId || !item.id || Number(item.id) === stableId));
  prior = previous.at(-1) || null;
  const previousRepos = [...new Set([key, canonical, identityRow?.repo].filter(Boolean))];
  const placeholders = previousRepos.map(() => "?").join(",");
  const blocked = await DB.prepare(`SELECT w.repo FROM catalog_withdrawals w WHERE w.repo IN (${placeholders})
    OR EXISTS (SELECT 1 FROM catalog_aliases a WHERE a.old_repo=w.repo AND a.new_repo IN (${placeholders}))`)
    .bind(...previousRepos, ...previousRepos).first();
  if (blocked || previousRepos.some(value => excluded.has(value))) return { excluded: true };
  const editorial = overrides.projects.find(p => p.repo.toLowerCase() === canonical);
  const project = {
    ...(prior || {}), ...metadata, ...(stableId ? { id: stableId } : {}),
    name: repo.split("/")[1], repo, author: repo.split("/")[0],
    desc: metadata.desc || cleanText(candidate.description || prior?.desc),
    cat: inferCategory(editorial || { ...(prior || {}), ...candidate }),
    stars: metadata.stars ?? candidate.stars ?? prior?.stars ?? 0,
    language: metadata.language || candidate.language || prior?.language || null,
    created: metadata.created || candidate.created || prior?.created || null,
    added: prior?.added || new Date(now * 1000).toISOString().slice(0, 10),
    pushed: metadata.pushed || candidate.pushed || prior?.pushed || null,
    provenance: [...new Set([...previous.flatMap(item => item.provenance || []), ...(candidate.provenance || [])])],
    freshness: metadata.metadataWarning ? "metadata-stale" : "current", evidenceCheckedAt: new Date(now * 1000).toISOString(),
    metadataCheckedAt: metadata.metadataWarning ? prior?.metadataCheckedAt || null : new Date(now * 1000).toISOString(),
  };
  let detail = prior?.commit === project.commit && prior.evidencePolicy === POLICY_VERSION ? prior.evidenceDetail : null;
  const approval = await DB.prepare(`SELECT evidence_url, relationship, category FROM submissions WHERE status='approved'
    AND (lower(url) IN (${placeholders}) OR lower(url) IN (SELECT 'https://github.com/' || old_repo FROM catalog_aliases WHERE new_repo IN (${placeholders}))) ORDER BY reviewed_at DESC LIMIT 1`)
    .bind(...previousRepos.map(value => "https://github.com/" + value), ...previousRepos).first();
  if (approval) {
    const parts = approval.evidence_url?.match(/\/blob\/([a-f0-9]{40})\/(.+?)(?:#.*)?$/i);
    if (parts && await github.exists(repo, parts[1], decodeURIComponent(parts[2]))) {
      detail = { level: "reviewed", relationship: approval.relationship, url: approval.evidence_url, commit: parts[1], path: parts[2], signal: "editor-reviewed", excerpt: "An editor reviewed this source reference. Runtime behavior has not been independently tested." };
      project.cat = approval.category; project.reviewed = true;
    } else throw new Error("Approved evidence is unavailable; editor review required");
  }
  const official = sourceConfig.officialRepos.some(value => value.toLowerCase() === canonical);
  if (official) detail = { level: "official", relationship: repo.endsWith("/skills") ? "resource" : "sdk", commit: project.commit,
    url: `https://github.com/${repo}/tree/${project.commit}`, signal: "official-owner", excerpt: "Published by TypeSafe's official GitHub organization." };
  if (!detail) detail = await inspectRepository(project, github, { codePaths: overrides.codePaths[canonical] || [], inspectCode: !!overrides.codePaths[canonical] });
  if (project.cat === "official" && !canonical.startsWith("typesafe-ai/")) project.cat = inferCategory({ repo, description: project.desc });
  if (!detail) return { rejected: true, reason: "No qualifying first-party usage evidence" };
  if (editorial?.relationship) detail = { ...detail, relationship: editorial.relationship };
  return { previousRepos, project: { ...project, relationship: detail.relationship, evidenceLevel: detail.level, evidencePolicy: POLICY_VERSION, evidence: detail.url, evidenceDetail: detail, verification: detail.level } };
}

async function saveProject(DB, project, oldRepo, now, previousRepos = []) {
  project = await attachProjectContent(DB, project, now);
  const key = project.repo.toLowerCase(), statements = [];
  statements.push(DB.prepare("DELETE FROM catalog_aliases WHERE old_repo=?").bind(key));
  const obsolete = [...new Set([oldRepo, ...previousRepos])].filter(value => value !== key);
  for (const previousRepo of obsolete) {
    statements.push(DB.prepare("UPDATE catalog_aliases SET new_repo=?,updated_at=? WHERE new_repo=?").bind(key, now, previousRepo));
    statements.push(DB.prepare("INSERT OR REPLACE INTO catalog_aliases VALUES(?,?,?)").bind(previousRepo, key, now));
    // Delete the old identity inside the same transaction before upserting the
    // canonical path, preserving the unique GitHub ID and editorial aliases.
    statements.push(DB.prepare("DELETE FROM catalog_entries WHERE repo=?").bind(previousRepo));
    statements.push(DB.prepare("DELETE FROM catalog_candidates WHERE repo=?").bind(previousRepo));
  }
  statements.push(DB.prepare(`INSERT INTO catalog_entries(repo,github_id,payload,preview,name,category,relationship,language,stars,created,active,checked_at,next_check_at,failures,last_error)
    VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,0,NULL) ON CONFLICT(repo) DO UPDATE SET github_id=excluded.github_id,payload=excluded.payload,
    preview=excluded.preview,name=excluded.name,category=excluded.category,relationship=excluded.relationship,language=excluded.language,
    stars=excluded.stars,created=excluded.created,active=1,checked_at=excluded.checked_at,next_check_at=excluded.next_check_at,failures=0,last_error=NULL`)
    .bind(key, project.id || null, JSON.stringify(project), JSON.stringify(publicPreview(project)), project.name, project.cat, project.relationship,
      project.language, project.stars, project.created, now, now + 86400));
  statements.push(DB.prepare("DELETE FROM catalog_candidates WHERE repo IN (?,?)").bind(oldRepo, key));
  await DB.batch(statements);
}

export async function tick(env, trigger = "manual") {
  const now = epoch(), DB = env.DB;
  const lease = await DB.prepare("UPDATE catalog_control SET lease_until=?,last_tick_at=?,last_scheduled_at=CASE WHEN ? IN ('scheduled','alarm') THEN ? ELSE last_scheduled_at END WHERE id=1 AND lease_until < ? RETURNING id,meta,published_at")
    .bind(now + 180, now, trigger, now, now).first();
  if (!lease) return { status: "busy" };
  const meta = JSON.parse(lease.meta || "{}");
  const runId = crypto.randomUUID(), github = new PublicGitHub(undefined, { core: meta.githubApiRetryAt, search: meta.githubSearchRetryAt });
  let result = { checked: 0, published: 0, changed: 0, message: "No work due" }, failed = null, revisionPending = !!meta.revisionPending;
  try {
    const states = await DB.prepare("SELECT * FROM catalog_sources").all();
    const due = catalogSources().find(source => {
      if (source.type === "search" && github.retryAt.search > now) return false;
      const state = states.results.find(item => item.id === source.id);
      return !(state?.next_due_at > now) || (source.type === "search" && JSON.parse(state?.state || "{}").query !== source.query);
    });
    let found = "";
    if (due) {
      const state = states.results.find(s => s.id === due.id);
      // A source failure is recorded on the source; the queue still gets its turn.
      try { found = (await discover(DB, github, due, state ? JSON.parse(state.state) : {}, now)).message + "; "; }
      catch (error) {
        await DB.prepare(`INSERT INTO catalog_sources(id,last_checked_at,next_due_at,status,error) VALUES(?,?,?,'failed',?)
          ON CONFLICT(id) DO UPDATE SET last_checked_at=excluded.last_checked_at,next_due_at=excluded.next_due_at,status='failed',error=excluded.error`)
          .bind(due.id, now, error.rateLimited ? error.retryAt : Math.max(now + 3600, error.retryAt || 0), error.message).run();
        failed = error.message;
      }
    }
    const size = Math.max(1, Math.min(5, Number(env.VERIFY_BATCH_SIZE) || 3)), slots = Math.max(1, size - 1), work = [];
    const take = async (limit, where, ...args) => {
      if (work.length >= slots) return;
      const rows = await DB.prepare(`SELECT repo,payload,attempts FROM catalog_candidates ${where} LIMIT ?`).bind(...args, limit).all();
      for (const row of rows.results) if (work.length < slots && !work.some(item => item.repo === row.repo)) work.push(row);
    };
    // Priority 2 holds repositories that need the core API. They get one slot
    // while it has quota, which is about what the anonymous hourly limit allows.
    if (!(github.retryAt.core > now)) await take(1, "WHERE priority=2 AND due_at<=? ORDER BY due_at", now);
    // Curated and editor-approved repositories have no search date. Next come
    // recent repositories with enough stars for the launch board, which would
    // otherwise wait behind everything unstarred from the same week. Then the
    // newest repositories, however long the older backlog is.
    const recent = shiftDay(new Date(now * 1000).toISOString().slice(0, 10), -FRESH_LOOKBACK_DAYS);
    await take(slots, `INDEXED BY idx_catalog_candidate_created WHERE priority=0 AND ${CANDIDATE_CREATED} IS NULL AND due_at<=?`, now);
    await take(slots, `INDEXED BY idx_catalog_candidate_notable WHERE ${CANDIDATE_NOTABLE} AND ${CANDIDATE_CREATED}>=? AND due_at<=? ORDER BY ${CANDIDATE_CREATED} DESC`, recent, now);
    await take(slots, `INDEXED BY idx_catalog_candidate_created WHERE priority=0 AND ${CANDIDATE_CREATED}>=? AND due_at<=? ORDER BY ${CANDIDATE_CREATED} DESC`, recent, now);
    await take(slots, "WHERE priority=0 AND due_at<=? ORDER BY due_at", now);
    await take(slots, "WHERE priority=1 AND due_at<=? ORDER BY due_at", now);
    if (work.length < size) {
      const known = await DB.prepare("SELECT repo,payload FROM catalog_entries WHERE next_check_at <= ? ORDER BY next_check_at,repo LIMIT ?").bind(now, size).all();
      for (const row of known.results) if (!work.some(item => item.repo === row.repo) && work.length < size) work.push(row);
    }
    let waiting = 0;
    for (const item of work) {
      const priorRow = await DB.prepare("SELECT payload,failures,active FROM catalog_entries WHERE repo=?").bind(item.repo).first();
      const prior = priorRow ? JSON.parse(priorRow.payload) : null;
      try {
        const checked = await verify(DB, github, JSON.parse(item.payload), prior, now);
        if (checked.project) { await saveProject(DB, checked.project, item.repo, now, checked.previousRepos); result.published++; result.changed++; }
        else {
          if (checked.rejected && priorRow?.active && !await removalAllowed(DB)) throw new Error("Large catalog decline paused for editor review");
          await DB.batch([
            DB.prepare("UPDATE catalog_entries SET active=0,last_error=?,next_check_at=? WHERE repo=?").bind(checked.reason || "Editor exclusion", now + 86400, item.repo),
            checked.rejected
              ? DB.prepare("UPDATE catalog_candidates SET due_at=?,last_error=?,attempts=attempts+1,priority=CASE WHEN priority=2 THEN 0 ELSE priority END WHERE repo=?").bind(now + 7 * 86400, checked.reason, item.repo)
              : DB.prepare("DELETE FROM catalog_candidates WHERE repo=?").bind(item.repo),
          ]);
          if (priorRow?.active) result.changed++;
        }
        result.checked++;
      } catch (error) {
        // Nothing has been learned about this repository: the next tick starts
        // it again with a full budget.
        if (error.budget) break;
        // The quota ran out, not the repository: no failure, no stale label.
        if (error.rateLimited) {
          await DB.batch([
            DB.prepare("UPDATE catalog_entries SET last_error=?,next_check_at=? WHERE repo=?").bind(error.message, error.retryAt, item.repo),
            DB.prepare("UPDATE catalog_candidates SET priority=2,last_error=?,due_at=? WHERE repo=?").bind(error.message, error.retryAt, item.repo),
          ]);
          waiting++;
          continue;
        }
        const failures = (priorRow?.failures || 0) + 1;
        const retryAt = Math.max(now + Math.min(86400, 900 * 2 ** Math.min(Math.max(failures, (item.attempts || 0) + 1), 5)), error.retryAt || 0);
        const deactivate = error.unavailable && failures >= 2 && (!priorRow?.active || await removalAllowed(DB));
        await DB.batch([
          DB.prepare("UPDATE catalog_entries SET failures=?,last_error=?,next_check_at=?,payload=json_set(payload,'$.freshness','stale'),preview=json_set(preview,'$.freshness','stale'),active=CASE WHEN ? THEN 0 ELSE active END WHERE repo=?")
            .bind(failures, error.message, retryAt, deactivate ? 1 : 0, item.repo),
          DB.prepare("UPDATE catalog_candidates SET attempts=attempts+1,last_error=?,due_at=? WHERE repo=?").bind(error.message, retryAt, item.repo),
        ]);
        if (priorRow?.active && (prior?.freshness !== "stale" || deactivate)) result.changed++;
        failed = error.message;
      }
    }
    result.message = `${found}Checked ${result.checked}; refreshed ${result.published}; ${github.requests} public requests${waiting ? `; waiting for API quota: ${waiting}` : ""}`;
    // Moving the revision invalidates the catalog API's edge cache and the
    // snapshot, so changes are published in groups rather than on every tick.
    if (result.changed) revisionPending = true;
    if (revisionPending && now - lease.published_at >= REVISION_INTERVAL) {
      await DB.prepare("UPDATE catalog_control SET revision=?,published_at=? WHERE id=1").bind(crypto.randomUUID(), now).run();
      revisionPending = false;
    }
    if (!failed) await DB.prepare("UPDATE catalog_control SET last_success_at=?,last_error=NULL WHERE id=1").bind(now).run();
  } catch (error) { failed = error.message; }
  finally {
    await DB.batch([
      DB.prepare("UPDATE catalog_control SET lease_until=0,last_error=?,meta=json_set(meta,'$.githubApiRetryAt',?,'$.githubSearchRetryAt',?,'$.revisionPending',?) WHERE id=1")
        .bind(failed, github.retryAt.core, github.retryAt.search, revisionPending ? 1 : 0),
      DB.prepare("INSERT INTO catalog_runs(id,started_at,finished_at,status,checked,published,message) VALUES(?,?,?,?,?,?,?)")
        .bind(runId, now, epoch(), failed ? "degraded" : "ok", result.checked, result.published, failed || result.message),
      DB.prepare("DELETE FROM catalog_runs WHERE started_at < ?").bind(now - 7 * 86400),
    ]);
  }
  return { status: failed ? "degraded" : "ok", ...result, error: failed };
}
