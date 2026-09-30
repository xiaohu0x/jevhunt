import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { loadData, esc, page, ORIGIN, projectPath } from "./lib/site.mjs";
import { renderProject, renderListing } from "../shared/catalog-view.js";
import { duplicateProjectNames, projectNameKey } from "../shared/project-seo.js";

const { apps, categories, catalogMeta: meta, i18n } = loadData();
const catalog = JSON.parse(readFileSync("public/catalog.json", "utf8"));
const projects = [...catalog.apps].sort((a, b) => b.stars - a.stars || (b.created || "").localeCompare(a.created || "") || a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.repo.localeCompare(b.repo));
const duplicateNames = duplicateProjectNames(projects);
const messages = i18n.locales.en.messages;
const discoveryConfig = JSON.parse(readFileSync("catalog/sources.json", "utf8"));
const discoverySources = [
  ...discoveryConfig.githubQueries.map(query => ({ id: "GitHub repository search", query, url: `https://github.com/search?type=repositories&q=${encodeURIComponent(query)}` })),
  ...discoveryConfig.sources.map(source => ({ id: source.id, url: source.homepage })),
  { id: "Official TypeSafe repositories", url: "https://github.com/typesafe-ai" },
  { id: "Approved editorial submissions", url: "/#submit" },
];
const paths = [];
// Only generated outputs are replaced. Source assets and editorial pages are separate.
for (const directory of ["projects", "browse", "categories"]) rmSync(`public/${directory}`, { recursive: true, force: true });
function write(path, html) {
  const target = "public" + path + "index.html";
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, html); paths.push(path);
}
// Index and rank once; each detail page inspects only bounded recommendation pools.
const categoryProjects = new Map();
const relationProjects = new Map();
for (const project of projects) {
  if (!categoryProjects.has(project.cat)) categoryProjects.set(project.cat, []);
  categoryProjects.get(project.cat).push(project);
  const relationKey = `${project.cat}:${project.relationship || "unclassified"}`;
  if (!relationProjects.has(relationKey)) relationProjects.set(relationKey, []);
  const group = relationProjects.get(relationKey);
  if (group.length < 7) group.push(project);
}
const recentProjects = projects.filter(project => project.archived === false && /^\d{4}-\d{2}-\d{2}$/.test(project.pushed || "") && Number.isFinite(Date.parse(project.pushed)) && new Date(project.pushed).toISOString().slice(0, 10) === project.pushed)
  .sort((a, b) => b.pushed.localeCompare(a.pushed) || b.stars - a.stars || a.repo.localeCompare(b.repo)).slice(0, 13);
function takeRecommendations(candidates, excluded) {
  const chosen = [];
  for (const candidate of candidates) {
    const key = candidate.repo.toLowerCase();
    if (excluded.has(key)) continue;
    excluded.add(key);
    chosen.push(candidate);
    if (chosen.length === 6) break;
  }
  return chosen;
}
const urls = new Set(projects.map(p => projectPath(p.repo)));
const redirects = [];
for (const p of projects) {
  const path = projectPath(p.repo);
  const excluded = new Set([p.repo.toLowerCase()]);
  const similar = takeRecommendations([
    ...(relationProjects.get(`${p.cat}:${p.relationship || "unclassified"}`) || []),
    ...categoryProjects.get(p.cat).slice(0, 13),
  ], excluded);
  const active = takeRecommendations(recentProjects, excluded);
  write(path, renderProject(p, meta, similar, active, messages, { localeInfo: i18n.locales.en, duplicateName: duplicateNames.has(projectNameKey(p)) }));
  if (p.previousRepo && !urls.has(projectPath(p.previousRepo))) redirects.push(`${projectPath(p.previousRepo)} ${path} 301`);
}
for (const p of catalog.unavailable || []) {
  const path = projectPath(p.repo);
  write(path, page({ title: p.name + " — currently unavailable", description: "This repository could not be reached at the last catalog check.", path, noindex: true,
    body: `<header class="legal__header"><h1>${esc(p.name)}</h1><p>This repository is currently unavailable or no longer public. It is excluded from the active directory and will be checked again automatically.</p><p>Last known repository: ${esc(p.repo)}</p><p>Availability checked: ${esc(meta.syncedAt)}</p><a href="/browse/">Browse available projects →</a></header>` }));
  paths.pop();
}

function listings(items, base, title) {
  const pages = Math.max(1, Math.ceil(items.length / 24));
  for (let n = 1; n <= pages; n++) {
    const path = n === 1 ? base : `${base}${n}/`, slice = items.slice((n - 1) * 24, n * 24);
    write(path, renderListing(slice, { base, title, total: items.length, number: n }));
  }
}
listings(projects, "/browse/", "Jev ecosystem projects");
for (const category of categories) listings(categoryProjects.get(category.id) || [], `/categories/${category.id}/`, category.name + " for Jev");

