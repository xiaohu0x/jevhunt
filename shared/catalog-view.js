import { renderProjectCard } from "../public/assets/js/project-card.js";
import { LOCALES } from "./locales.js";
import { esc, page, projectPath, repoUrl, ORIGIN } from "./render.js";
import { CATEGORY_IDS, CATEGORY_NAMES } from "./catalog-data.js";
import { projectSeo } from "./project-seo.js";
import { applyProjectContent, matchingProjectContent, contentCitation } from "./project-content.js";

export const RELATION_LABELS = { "jev-app": "Jev application", integration: "Integration", sdk: "SDK / client", "local-alternative": "Local alternative", research: "Research", resource: "Resource / directory", unclassified: "Relationship under review" };
export const EVIDENCE_LABELS = { official: "Official", documented: "Documented", "code-reference": "Code reference", reviewed: "Editor reviewed", "legacy-unreviewed": "Needs review" };
const label = (messages, key, fallback) => messages?.[key] || fallback;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function renderCard(p, messages = {}, { basePath = "" } = {}) {
  return renderProjectCard(p, { messages, basePath, locale: LOCALES[basePath.slice(1)]?.lang || "en" });
}

export function renderProject(p, meta, similar = [], active = [], messages = {}, { localeKey = "en", localeInfo = null, localePrefix = "", duplicateName = false, content = null } = {}) {
  if (!matchingProjectContent(p, content)) content = null;
  if (content) p = applyProjectContent(p, content);
  const path = projectPath(p.repo, localePrefix), detail = p.evidenceDetail;
  const t = (key, fallback) => messages[key] || fallback;
  const seo = projectSeo(p, { localeKey, duplicateName, content });
  const relation = label(messages, "relationship." + seo.relationship, RELATION_LABELS[seo.relationship] || "Relationship under review");
  const level = label(messages, "evidence." + p.evidenceLevel, EVIDENCE_LABELS[p.evidenceLevel] || "Needs review");
  const category = label(messages, "category." + p.cat + ".name", CATEGORY_NAMES[CATEGORY_IDS.indexOf(p.cat)] || p.cat);
  const categoryPath = localePrefix ? `${localePrefix}/?category=${encodeURIComponent(p.cat)}#apps` : `/categories/${encodeURIComponent(p.cat)}/`;
  const homePath = `${localePrefix}/`;
  const description = seo.description;
  const notReported = t("project.notReported", "Not reported");
  const status = p.archived === true ? t("project.archived", "Archived") : p.archived === false ? t("project.notArchived", "Not archived") : notReported;
  const checkStatus = p.freshness === "current" ? t("project.checkCurrent", "Up to date") : t("apps.stale", "Check pending");
  const number = Number(p.stars || 0).toLocaleString(localeInfo?.lang || "en-US");
  const properties = [
    [t("project.relationship", "Relationship to Jev"), relation], [t("project.evidence", "Evidence"), level],
    [t("apps.language", "Language"), p.language || notReported], [t("project.license", "License"), p.license || t("project.licenseMissing", "Not reported; check the repository")],
    [t("project.origin", "Origin"), p.fork === true ? t("project.fork", "Fork") : p.fork === false ? t("project.original", "Original repository") : notReported],
    [t("project.status", "Repository status"), status], [t("project.created", "Created"), p.created || notReported],
    [t("project.codeUpdated", "Last code update"), validDate(p.pushed) ? p.pushed : notReported],
    [t("project.stars", "GitHub stars"), number], [t("project.evidenceChecked", "Evidence checked"), p.evidenceCheckedAt || notReported],
    [t("project.metadataChecked", "Metadata checked"), p.metadataCheckedAt || t("project.catalogDate", "See catalog source date")],
    [t("project.checkStatus", "Check status"), checkStatus],
  ];
  const recommended = new Set([p.repo.toLowerCase()]);
  const uniqueRecommendations = items => {
    const result = [];
    for (const item of items) {
      const repo = item.repo.toLowerCase();
      if (recommended.has(repo)) continue;
      recommended.add(repo);
      result.push(item);
      if (result.length === 6) break;
    }
    return result;
  };
  similar = uniqueRecommendations(similar);
  active = uniqueRecommendations(active.filter(item => item.archived === false && validDate(item.pushed)));
  const cardOptions = { basePath: localePrefix };
  const renderRecommendations = (items, title, empty, id) => `<section class="related" id="${id}" aria-labelledby="${id}-heading"><h2 id="${id}-heading">${esc(title)}</h2>${items.length ? `<div class="app-grid">${items.map(other => renderCard(other, messages, cardOptions)).join("")}</div>` : `<p class="related__empty">${esc(empty)}</p>`}</section>`;
  const correction = `https://github.com/xiaohu0x/jevhunt/issues/new?title=${encodeURIComponent("Listing correction: " + p.repo)}`;
  const authored = content?.locales[localeKey];
  const explanation = authored ? `<article class="project-explanation" data-content-version="${esc(content.version)}">${authored.sections.map(section => {
    const citations = [...new Set(section.claims.flatMap(id => content.claims.find(claim => claim.id === id)?.evidence || []).map(evidence => contentCitation(content, evidence)).filter(Boolean))];
    return `<section id="project-${esc(section.kind)}"><h2>${esc(section.heading)}</h2><p>${esc(section.text)}</p><p class="project-citations">${citations.map((url, index) => `<a href="${esc(url)}" target="_blank" rel="ugc nofollow noopener noreferrer">${esc(t("apps.evidence", "Evidence"))} ${index + 1} ↗</a>`).join(" · ")}</p></section>`;
  }).join("")}<p class="project-content-date">${esc(t("project.evidenceChecked", "Evidence checked"))}: <time datetime="${esc(content.reviewedAt)}">${esc(new Intl.DateTimeFormat(localeInfo?.lang || "en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(content.reviewedAt + "T12:00:00Z")))}</time></p></article>` : "";
  const body = `<header class="legal__header"><nav class="breadcrumbs" aria-label="${esc(t("project.breadcrumb", "Breadcrumb"))}"><a href="${homePath}">JevHunt</a> / <a href="${categoryPath}">${esc(category)}</a></nav><h1>${esc(seo.heading)}</h1><p class="project-repo">${esc(p.repo)}</p><p class="legal__summary">${esc(description)}</p>${!authored && p.desc?.trim() ? `<p class="project-source-description"><strong>${esc(seo.sourceHeading)}:</strong> <span dir="auto">${esc(p.desc.trim())}</span></p>` : ""}<p><a class="btn btn--primary" href="${repoUrl(p.repo)}" target="_blank" rel="ugc nofollow noopener noreferrer">${esc(t("project.openGithub", "Open GitHub"))} ↗</a> <a class="btn btn--ghost" href="${esc(p.evidence)}" target="_blank" rel="ugc nofollow noopener noreferrer">${esc(t("project.readEvidence", "Read evidence"))} ↗</a></p></header>
${explanation}${authored && p.desc?.trim() ? `<details class="project-original"><summary>${esc(seo.sourceHeading)}</summary><p class="project-source-description" dir="auto">${esc(p.desc.trim())}</p></details>` : ""}<div class="project-detail"><section aria-labelledby="project-facts"><h2 id="project-facts">${esc(t("project.facts", "Project facts"))}</h2><dl class="facts">${properties.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl><p>${esc(t("project.starsNote", "Stars measure the whole repository, including work unrelated to Jev."))}</p></section><section aria-labelledby="project-evidence"><h2 id="project-evidence">${esc(t("project.evidenceScope", "Evidence and scope"))}</h2><p>${esc(t("project.evidenceScopeText", "{level} records the linked documentation or source. JevHunt has not independently run or benchmarked this project.").replace("{level}", level))}</p>${detail?.excerpt && !authored ? `<blockquote cite="${esc(p.evidence)}">${esc(detail.excerpt)}</blockquote>` : ""}${detail?.commit ? `<p>${esc(t("project.evidenceCommit", "Evidence commit"))}: <code>${esc(detail.commit)}</code></p>` : ""}<p>${esc(t("project.discovered", "Discovered through: {sources}.").replace("{sources}", (p.provenance || []).join(", ")))}</p><a href="/methodology/">${esc(t("project.reviewMethod", "How we review"))} →</a></section></div>
${renderRecommendations(similar, t("project.similar", "Similar projects"), t("project.noSimilar", "No similar projects found."), "similar-projects")}${renderRecommendations(active, t("project.active", "Recently active projects"), t("project.noActive", "No recently active projects found."), "active-projects")}<p><a href="${correction}" rel="noopener noreferrer">${esc(t("project.correction", "Suggest a correction"))}</a> · <a href="${localePrefix}/#submit">${esc(t("project.submit", "Submit a project"))}</a></p>`;
  const inLanguage = localeInfo?.lang || "en";
  const dateModified = validDate(p.pushed) ? p.pushed : undefined;
  return page({ title: seo.title, description, path, body, messages, localeKey, localeInfo, localePrefix, schema: { "@context": "https://schema.org", "@graph": [
    { "@type": ["resource", "research"].includes(seo.relationship) ? "CreativeWork" : "SoftwareSourceCode", "@id": ORIGIN + path + "#project", name: seo.name, description, url: ORIGIN + path, codeRepository: repoUrl(p.repo), programmingLanguage: p.language || undefined, inLanguage, dateModified },
    { "@type": "BreadcrumbList", inLanguage, itemListElement: [
      { "@type": "ListItem", position: 1, name: "JevHunt", item: ORIGIN + homePath },
      { "@type": "ListItem", position: 2, name: category, item: ORIGIN + categoryPath },
      { "@type": "ListItem", position: 3, name: p.name, item: ORIGIN + path },
    ] },
  ] } });
}

