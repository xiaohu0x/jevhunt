import { esc, page, projectPath, repoUrl, ORIGIN } from "./render.js";
import { CATEGORY_IDS, CATEGORY_NAMES } from "./catalog-data.js";

export const RELATION_LABELS = { "jev-app": "Jev application", integration: "Integration", sdk: "SDK / client", "local-alternative": "Local alternative", research: "Research", resource: "Resource / directory", unclassified: "Relationship under review" };
export const EVIDENCE_LABELS = { official: "Official", documented: "Documented", "code-reference": "Code reference", reviewed: "Editor reviewed", "legacy-unreviewed": "Needs review" };
const label = (messages, key, fallback) => messages?.[key] || fallback;

export function renderCard(p, messages = {}, { basePath = "" } = {}) {
  const relation = label(messages, "relationship." + p.relationship, RELATION_LABELS[p.relationship] || "Relationship under review");
  const evidence = label(messages, "evidence." + p.evidenceLevel, EVIDENCE_LABELS[p.evidenceLevel] || "Needs review");
  const published = p.created ? label(messages, "apps.published", "published {date}").replace("{date}", p.created) : "";
  const updated = p.pushed ? label(messages, "apps.updated", "updated {date}").replace("{date}", p.pushed) : label(messages, "apps.unknownUpdate", "update date unknown");
  const tags = [
    p.language ? `<span class="tag">${esc(p.language)}</span>` : "",
    `<span class="tag">${esc(evidence)}</span>`,
    p.fork ? `<span class="tag">${esc(label(messages, "apps.fork", "Fork"))}</span>` : "",
    p.archived ? `<span class="tag">${esc(label(messages, "apps.archived", "Archived"))}</span>` : "",
    p.freshness && p.freshness !== "current" ? `<span class="tag">${esc(label(messages, "apps.stale", "Check pending"))}</span>` : "",
    published ? `<span class="tag">${esc(published)}</span>` : "",
    `<span class="tag">${esc(updated)}</span>`,
  ].filter(Boolean).join("");
  return `<article class="card"><div class="card__top"><div><h2 class="card__heading"><a class="card__name" href="${projectPath(p.repo, basePath)}">${esc(p.name)}</a></h2><div class="card__author">${esc(p.repo)}</div></div><span class="badge badge--catalog">${esc(relation)}</span></div>
<a class="card__descLink" href="${projectPath(p.repo, basePath)}"><p class="card__desc">${esc(p.desc || label(messages, "apps.noDescription", "No project description available."))}</p></a><div class="card__tags">${tags}</div>
<div class="card__foot"><span class="card__links"><a class="card__go" href="${repoUrl(p.repo)}" target="_blank" rel="ugc nofollow noopener noreferrer">GitHub <span aria-hidden="true">↗</span></a><a class="card__site" href="${esc(p.evidence)}" target="_blank" rel="ugc nofollow noopener noreferrer">${esc(label(messages, "apps.evidence", "Evidence"))} <span aria-hidden="true">↗</span></a></span><span class="card__stat" aria-label="${esc(label(messages, "apps.starsLabel", "{count} GitHub stars").replace("{count}", Number(p.stars || 0).toLocaleString("en-US")))}">★ ${Number(p.stars || 0).toLocaleString("en-US")}</span></div></article>`;
}

