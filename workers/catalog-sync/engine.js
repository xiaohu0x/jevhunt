import sourceConfig from "../../catalog/sources.json" with { type: "json" };
import overrides from "../../catalog/overrides.json" with { type: "json" };
import { inspectRepository, POLICY_VERSION } from "../../shared/catalog-policy.js";
import { validRepo, publicPreview, inferCategory, cleanText } from "../../shared/catalog-data.js";
import { PublicGitHub } from "./github-public.js";

const epoch = () => Math.floor(Date.now() / 1000);
const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const excluded = new Set(overrides.excluded.map(value => (typeof value === "string" ? value : value.repo).toLowerCase()));
const sourceCategories = { "client-libraries-and-integrations": "integrations", "agent-and-developer-tooling": "agents", "browser-agents": "browser", "applications-and-workflows": "apps", "games-and-robotics": "games", "evaluations-and-independent-research": "research", "showcases-and-field-notes": "demos" };

async function removalAllowed(DB) {
  const row = await DB.prepare(`SELECT (SELECT COUNT(*) FROM catalog_entries WHERE active=1) AS n,
    json_extract(meta,'$.automaticRemovalFloor') AS floor FROM catalog_control WHERE id=1`).first();
  return row.n > (row.floor || 100);
}

async function enqueue(DB, candidates, now) {
  const data = candidates.filter(p => validRepo(p.repo) && !excluded.has(p.repo.toLowerCase())).map(p => ({ ...p, repo: p.repo.toLowerCase() }));
  if (!data.length) return;
  // JSON expansion happens inside D1: one statement, not thousands of calls.
  await DB.prepare(`INSERT INTO catalog_candidates (repo, payload, priority, due_at)
    SELECT json_extract(value, '$.repo'), value,
      CASE WHEN EXISTS (SELECT 1 FROM catalog_entries e WHERE e.repo = json_extract(value, '$.repo')) THEN 1 ELSE 0 END, ?
    FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM catalog_withdrawals w WHERE w.repo = json_extract(value, '$.repo'))
      AND (NOT EXISTS (SELECT 1 FROM catalog_entries e WHERE e.repo=json_extract(value,'$.repo'))
        OR EXISTS (SELECT 1 FROM catalog_entries e WHERE e.repo=json_extract(value,'$.repo')
          AND json_extract(value,'$.pushed') > COALESCE(json_extract(e.payload,'$.pushed'),'') AND e.checked_at < ?))
    ON CONFLICT(repo) DO UPDATE SET payload = excluded.payload,
      due_at = CASE WHEN json_extract(excluded.payload,'$.pushed') > COALESCE(json_extract(catalog_candidates.payload,'$.pushed'),'')
        THEN MIN(catalog_candidates.due_at, excluded.due_at) ELSE catalog_candidates.due_at END`).bind(now, JSON.stringify(data), now - 3600).run();
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
    const windows = state.windows?.length ? state.windows : [{ from: "2008-01-01", to: new Date().toISOString().slice(0, 10), page: 1 }];
    const window = windows[0];
    const q = `${source.query} is:public created:${window.from}..${window.to}`;
    const result = await github.api(`/search/repositories?q=${encodeURIComponent(q)}&per_page=100&page=${window.page}`);
    if (!Array.isArray(result?.items)) throw new Error("Invalid search result");
    let partial = state.partial || result.incomplete_results;
    if (result.total_count > 1000 && window.from !== window.to) {
      const left = Date.parse(window.from), right = Date.parse(window.to);
      const mid = new Date(left + Math.floor((right - left) / 172800000) * 86400000).toISOString().slice(0, 10);
      const after = new Date(Date.parse(mid) + 86400000).toISOString().slice(0, 10);
      windows.splice(0, 1, { from: window.from, to: mid, page: 1 }, { from: after, to: window.to, page: 1 });
    } else {
      candidates = result.items.filter(p => !p.private).map(p => ({ repo: p.full_name, description: p.description, language: p.language, stars: p.stargazers_count, pushed: p.pushed_at?.slice(0,10), created: p.created_at?.slice(0,10), provenance: ["github-search"] }));
      if (result.total_count > 1000) partial = true;
      if (window.page < Math.min(10, Math.ceil(result.total_count / 100))) window.page++;
      else windows.shift();
    }
    nextState = { windows, partial: !!partial, lastCompleteAt: windows.length ? state.lastCompleteAt || null : now, lastPageAt: now };
    delay = windows.length ? 20 * 60 : 6 * 3600;
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
  const repo = metadata.repo, canonical = repo.toLowerCase();
  const blocked = await DB.prepare("SELECT w.repo FROM catalog_withdrawals w WHERE w.repo IN (?, ?) OR EXISTS (SELECT 1 FROM catalog_aliases a WHERE a.old_repo=w.repo AND a.new_repo=?)").bind(key, canonical, canonical).first();
  if (blocked) return { excluded: true };
  if (!prior && key !== canonical) {
    const canonicalRow = await DB.prepare("SELECT payload FROM catalog_entries WHERE repo=?").bind(canonical).first();
    if (canonicalRow) prior = JSON.parse(canonicalRow.payload);
  }
  const editorial = overrides.projects.find(p => p.repo.toLowerCase() === canonical);
  const project = {
    ...(prior || {}), ...metadata,
    name: repo.split("/")[1], repo, author: repo.split("/")[0],
    desc: metadata.desc || cleanText(candidate.description || prior?.desc),
    cat: inferCategory(editorial || candidate || prior),
    stars: metadata.stars ?? candidate.stars ?? prior?.stars ?? 0,
    language: metadata.language || candidate.language || prior?.language || null,
    created: metadata.created || candidate.created || prior?.created || null,
    added: prior?.added || new Date(now * 1000).toISOString().slice(0, 10),
    pushed: candidate.pushed || prior?.pushed || null,
    provenance: [...new Set([...(prior?.provenance || []), ...(candidate.provenance || [])])],
    freshness: metadata.metadataWarning ? "metadata-stale" : "current", evidenceCheckedAt: new Date(now * 1000).toISOString(),
    metadataCheckedAt: metadata.metadataWarning ? prior?.metadataCheckedAt || null : new Date(now * 1000).toISOString(),
  };
  let detail = prior?.commit === project.commit && prior.evidencePolicy === POLICY_VERSION ? prior.evidenceDetail : null;
  const approval = await DB.prepare("SELECT evidence_url, relationship, category FROM submissions WHERE status='approved' AND (lower(url) IN (?,?) OR lower(url) IN (SELECT 'https://github.com/' || old_repo FROM catalog_aliases WHERE new_repo=?)) ORDER BY reviewed_at DESC LIMIT 1")
    .bind("https://github.com/" + canonical, "https://github.com/" + key, canonical).first();
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
  return { project: { ...project, relationship: detail.relationship, evidenceLevel: detail.level, evidencePolicy: POLICY_VERSION, evidence: detail.url, evidenceDetail: detail, verification: detail.level } };
}

