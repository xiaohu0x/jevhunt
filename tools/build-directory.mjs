import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { loadData, esc, page, ORIGIN, projectPath, repoUrl, hash } from "./lib/site.mjs";

const { apps, categories, catalogMeta: meta, i18n } = loadData();
const catalog = JSON.parse(readFileSync("public/catalog.json", "utf8"));
const projects = [...catalog.apps].sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo));
const messages = i18n.locales.en.messages;
const discoveryConfig = JSON.parse(readFileSync("catalog/sources.json", "utf8"));
const discoverySources = [...discoveryConfig.sources.map(source => ({ id: source.id, url: source.homepage })), { id: "GitHub repository search", url: "https://github.com/search?type=repositories&q=jev+typesafe" }, { id: "Official TypeSafe repositories", url: "https://github.com/typesafe-ai" }, { id: "Approved editorial submissions", url: "/#submit" }];
const label = (kind, key) => messages[`${kind}.${key}`] || key;
const paths = [];
// Only generated outputs are replaced. Source assets and editorial pages are separate.
for (const directory of ["projects", "browse", "categories"]) rmSync(`public/${directory}`, { recursive: true, force: true });
function write(path, html) {
  const target = "public" + path + "index.html";
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, html); paths.push(path);
}
function card(p) {
  return `<article class="card"><div class="card__top"><div><h2 class="card__heading"><a class="card__name" href="${projectPath(p.repo)}">${esc(p.name)}</a></h2><div class="card__author">${esc(p.repo)}</div></div></div><p class="card__desc">${esc(p.desc)}</p><div class="card__tags"><span class="tag">${esc(label("relationship", p.relationship || "unclassified"))}</span><span class="tag">${esc(label("evidence", p.evidenceLevel || "legacy-unreviewed"))}</span>${p.archived ? '<span class="tag">Archived</span>' : ''}</div><div class="card__foot"><a href="${projectPath(p.repo)}">Details →</a><span>★ ${p.stars.toLocaleString("en-US")}</span></div></article>`;
}
const urls = new Set(projects.map(p => projectPath(p.repo)));
const redirects = ["https://www.jevhunt.com/* https://jevhunt.com/:splat 301"];
for (const p of projects) {
  const path = projectPath(p.repo), detail = p.evidenceDetail;
  const category = categories.find(c => c.id === p.cat);
  const relation = label("relationship", p.relationship || "unclassified"), level = label("evidence", p.evidenceLevel || "legacy-unreviewed");
  const properties = [["Relationship to Jev", relation], ["Repository origin", p.fork === true ? "Fork" : p.fork === false ? "Original repository" : "Unknown"], ["Evidence", level], ["Language", p.language || "Not reported"], ["License", p.license || "Not reported; check the repository"], ["Repository status", p.archived === true ? "Archived" : p.archived === false ? "Not archived" : "Unknown"], ["Created", p.created || "Not reported"], ["Last code update", p.pushed || "Not reported"], ["GitHub stars", p.stars.toLocaleString("en-US")], ["Check status", p.freshness || "Needs review"]];
  const related = projects.filter(other => other.id !== p.id && other.cat === p.cat && other.relationship === p.relationship).slice(0, 4);
  const body = `<header class="legal__header"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">JevHunt</a> / <a href="/categories/${esc(p.cat)}/">${esc(category?.name || p.cat)}</a></nav><h1>${esc(p.name)}</h1><p class="legal__summary">${esc(p.desc || "See the repository for project documentation.")}</p><p><a class="btn btn--primary" href="${repoUrl(p.repo)}" target="_blank" rel="ugc nofollow noopener noreferrer">Open GitHub ↗</a> <a class="btn btn--ghost" href="${esc(p.evidence)}" target="_blank" rel="ugc nofollow noopener noreferrer">Read evidence ↗</a></p></header>
<div class="project-detail"><section><h2>Project facts</h2><dl class="facts">${properties.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl><p>Stars measure the whole repository, including work unrelated to Jev.</p></section>
<section><h2>Evidence and scope</h2><p>${esc(level)}: this records ${p.evidenceLevel === "reviewed" ? "an editor's review of the linked source" : p.evidenceLevel === "code-reference" ? "a Jev API reference found in source code" : p.evidenceLevel === "official" ? "official TypeSafe ownership" : "what the project's own documentation states"}. JevHunt has not independently run or benchmarked this project.</p>${detail?.excerpt ? `<blockquote>${esc(detail.excerpt)}</blockquote>` : ''}${detail?.commit ? `<p>Evidence commit: <code>${esc(detail.commit)}</code></p>` : ''}<p>Discovered through: ${esc((p.provenance || ["legacy snapshot"]).join(", "))}. Catalog checked ${esc(meta.syncedAt || meta.updated)}.</p><a href="/methodology/">Read the evidence policy →</a></section></div>
<section class="related"><h2>Related projects</h2><div class="app-grid">${related.map(card).join("")}</div></section><p><a href="https://github.com/xiaohu0x/jevhunt/issues/new?title=${encodeURIComponent("Listing correction: " + p.repo)}" rel="noopener noreferrer">Suggest a correction</a> · <a href="/#submit">Submit a project</a></p>`;
  const schema = { "@context": "https://schema.org", "@type": ["resource", "research"].includes(p.relationship) ? "CreativeWork" : "SoftwareSourceCode", name: p.name, description: p.desc, url: ORIGIN + path, codeRepository: repoUrl(p.repo), dateModified: p.pushed || undefined, programmingLanguage: p.language || undefined };
  write(path, page({ title: p.name + " — " + relation, description: p.desc, path, body, schema }));
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
    const nav = `<nav class="catalog-pages" aria-label="Pagination">${n > 1 ? `<a rel="prev" href="${n === 2 ? base : base + (n - 1) + '/'}">← Previous</a>` : ''} <span>Page ${n} of ${pages}</span> ${n < pages ? `<a rel="next" href="${base}${n + 1}/">Next →</a>` : ''}</nav>`;
    const categoryLinks = categories.map(c => `<a class="fchip" href="/categories/${c.id}/">${esc(c.name)}</a>`).join(" ");
    const body = `<header class="legal__header"><h1>${esc(title)}${n > 1 ? ` — page ${n}` : ''}</h1><p>${items.length} repositories. Evidence labels describe documentation and source references; they do not certify runtime behavior.</p><p><a href="/">Search and filter the directory →</a></p></header><nav class="dir__filters" aria-label="Categories">${categoryLinks}</nav>${nav}<div class="app-grid">${slice.map(card).join("")}</div>${nav}`;
    write(path, page({ title: title + (n > 1 ? ` — page ${n}` : ''), description: `Browse ${title}: applications, source evidence and repository activity. Page ${n}.`, path, body, schema: { "@context": "https://schema.org", "@type": "ItemList", numberOfItems: slice.length, itemListElement: slice.map((p, i) => ({ "@type": "ListItem", position: (n - 1) * 24 + i + 1, url: ORIGIN + projectPath(p.repo), name: p.name })) } }));
  }
}
listings(projects, "/browse/", "Jev ecosystem projects");
for (const category of categories) listings(projects.filter(p => p.cat === category.id), `/categories/${category.id}/`, category.name + " for Jev");