export function renderProject(p, meta, similar = [], active = [], messages = {}, { localeKey = "en", localeInfo = null, localePrefix = "" } = {}) {
  const path = projectPath(p.repo, localePrefix), detail = p.evidenceDetail;
  const t = (key, fallback) => messages[key] || fallback;
  const relation = label(messages, "relationship." + p.relationship, RELATION_LABELS[p.relationship] || "Relationship under review");
  const level = label(messages, "evidence." + p.evidenceLevel, EVIDENCE_LABELS[p.evidenceLevel] || "Needs review");
  const category = label(messages, "category." + p.cat, CATEGORY_NAMES[CATEGORY_IDS.indexOf(p.cat)] || p.cat);
  const notReported = t("project.notReported", "Not reported");
  const status = p.archived ? t("project.archived", "Archived") : t("project.notArchived", "Not archived");
  const checkStatus = p.freshness === "current" ? t("apps.active", "Current") : t("apps.stale", "Check pending");
  const number = Number(p.stars || 0).toLocaleString(localeInfo?.lang || "en-US");
  const properties = [
    [t("project.relationship", "Relationship to Jev"), relation], [t("project.evidence", "Evidence"), level],
    [t("apps.language", "Language"), p.language || notReported], [t("project.license", "License"), p.license || t("project.licenseMissing", "Not reported; check the repository")],
    [t("project.origin", "Origin"), p.fork ? t("project.fork", "Fork") : t("project.original", "Original repository")],
    [t("project.status", "Repository status"), status], [t("project.created", "Created"), p.created || notReported],
    [t("project.stars", "GitHub stars"), number], [t("project.evidenceChecked", "Evidence checked"), p.evidenceCheckedAt || meta.syncedAt],
    [t("project.metadataChecked", "Metadata checked"), p.metadataCheckedAt || t("project.catalogDate", "See catalog source date")],
    [t("project.checkStatus", "Check status"), checkStatus],
  ];
  const cardOptions = { basePath: localePrefix };
  const renderRecommendations = (items, title, empty) => `<section class="related"><h2>${esc(title)}</h2>${items.length ? `<div class="app-grid">${items.map(other => renderCard(other, messages, cardOptions)).join("")}</div>` : `<p class="related__empty">${esc(empty)}</p>`}</section>`;
  const correction = `https://github.com/xiaohu0x/jevhunt/issues/new?title=${encodeURIComponent("Listing correction: " + p.repo)}`;
  const body = `<header class="legal__header"><nav class="breadcrumbs" aria-label="${esc(t("project.breadcrumb", "Breadcrumb"))}"><a href="${localePrefix || "/"}">JevHunt</a> / <a href="${localePrefix}/categories/${esc(p.cat)}/">${esc(category)}</a></nav><h1>${esc(p.name)}</h1><p class="legal__summary">${esc(p.desc || t("apps.noDescription", "No project description available."))}</p><p><a class="btn btn--primary" href="${repoUrl(p.repo)}" target="_blank" rel="ugc nofollow noopener noreferrer">${esc(t("project.openGithub", "Open GitHub"))} ↗</a> <a class="btn btn--ghost" href="${esc(p.evidence)}" target="_blank" rel="ugc nofollow noopener noreferrer">${esc(t("project.readEvidence", "Read evidence"))} ↗</a></p></header>
<div class="project-detail"><section><h2>${esc(t("project.facts", "Project facts"))}</h2><dl class="facts">${properties.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl><p>${esc(t("project.starsNote", "Stars measure the whole repository, including work unrelated to Jev."))}</p></section><section><h2>${esc(t("project.evidenceScope", "Evidence and scope"))}</h2><p>${esc(t("project.evidenceScopeText", "{level} records the linked documentation or source. JevHunt has not independently run or benchmarked this project.").replace("{level}", level))}</p>${detail?.excerpt ? `<blockquote>${esc(detail.excerpt)}</blockquote>` : ""}${detail?.commit ? `<p>${esc(t("project.evidenceCommit", "Evidence commit"))}: <code>${esc(detail.commit)}</code></p>` : ""}<p>${esc(t("project.discovered", "Discovered through: {sources}.").replace("{sources}", (p.provenance || []).join(", ")))}</p><a href="${localePrefix}/methodology/">${esc(t("project.reviewMethod", "How we review"))} →</a></section></div>
${renderRecommendations(similar, t("project.similar", "Similar projects"), t("project.noSimilar", "No similar projects found."))}${renderRecommendations(active, t("project.active", "Recently active projects"), t("project.noActive", "No recently active projects found."))}<p><a href="${correction}" rel="noopener noreferrer">${esc(t("project.correction", "Suggest a correction"))}</a> · <a href="${localePrefix}/#submit">${esc(t("project.submit", "Submit a project"))}</a></p>`;
  return page({ title: p.name + " — " + relation, description: p.desc || t("apps.noDescription", "No project description available."), path, body, messages, localeKey, localeInfo, localePrefix, schema: { "@context": "https://schema.org", "@type": ["resource", "research"].includes(p.relationship) ? "CreativeWork" : "SoftwareSourceCode", name: p.name, description: p.desc, url: ORIGIN + path, codeRepository: repoUrl(p.repo), programmingLanguage: p.language || undefined } });
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
