import { esc, ORIGIN, projectPath } from "./render.js";

/** RSS 2.0 feed for newly catalogued projects. */
export function rssFeed(projects, { origin = ORIGIN, limit = 20 } = {}) {
  const items = projects.slice(0, limit).map(project => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(project.added || "") ? project.added : /^\d{4}-\d{2}-\d{2}$/.test(project.pushed || "") ? project.pushed : "";
    const pubDate = date ? new Date(date + "T12:00:00Z").toUTCString() : new Date().toUTCString();
    const link = origin + projectPath(project.repo);
    return `<item><title>${esc(project.name)}</title><link>${esc(link)}</link><guid isPermaLink="true">${esc(link)}</guid><pubDate>${esc(pubDate)}</pubDate><description>${esc(project.desc || "A Jev project listed on JevHunt.")}</description><category>${esc(project.cat || "projects")}</category></item>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>JevHunt — new Jev projects</title><link>${origin}/</link><description>New and recently verified projects in the Jev ecosystem, with source evidence.</description><language>en</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}</channel></rss>`;
}