write("/methodology/", page({ title: "Sources and evidence policy", description: "How JevHunt discovers, classifies and reviews projects, handles stale data and distinguishes Jev integrations from independent alternatives.", path: "/methodology/", body: `<header class="legal__header"><h1>Sources and evidence</h1><p>JevHunt uses GitHub Repository Search as its primary discovery path and supplements it with community feeds, official repositories and approved submissions. Coverage is broad but cannot be guaranteed exhaustive.</p></header><div class="legal__content"><section><h2>What each label means</h2><ul><li><strong>Official:</strong> an allowlisted SDK or resource owned by TypeSafe.</li><li><strong>Documented:</strong> first-party documentation states a Jev use or includes an API / SDK reference.</li><li><strong>Code reference:</strong> a Jev API identifier was found in source, linked at a specific commit.</li><li><strong>Editor reviewed:</strong> an editor checked the linked source and project classification.</li><li><strong>Needs review:</strong> retained historical data awaiting a successful new check.</li></ul><p>These labels do not mean we executed the code, audited its security or reproduced its performance claims.</p></section><section><h2>Project types</h2><p>Applications, optional integrations, SDKs, local alternatives, research and resource directories have separate labels. A local alternative may reproduce the decision interface without calling TypeSafe Jev. Classification is based on project descriptions and source documentation and can be corrected by editors.</p></section><section><h2>Discovery sources</h2><ul>${discoverySources.map(source => `<li>${esc(source.id)}${source.url ? ` — <a href="${esc(source.url)}" rel="noopener noreferrer">source</a>` : ''}${source.query ? `: <code>${esc(source.query)}</code>` : ''}</li>`).join("")}</ul><p>GitHub Search queries cover repository names, descriptions, README references, topics, SDK identifiers and model identifiers. Community directories add discovery links. Current metadata comes from GitHub. README and source references are pinned to commits. Search pages are partitioned by creation date when GitHub's 1,000-result limit is reached; partial results and request counts are disclosed in the audit report.</p></section><section><h2>Updates and corrections</h2><p>A Cloudflare scheduled worker advances small batches every minute and refreshes GitHub Search windows continuously. Failed individual checks retain the last known result with a stale label. Unavailable repositories are retained for rechecking. Editors may approve, reject, reclassify or withdraw submissions. Approvals are queued in D1 and appear after the worker checks their evidence; pages read the live catalog.</p><p><a href="/status/">Update status</a> · <a href="/catalog-audit.json">Machine-readable audit report</a> · <a href="/catalog.json">Catalog JSON</a> · <a href="https://github.com/xiaohu0x/jevhunt/issues">Report a correction</a></p></section></div>` }));

write("/status/", page({ title: "Catalog update status", description: "Last successful catalog check, source freshness, changes and release identity for JevHunt.", path: "/status/", body: `<header class="legal__header"><h1>Catalog update status</h1><p id="freshnessStatus">Last catalog check: <time id="syncTime" datetime="${esc(meta.syncedAt || '')}">${esc(meta.syncedAt || meta.updated)}</time></p></header><dl class="facts"><div><dt>Listed repositories</dt><dd>${apps.length}</dd></div><div><dt>Discovery candidates</dt><dd>${meta.candidateCount}</dd></div><div><dt>Checks pending</dt><dd>${meta.staleCount || 0}</dd></div><div><dt>Snapshot</dt><dd><code>${esc(meta.catalogHash)}</code></dd></div><div><dt>Latest source date</dt><dd>${esc(meta.updated)}</dd></div></dl><h2>Discovery runs</h2><ul>${(meta.sources || []).map(s => `<li>${esc(s.id)}: ${esc(s.status)}${s.query ? ` — ${esc(s.query)}` : ''}${s.error ? ` — ${esc(s.error)}` : ''}</li>`).join("")}</ul><h2>Changes in this snapshot</h2><p>${meta.changes?.added?.length || 0} added · ${meta.changes?.removed?.length || 0} removed</p><p>The Cloudflare worker checks sources and repositories continuously. See the live status endpoint for its heartbeat and queue.</p><p><a href="/catalog-audit.json">Full audit</a> · <a href="/build-info.json">Build identity</a> · <a href="/api/health">Live health</a> · <a href="/api/catalog/status">Worker history</a></p>`, script: "/assets/js/status.js" }));

write("/admin/", page({ title: "Submission review", description: "JevHunt editorial review queue.", path: "/admin/", noindex: true,
  body: `<header class="legal__header"><h1>Review submissions</h1><p><button class="btn btn--ghost" id="triggerDiscovery">Refresh discovery sources</button> <a href="/status/">Worker status</a></p><p><a href="/api/auth/google?next=%2Fadmin%2F">Sign in with your authorized Google account</a></p></header><label>Queue <select id="reviewStatus"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label><p id="adminNote" role="status">Loading…</p><div id="reviewQueue"></div><button id="reviewMore" class="btn btn--ghost" hidden>Load more</button><script>window.JH_REVIEW_CATEGORIES = ${JSON.stringify(categories).replace(/</g, "\\u003c")};</script>`, script: "/assets/js/admin.js" }));
paths.pop(); // Administration is deliberately absent from the public sitemap.

const sitemap = readFileSync("public/sitemap.xml", "utf8").replace("</urlset>", paths.map(path => `  <url><loc>${ORIGIN}${esc(path)}</loc><lastmod>${(meta.syncedAt || meta.updated).slice(0, 10)}</lastmod></url>`).join("\n") + "\n</urlset>");
writeFileSync("public/sitemap.xml", sitemap);
writeFileSync("public/_redirects", [...new Set(redirects)].join("\n") + "\n");
mkdirSync(".cache", { recursive: true });
writeFileSync(".cache/generated-routes.json", JSON.stringify(paths));
let commit = process.env.GITHUB_SHA || "local";
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* archive build */ }
writeFileSync("public/build-info.json", JSON.stringify({ version: "0.3.0", commit, catalogHash: meta.catalogHash, projectCount: apps.length, syncedAt: meta.syncedAt, builtAt: new Date().toISOString(), routeCount: paths.length }) + "\n");
console.log(`Generated ${paths.length} project, category, pagination and evidence pages.`);