async function saveProject(DB, project, oldRepo, now) {
  const key = project.repo.toLowerCase(), statements = [];
  statements.push(DB.prepare("DELETE FROM catalog_aliases WHERE old_repo=?").bind(key));
  if (oldRepo !== key) {
    statements.push(DB.prepare("UPDATE catalog_aliases SET new_repo=?,updated_at=? WHERE new_repo=?").bind(key, now, oldRepo));
    statements.push(DB.prepare("INSERT OR REPLACE INTO catalog_aliases VALUES(?,?,?)").bind(oldRepo, key, now));
    statements.push(DB.prepare("DELETE FROM catalog_entries WHERE repo=?").bind(oldRepo));
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
  const lease = await DB.prepare("UPDATE catalog_control SET lease_until=?,last_tick_at=?,last_scheduled_at=CASE WHEN ? IN ('scheduled','alarm') THEN ? ELSE last_scheduled_at END WHERE id=1 AND lease_until < ? RETURNING id")
    .bind(now + 180, now, trigger, now, now).first();
  if (!lease) return { status: "busy" };
  const runId = crypto.randomUUID(), github = new PublicGitHub();
  let result = { checked: 0, published: 0, changed: 0, message: "No work due" }, failed = null;
  try {
    const sources = [...sourceConfig.sources, ...sourceConfig.githubQueries.map((query, i) => ({ id: `github-search-${i}`, query, type: "search" }))];
    const states = await DB.prepare("SELECT * FROM catalog_sources").all();
    const due = sources.find(source => !(states.results.find(s => s.id === source.id)?.next_due_at > now));
    if (due) {
      const state = states.results.find(s => s.id === due.id);
      try { result = await discover(DB, github, due, state ? JSON.parse(state.state) : {}, now); }
      catch (error) {
        await DB.prepare(`INSERT INTO catalog_sources(id,last_checked_at,next_due_at,status,error) VALUES(?,?,?,'failed',?)
          ON CONFLICT(id) DO UPDATE SET last_checked_at=excluded.last_checked_at,next_due_at=excluded.next_due_at,status='failed',error=excluded.error`)
          .bind(due.id, now, Math.max(now + 3600, error.retryAt || 0), error.message).run();
        throw error;
      }
    } else {
      const size = Math.max(1, Math.min(5, Number(env.VERIFY_BATCH_SIZE) || 3));
      const queued = await DB.prepare("SELECT repo,payload FROM catalog_candidates WHERE due_at <= ? ORDER BY priority,due_at,repo LIMIT ?").bind(now, Math.max(1, size - 1)).all();
      const work = [...queued.results];
      if (work.length < size) {
        const known = await DB.prepare("SELECT repo,payload FROM catalog_entries WHERE next_check_at <= ? ORDER BY next_check_at,repo LIMIT ?").bind(now, size).all();
        for (const row of known.results) if (!work.some(item => item.repo === row.repo) && work.length < size) work.push(row);
      }
      for (const item of work) {
        const priorRow = await DB.prepare("SELECT payload,failures,active FROM catalog_entries WHERE repo=?").bind(item.repo).first();
        const prior = priorRow ? JSON.parse(priorRow.payload) : null;
        try {
          const checked = await verify(DB, github, JSON.parse(item.payload), prior, now);
          if (checked.project) { await saveProject(DB, checked.project, item.repo, now); result.published++; result.changed++; }
          else {
            if (checked.rejected && priorRow?.active && !await removalAllowed(DB)) throw new Error("Large catalog decline paused for editor review");
            await DB.batch([
              DB.prepare("UPDATE catalog_entries SET active=0,last_error=?,next_check_at=? WHERE repo=?").bind(checked.reason || "Editor exclusion", now + 86400, item.repo),
              checked.rejected
                ? DB.prepare("UPDATE catalog_candidates SET due_at=?,last_error=?,attempts=attempts+1 WHERE repo=?").bind(now + 7 * 86400, checked.reason, item.repo)
                : DB.prepare("DELETE FROM catalog_candidates WHERE repo=?").bind(item.repo),
            ]);
            if (priorRow?.active) result.changed++;
          }
          result.checked++;
        } catch (error) {
          const failures = (priorRow?.failures || 0) + 1;
          const retryAt = Math.max(now + Math.min(86400, 900 * 2 ** Math.min(failures, 5)), error.retryAt || 0);
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
      result.message = `Checked ${result.checked}; refreshed ${result.published}; ${github.requests} public requests`;
    }
    if (result.changed) await DB.prepare("UPDATE catalog_control SET revision=?,published_at=? WHERE id=1").bind(crypto.randomUUID(), now).run();
    if (!failed) await DB.prepare("UPDATE catalog_control SET last_success_at=?,last_error=NULL WHERE id=1").bind(now).run();
  } catch (error) { failed = error.message; }
  finally {
    await DB.batch([
      DB.prepare("UPDATE catalog_control SET lease_until=0,last_error=? WHERE id=1").bind(failed),
      DB.prepare("INSERT INTO catalog_runs(id,started_at,finished_at,status,checked,published,message) VALUES(?,?,?,?,?,?,?)")
        .bind(runId, now, epoch(), failed ? "degraded" : "ok", result.checked, result.published, failed || result.message),
      DB.prepare("DELETE FROM catalog_runs WHERE started_at < ?").bind(now - 7 * 86400),
    ]);
  }
  return { status: failed ? "degraded" : "ok", ...result, error: failed };
}