write("/methodology/", page({ title: "Sources and evidence policy", description: "How JevHunt discovers, classifies and reviews projects, handles stale data and distinguishes Jev integrations from independent alternatives.", path: "/methodology/", body: `<header class="legal__header"><h1>Sources and evidence</h1><p>JevHunt tracks the public Jev ecosystem. Coverage is limited to the sources and searches below and cannot be guaranteed exhaustive.</p></header><div class="legal__content"><section><h2>What each label means</h2><ul><li><strong>Official:</strong> an allowlisted SDK or resource owned by TypeSafe.</li><li><strong>Documented:</strong> first-party documentation states a Jev use or includes an API / SDK reference.</li><li><strong>Code reference:</strong> a Jev API identifier was found in source, linked at a specific commit.</li><li><strong>Editor reviewed:</strong> an editor checked the linked source and project classification.</li><li><strong>Needs review:</strong> retained historical data awaiting a successful new check.</li></ul><p>These labels do not mean we executed the code, audited its security or reproduced its performance claims.</p></section><section><h2>Project types</h2><p>Applications, optional integrations, SDKs, local alternatives, research and resource directories have separate labels. A local alternative may reproduce the decision interface without calling TypeSafe Jev. Classification is based on project descriptions and source documentation and can be corrected by editors.</p></section><section><h2>Discovery sources</h2><ul>${discoverySources.map(source => `<li>${esc(source.id)}${source.url ? ` — <a href="${esc(source.url)}" rel="noopener noreferrer">source</a>` : ''}${source.query ? `: <code>${esc(source.query)}</code>` : ''}</li>`).join("")}</ul><p>Community directories supply discovery links. Current metadata comes from GitHub. README and source references are pinned to commits. Search pages are partitioned by creation date when GitHub's 1,000-result limit is reached; partial searches are disclosed in the report.</p></section><section><h2>Updates and corrections</h2><p>A Cloudflare scheduled worker advances small batches every minute and refreshes community feeds every six hours. Failed individual checks retain the last known result with a stale label. Unavailable repositories are retained for rechecking. Editors may approve, reject, reclassify or withdraw submissions. Approvals are queued in D1 and appear after the worker checks their evidence; pages read the live catalog.</p><p><a href="/status/">Update status</a> · <a href="/catalog-audit.json">Machine-readable audit report</a> · <a href="/catalog.json">Catalog JSON</a> · <a href="https://github.com/xiaohu0x/jevhunt/issues">Report a correction</a></p></section></div>` }));

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
