export const CATEGORY_IDS = ["official", "sdks", "integrations", "agents", "browser", "apps", "games", "demos", "research", "lists"];
export const CATEGORY_NAMES = ["Official", "SDKs & Clients", "Integrations", "Agent Tooling", "Browser & Computer Use", "Applications", "Games & Simulations", "Demos & Playgrounds", "Benchmarks & Research", "Directories & Lists"];
export const PREVIEW_FIELDS = ["name", "repo", "desc", "cat", "language", "stars", "created", "added", "pushed", "archived", "fork", "relationship", "evidenceLevel", "evidence", "freshness"];
export const publicPreview = project => Object.fromEntries(PREVIEW_FIELDS.map(key => [key, project[key] ?? null]));
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
export const activeClause = "active = 1 AND NOT EXISTS (SELECT 1 FROM catalog_withdrawals w WHERE w.repo = catalog_entries.repo OR EXISTS (SELECT 1 FROM catalog_aliases a WHERE a.old_repo=w.repo AND a.new_repo=catalog_entries.repo))";
export async function catalogMeta(DB) {
  const [state, groups, languages, sources] = await DB.batch([
    DB.prepare("SELECT * FROM catalog_control WHERE id = 1"),
    DB.prepare(`SELECT category, COUNT(*) AS n, SUM(stars) AS stars FROM catalog_entries WHERE ${activeClause} GROUP BY category`),
    DB.prepare(`SELECT DISTINCT COALESCE(language, 'unknown') AS language FROM catalog_entries WHERE ${activeClause} ORDER BY language`),
    DB.prepare("SELECT id,state,status,last_success_at,last_checked_at,error FROM catalog_sources ORDER BY id"),
  ]);
  const control = state.results[0];
  if (!control || !groups.results.length) return null;
  let previous = {};
  try { previous = JSON.parse(control.meta); } catch { /* empty bootstrap */ }
  return {
    ...previous,
    projectCount: groups.results.reduce((n, row) => n + row.n, 0),
    totalStars: groups.results.reduce((n, row) => n + (row.stars || 0), 0),
    categoryCounts: Object.fromEntries(groups.results.map(row => [row.category, row.n])),
    languages: languages.results.map(row => row.language),
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
