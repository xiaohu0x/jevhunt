import { esc, page, projectPath, repoUrl, ORIGIN } from "./render.js";
import { CATEGORY_IDS, CATEGORY_NAMES } from "./catalog-data.js";

export const RELATION_LABELS = { "jev-app": "Jev application", integration: "Integration", sdk: "SDK / client", "local-alternative": "Local alternative", research: "Research", resource: "Resource / directory", unclassified: "Relationship under review" };
export const EVIDENCE_LABELS = { official: "Official", documented: "Documented", "code-reference": "Code reference", reviewed: "Editor reviewed", "legacy-unreviewed": "Needs review" };
const label = (messages, key, fallback) => messages?.[key] || fallback;

export function renderCard(p, messages = {}) {
  const relation = label(messages, "relationship." + p.relationship, RELATION_LABELS[p.relationship] || "Relationship under review");
  const evidence = label(messages, "evidence." + p.evidenceLevel, EVIDENCE_LABELS[p.evidenceLevel] || "Needs review");
  return `<article class="card"><div class="card__top"><div><h2 class="card__heading"><a class="card__name" href="${projectPath(p.repo)}">${esc(p.name)}</a></h2><div class="card__author">${esc(p.repo)}</div></div><span class="badge badge--catalog">${esc(relation)}</span></div>
<p class="card__desc">${esc(p.desc)}</p><div class="card__tags">${p.language ? `<span class="tag">${esc(p.language)}</span>` : ''}<span class="tag">${esc(evidence)}</span>${p.fork ? `<span class="tag">${esc(label(messages, "apps.fork", "Fork"))}</span>` : ''}${p.archived ? `<span class="tag">${esc(label(messages, "apps.archived", "Archived"))}</span>` : ''}${p.freshness !== "current" ? `<span class="tag">${esc(label(messages, "apps.stale", "Check pending"))}</span>` : ''}</div>
<div class="card__foot"><a href="${projectPath(p.repo)}">${esc(label(messages, "apps.details", "Details"))} →</a><span>★ ${Number(p.stars || 0).toLocaleString("en-US")}</span></div></article>`;
}

export function renderProject(p, meta, related = []) {
  const path = projectPath(p.repo), detail = p.evidenceDetail;
  const relation = RELATION_LABELS[p.relationship] || "Relationship under review", level = EVIDENCE_LABELS[p.evidenceLevel] || "Needs review";
  const properties = [["Relationship to Jev", relation], ["Evidence", level], ["Language", p.language || "Not reported"],
    ["License", p.license || "Not reported; check the repository"], ["Origin", p.fork ? "Fork" : "Original repository"],
    ["Repository status", p.archived ? "Archived" : "Not archived"], ["Created", p.created || "Not reported"],
    ["GitHub stars", Number(p.stars || 0).toLocaleString("en-US")], ["Evidence checked", p.evidenceCheckedAt || meta.syncedAt],
    ["Metadata checked", p.metadataCheckedAt || "See catalog source date"], ["Check status", p.freshness || "Needs review"]];
  const body = `<header class="legal__header"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">JevHunt</a> / <a href="/categories/${esc(p.cat)}/">${esc(CATEGORY_NAMES[CATEGORY_IDS.indexOf(p.cat)] || p.cat)}</a></nav><h1>${esc(p.name)}</h1><p class="legal__summary">${esc(p.desc)}</p><p><a class="btn btn--primary" href="${repoUrl(p.repo)}" target="_blank" rel="ugc nofollow noopener noreferrer">Open GitHub ↗</a> <a class="btn btn--ghost" href="${esc(p.evidence)}" target="_blank" rel="ugc nofollow noopener noreferrer">Read evidence ↗</a></p></header>
<div class="project-detail"><section><h2>Project facts</h2><dl class="facts">${properties.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl><p>Stars measure the whole repository, including work unrelated to Jev.</p></section><section><h2>Evidence and scope</h2><p>${esc(level)} records the linked documentation or source. JevHunt has not independently run or benchmarked this project.</p>${detail?.excerpt ? `<blockquote>${esc(detail.excerpt)}</blockquote>` : ''}${detail?.commit ? `<p>Evidence commit: <code>${esc(detail.commit)}</code></p>` : ''}<p>Discovered through: ${esc((p.provenance || []).join(", "))}.</p><a href="/methodology/">How we review →</a></section></div>
<section class="related"><h2>Related projects</h2><div class="app-grid">${related.map(other => renderCard(other)).join("")}</div></section><p><a href="https://github.com/xiaohu0x/jevhunt/issues/new?title=${encodeURIComponent("Listing correction: " + p.repo)}" rel="noopener noreferrer">Suggest a correction</a></p>`;
  return page({ title: p.name + " — " + relation, description: p.desc, path, body, schema: { "@context": "https://schema.org", "@type": ["resource", "research"].includes(p.relationship) ? "CreativeWork" : "SoftwareSourceCode", name: p.name, description: p.desc, url: ORIGIN + path, codeRepository: repoUrl(p.repo), programmingLanguage: p.language || undefined } });
}

export function renderListing(items, { base, title, total, number }) {
  const pages = Math.max(1, Math.ceil(total / 24));
  const path = number === 1 ? base : `${base}${number}/`;
  const nav = `<nav class="catalog-pages" aria-label="Pagination">${number > 1 ? `<a rel="prev" href="${number === 2 ? base : base + (number - 1) + '/'}">← Previous</a>` : ''} <span>Page ${number} of ${pages}</span> ${number < pages ? `<a rel="next" href="${base}${number + 1}/">Next →</a>` : ''}</nav>`;
  const body = `<header class="legal__header"><h1>${esc(title)}${number > 1 ? ` — page ${number}` : ''}</h1><p>${total} repositories with documented relationships and source evidence.</p><p><a href="/">Search and filter →</a></p></header><nav class="dir__filters" aria-label="Categories">${CATEGORY_IDS.map((id, i) => `<a class="fchip" href="/categories/${id}/">${esc(CATEGORY_NAMES[i])}</a>`).join(" ")}</nav>${nav}<div class="app-grid">${items.map(item => renderCard(item)).join("")}</div>${nav}`;
  return page({ title, description: `Browse ${title}, page ${number}. Read repository facts, evidence and project relationships.`, path, body, schema: { "@context": "https://schema.org", "@type": "ItemList", numberOfItems: items.length, itemListElement: items.map((p, i) => ({ "@type": "ListItem", position: (number - 1) * 24 + i + 1, name: p.name, url: ORIGIN + projectPath(p.repo) })) } });
}

export function htmlResponse(html, { status = 200 } = {}) {
  return new Response(html, { status, headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=60",
    "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "permissions-policy": "geolocation=(), microphone=(), camera=()",
    "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://static.cloudflareinsights.com; connect-src 'self' https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://cloudflareinsights.com; img-src 'self' data: https://*.googleusercontent.com https://www.google-analytics.com; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  } });
}
