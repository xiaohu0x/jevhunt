import { activeClause, CATEGORY_IDS } from "../shared/catalog-data.js";
import { ORIGIN, projectPath, esc } from "../shared/render.js";
import { LOCALES } from "../shared/locales.js";
import { EDITORIAL_ROUTES } from "../shared/editorial-routes.js";
export async function onRequestGet({ env }) {
  const rows = await env.DB.prepare(`SELECT catalog_entries.repo,catalog_entries.category,checked_at,c.reviewed_at AS content_reviewed_at
    FROM catalog_entries LEFT JOIN project_content c ON c.repo=catalog_entries.repo AND c.github_id=catalog_entries.github_id
    WHERE ${activeClause} ORDER BY catalog_entries.repo`).all();
  const localePaths = Object.values(LOCALES).map(locale => locale.path);
  const alternates = Object.values(LOCALES).map(locale => `<xhtml:link rel="alternate" hreflang="${locale.hreflang}" href="${ORIGIN}${locale.path}"/>`).join("") +
    `<xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/"/>`;
  const staticPaths = [...localePaths, "/privacy/", "/terms/", "/security/", "/methodology/", "/status/"];
  const urls = staticPaths.map(path => `<url><loc>${ORIGIN}${path}</loc>${localePaths.includes(path) ? alternates : ""}</url>`);
  for (const { path, modified } of EDITORIAL_ROUTES) urls.push(`<url><loc>${ORIGIN}${esc(path)}</loc><lastmod>${esc(modified)}</lastmod></url>`);
  const counts = Object.fromEntries(CATEGORY_IDS.map(id => [id, 0]));
  for (const row of rows.results) {
    counts[row.category] = (counts[row.category] || 0) + 1;
    const modified = row.content_reviewed_at || new Date(row.checked_at * 1000).toISOString().slice(0, 10);
    urls.push(`<url><loc>${ORIGIN}${esc(projectPath(row.repo))}</loc><lastmod>${esc(modified)}</lastmod></url>`);
    if (row.content_reviewed_at) for (const [locale, info] of Object.entries(LOCALES)) {
      if (locale !== "en") urls.push(`<url><loc>${ORIGIN}${esc(projectPath(row.repo, info.path.slice(0, -1)))}</loc><lastmod>${esc(modified)}</lastmod></url>`);
    }
  }
  for (const [base, count] of [["/browse/", rows.results.length], ...Object.entries(counts).map(([id, count]) => [`/categories/${id}/`, count])]) {
    for (let page = 1; page <= Math.max(1, Math.ceil(count / 24)); page++) urls.push(`<url><loc>${ORIGIN}${base}${page === 1 ? "" : page + "/"}</loc></url>`);
  }
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join("")}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