export function renderListing(items, { base, title, total, number }) {
  const pages = Math.max(1, Math.ceil(total / 24));
  const path = number === 1 ? base : `${base}${number}/`;
  const nav = `<nav class="catalog-pages" aria-label="Pagination">${number > 1 ? `<a rel="prev" href="${number === 2 ? base : base + (number - 1) + '/'}">← Previous</a>` : ''} <span>Page ${number} of ${pages}</span> ${number < pages ? `<a rel="next" href="${base}${number + 1}/">Next →</a>` : ''}</nav>`;
  const body = `<header class="legal__header"><h1>${esc(title)}${number > 1 ? ` — page ${number}` : ''}</h1><p>${total} repositories with documented relationships and source evidence.</p><p><a href="/">Search and filter →</a></p></header><nav class="dir__filters" aria-label="Categories">${CATEGORY_IDS.map((id, i) => `<a class="fchip" href="/categories/${id}/">${esc(CATEGORY_NAMES[i])}</a>`).join(" ")}</nav>${nav}<div class="app-grid">${items.map(item => renderCard(item)).join("")}</div>${nav}`;
  return page({ title: title + (number > 1 ? ` — page ${number}` : ""), description: `Browse ${title}, page ${number}. Read repository facts, evidence and project relationships.`, path, body, schema: { "@context": "https://schema.org", "@type": "ItemList", inLanguage: "en", numberOfItems: items.length, itemListElement: items.map((p, i) => ({ "@type": "ListItem", position: (number - 1) * 24 + i + 1, name: p.name, url: ORIGIN + projectPath(p.repo) })) } });
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
