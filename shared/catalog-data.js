export const CATEGORY_IDS = ["official", "sdks", "integrations", "agents", "browser", "apps", "games", "demos", "research", "lists"];
export const CATEGORY_NAMES = ["Official", "SDKs & Clients", "Integrations", "Agent Tooling", "Browser & Computer Use", "Applications", "Games & Simulations", "Demos & Playgrounds", "Benchmarks & Research", "Directories & Lists"];
export const PREVIEW_FIELDS = ["id", "name", "repo", "desc", "cat", "language", "stars", "created", "added", "pushed", "archived", "fork", "relationship", "evidenceLevel", "evidence", "freshness"];
export const publicPreview = project => ({ ...Object.fromEntries(PREVIEW_FIELDS.map(key => [key, project[key] ?? null])), desc: project.content?.summary ?? project.desc ?? null });
export const validRepo = value => typeof value === "string" && /^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(value) && value.length <= 160;
export const cleanText = (value, max = 600) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export function inferCategory(project) {
  if (CATEGORY_IDS.includes(project.cat || project.category)) return project.cat || project.category;
  const text = `${project.repo} ${project.description || project.desc || ""}`;
  if (/awesome|directory|curated list/i.test(text)) return "lists";
  if (/benchmark|eval|replica|alternative|reconstruction/i.test(text)) return "research";
  if (/sdk|client library/i.test(text)) return "sdks";
  if (/browser|computer.use|desktop/i.test(text)) return "browser";
  if (/game|mario|minecraft|drone|simulation/i.test(text)) return "games";
  if (/plugin|mcp|agent|router|context|skill/i.test(text)) return "agents";
  return "apps";
}
// Hidden rows are withdrawn repos plus the destinations of retired aliases. Two
// separate NOT EXISTS clauses keep each lookup indexable: the single OR form let
// the planner fall back to scanning catalog_withdrawals for every row.
export const activeClause = "active = 1 AND NOT EXISTS (SELECT 1 FROM catalog_withdrawals w WHERE w.repo = catalog_entries.repo) AND NOT EXISTS (SELECT 1 FROM catalog_withdrawals w JOIN catalog_aliases a ON a.old_repo = w.repo WHERE a.new_repo = catalog_entries.repo)";

const RECENT_PUSHED_SQL = `SELECT preview FROM catalog_entries WHERE ${activeClause} AND json_extract(payload,'$.archived') = 0 AND json_extract(payload,'$.pushed') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(json_extract(payload,'$.pushed'), '+0 days') = json_extract(payload,'$.pushed') ORDER BY json_extract(payload,'$.pushed') DESC, stars DESC LIMIT 40`;

/**
 * Recompute the materialised snapshot. Only run when the publish revision has
 * moved on (or the snapshot table does not exist yet), so the aggregate scans
 * that used to run on every request now run once per publish.
 */
async function refreshSnapshot(DB, revision) {
  const [groups, languages, recent] = await DB.batch([
    DB.prepare(`SELECT category, COUNT(*) AS n, SUM(stars) AS stars FROM catalog_entries WHERE ${activeClause} GROUP BY category`),
    DB.prepare(`SELECT DISTINCT COALESCE(language, 'unknown') AS language FROM catalog_entries WHERE ${activeClause} ORDER BY language`),
    DB.prepare(RECENT_PUSHED_SQL),
  ]);
  const snapshot = {
    revision,
    categoryRows: groups.results,
    languages: languages.results.map(row => row.language),
    recentlyPushed: recent.results.map(row => row.preview),
  };
  // Best effort: without the snapshot table the reads above still serve the request.
  await DB.prepare("INSERT INTO catalog_snapshot(id,revision,payload,computed_at) VALUES(1,?,?,unixepoch()) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,computed_at=excluded.computed_at")
    .bind(revision, JSON.stringify(snapshot)).run().catch(() => {});
  return snapshot;
}

async function loadSnapshot(DB, revision) {
  const row = await DB.prepare("SELECT revision, payload FROM catalog_snapshot WHERE id = 1").first().catch(() => null);
  if (row && row.revision === revision) {
    try {
      const snapshot = JSON.parse(row.payload);
      if (Array.isArray(snapshot.categoryRows) && Array.isArray(snapshot.languages) && Array.isArray(snapshot.recentlyPushed)) return snapshot;
    } catch { /* fall through and recompute */ }
  }
  return refreshSnapshot(DB, revision);
}

/** Recently-pushed active projects, newest first, parsed from the snapshot. */
export async function catalogRecentPushed(DB) {
  const control = await DB.prepare("SELECT revision FROM catalog_control WHERE id = 1").first();
  if (!control) return [];
  const snapshot = await loadSnapshot(DB, control.revision);
  return snapshot.recentlyPushed.map(data => JSON.parse(data));
}

export async function catalogMeta(DB) {
  const control = await DB.prepare("SELECT * FROM catalog_control WHERE id = 1").first();
  if (!control) return null;
  let previous = {};
  try { previous = JSON.parse(control.meta); } catch { /* empty bootstrap */ }
  const snapshot = await loadSnapshot(DB, control.revision);
  const groups = snapshot.categoryRows;
  if (!groups.length) return null;
  const sources = await DB.prepare("SELECT id,state,status,last_success_at,last_checked_at,error FROM catalog_sources ORDER BY id").all();
  return {
    ...previous,
    projectCount: groups.reduce((n, row) => n + row.n, 0),
    totalStars: groups.reduce((n, row) => n + (row.stars || 0), 0),
    categoryCounts: Object.fromEntries(groups.map(row => [row.category, row.n])),
    languages: snapshot.languages,
    catalogHash: control.revision,
    syncedAt: new Date(control.published_at * 1000).toISOString(),
    publishedAt: new Date(control.published_at * 1000).toISOString(),
    lastTickAt: control.last_tick_at ? new Date(control.last_tick_at * 1000).toISOString() : null,
    lastScheduledAt: control.last_scheduled_at ? new Date(control.last_scheduled_at * 1000).toISOString() : null,
    lastCronAt: previous.lastCronWakeAt || null,
    lastRunAt: control.last_success_at ? new Date(control.last_success_at * 1000).toISOString() : null,
    sources: sources.results.map(source => ({ id: source.id, status: source.status,
      lastCheckedAt: source.last_checked_at ? new Date(source.last_checked_at * 1000).toISOString() : null,
      lastSuccessAt: source.last_success_at ? new Date(source.last_success_at * 1000).toISOString() : null,
      ...JSON.parse(source.state), error: source.error })),
    mode: "live-d1",
  };
}
export async function catalogRows(DB, { category, limit = 20, offset = 0, full = false } = {}) {
  const where = activeClause + (category ? " AND category = ?" : "");
  const args = category ? [category] : [];
  const result = await DB.prepare(`SELECT ${full ? "payload" : "preview"} AS data FROM catalog_entries WHERE ${where} ORDER BY stars DESC, created DESC, name COLLATE NOCASE LIMIT ? OFFSET ?`)
    .bind(...args, limit, offset).all();
  return result.results;
}
