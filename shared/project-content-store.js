import { matchingProjectContent, applyProjectContent } from "./project-content.js";

export async function readProjectContent(DB, project) {
  const row = await DB.prepare("SELECT payload FROM project_content WHERE repo=? AND github_id=?")
    .bind(project.repo.toLowerCase(), Number(project.id) || 0).first();
  if (!row) return null;
  try {
    const content = JSON.parse(row.payload);
    return matchingProjectContent(project, content) ? content : null;
  } catch { return null; }
}

export async function attachProjectContent(DB, project, now = Math.floor(Date.now() / 1000)) {
  const content = await readProjectContent(DB, project);
  const enriched = applyProjectContent(project, content);
  const reason = !content ? "content-missing" : enriched.content.sourceChanged ? "source-changed" : null;
  if (reason) {
    await DB.prepare(`INSERT INTO project_content_queue(repo,github_id,source_commit,reason,state,queued_at,updated_at)
      VALUES(?,?,?,?,'pending',?,?) ON CONFLICT(repo) DO UPDATE SET github_id=excluded.github_id,
      source_commit=excluded.source_commit,reason=excluded.reason,state='pending',updated_at=excluded.updated_at
      WHERE project_content_queue.source_commit IS NOT excluded.source_commit OR project_content_queue.state='published'`)
      .bind(project.repo.toLowerCase(), project.id || null, project.commit || null, reason, now, now).run();
  }
  return enriched;
}

// Locale text is joined only for a requested page/index. Full catalog exports
// retain source descriptions and compact content metadata, not every translation.
export async function localizeCatalogProjects(DB, projects, locale = "en") {
  if (!projects.length) return projects;
  const rows = await DB.prepare(`SELECT l.repo,l.summary FROM project_content_locales l
    JOIN project_content c ON c.repo=l.repo AND c.content_hash=l.content_hash
    JOIN catalog_entries ON catalog_entries.repo=c.repo AND catalog_entries.github_id=c.github_id
    WHERE l.locale=? AND l.repo IN (SELECT value FROM json_each(?))`)
    .bind(locale, JSON.stringify(projects.map(project => project.repo.toLowerCase()))).all();
  const summaries = new Map(rows.results.map(row => [row.repo, row.summary]));
  return projects.map(project => summaries.has(project.repo.toLowerCase()) ? { ...project, desc: summaries.get(project.repo.toLowerCase()) } : project);
}
