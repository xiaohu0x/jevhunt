import { activeClause, CATEGORY_IDS } from "../shared/catalog-data.js";
import { ORIGIN, projectPath, esc } from "../shared/render.js";
export async function onRequestGet({ env }) {
  const rows = await env.DB.prepare(`SELECT repo,category,checked_at FROM catalog_entries WHERE ${activeClause} ORDER BY repo`).all();
  const localePaths = ["/", "/zh-cn/", "/zh-tw/", "/ja/", "/ko/", "/es/", "/fr/", "/de/", "/pt-br/"];
  const staticPaths = [...localePaths, "/privacy/", "/terms/", "/security/", "/methodology/", "/status/"];
  const urls = staticPaths.map(path => `<url><loc>${ORIGIN}${path}</loc></url>`);
  const counts = Object.fromEntries(CATEGORY_IDS.map(id => [id, 0]));
  for (const row of rows.results) {
    counts[row.category] = (counts[row.category] || 0) + 1;
    urls.push(`<url><loc>${ORIGIN}${esc(projectPath(row.repo))}</loc><lastmod>${new Date(row.checked_at * 1000).toISOString().slice(0, 10)}</lastmod></url>`);
  }
  for (const [base, count] of [["/browse/", rows.results.length], ...Object.entries(counts).map(([id, count]) => [`/categories/${id}/`, count])]) {
    for (let page = 1; page <= Math.max(1, Math.ceil(count / 24)); page++) urls.push(`<url><loc>${ORIGIN}${base}${page === 1 ? "" : page + "/"}</loc></url>`);
  }
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
