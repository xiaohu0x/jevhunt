import { catalogMeta, catalogRows, catalogRecentPushed, activeClause, CATEGORY_IDS, CATEGORY_NAMES } from "../../shared/catalog-data.js";
import { renderCard, renderProject, renderListing, htmlResponse } from "../../shared/catalog-view.js";
import { esc, jsonLd, page, projectPath, ORIGIN } from "../../shared/render.js";
import { ensureScheduler } from "./scheduler.js";
import { LOCALES } from "../../shared/locales.js";
import { readCatalogQuery, readCatalogPage } from "../../shared/catalog-query.js";
import { renderCatalogPagination } from "../../shared/catalog-pagination.js";
import { readProjectContent, localizeCatalogProjects } from "../../shared/project-content-store.js";
import { FEATURED_WHERE, FEATURED_ORDER_SQL } from "../../shared/catalog-featured.js";
import { taskCardsHtml, featuredCardsHtml, newListHtml, categoryCardsHtml, CATEGORIES } from "../../shared/catalog-sections.js";
import { taskById, taskClause } from "../../shared/catalog-tasks.js";
import { categoriesIndexView, tasksIndexView, taskPageView } from "../../shared/catalog-section-pages.js";
import { compareView, alternativesView, pickAlternatives } from "../../shared/catalog-compare.js";
import { collectionsIndexView, collectionPageView } from "../../shared/catalog-collection-pages.js";
import { COLLECTION_LIST, collectionById, collectionWhere } from "../../shared/catalog-collections.js";
import { isFeatured } from "../../shared/catalog-featured.js";


const CACHE_EPOCH = "edge-v1";

/** Anonymous HTML is the same for every visitor: cache it at the edge per catalog revision. */
async function cachedPage(context, key, build, ttl = 300) {
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  if (!cache) return build();
  const url = new URL(context.request?.url || "https://jevhunt.com/");
  url.searchParams.set("__jh_cache", `${CACHE_EPOCH}:${context.env?.CF_PAGES_COMMIT_SHA || "dev"}:${key}`);
  const request = new Request(url.toString(), { method: "GET", headers: { accept: "text/html" } });
  const hit = await cache.match(request);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set("x-jh-cache", "hit");
    return response;
  }
  const response = await build();
  if (!response || response.status !== 200) return response;
  const copy = new Response(response.body, response);
  copy.headers.set("cache-control", `public, max-age=0, s-maxage=${ttl}`);
  copy.headers.set("x-jh-cache", "miss");
  if (context.waitUntil) context.waitUntil(cache.put(request, copy.clone()).catch(() => {}));
  return copy;
}

async function localeData(context, locale) {
  const response = await context.env.ASSETS.fetch(new URL(`/assets/locales/${locale}.json`, context.request.url));
  const data = response.ok ? await response.json() : {};
  return { data, messages: data.messages || {}, info: LOCALES[locale] || LOCALES.en };
}

async function landingUncached(context, locale = "en") {
  ensureScheduler(context);
  const response = await context.next();
  const meta = await catalogMeta(context.env.DB).catch(() => null);
  if (!meta || !response.ok) return response;
  const localized = await localeData(context, locale);
  const localeMessages = localized.messages;
  const query = { ...readCatalogQuery(new URL(context.request?.url || "https://jevhunt.com/").searchParams), mode: "page", full: false, pageSize: 20, locale };
  const { apps, pagination } = await readCatalogPage(context.env.DB, query, localeMessages);
  const [featuredRows, freshRows] = await Promise.all([
    context.env.DB.prepare(`SELECT preview AS data FROM catalog_entries WHERE ${activeClause} AND ${FEATURED_WHERE} ORDER BY ${FEATURED_ORDER_SQL} LIMIT 6`).all(),
    context.env.DB.prepare(`SELECT preview AS data FROM catalog_entries WHERE ${activeClause} AND json_extract(payload,'$.added') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' ORDER BY json_extract(payload,'$.added') DESC, stars DESC LIMIT 6`).all(),
  ]);
  let featured = featuredRows.results.map(row => JSON.parse(row.data));
  let fresh = freshRows.results.map(row => JSON.parse(row.data));
  if (locale !== "en" && (featured.length || fresh.length)) {
    [featured, fresh] = await Promise.all([
      localizeCatalogProjects(context.env.DB, featured, locale),
      localizeCatalogProjects(context.env.DB, fresh, locale),
    ]);
  }
  const sectionBase = locale === "en" ? "" : `/${locale}`;
  const sectionLang = localized.info.lang || "en";
  query.page = pagination.page;
  const t = (key, fallback) => localeMessages[key] || fallback;
  const numbers = new Intl.NumberFormat(localized.info.lang);
  const shown = pagination.total ? `${numbers.format(pagination.start)}–${numbers.format(pagination.end)}` : "0";
  const count = (localeMessages["apps.count"] || "Showing {shown} of {total} projects").replace("{shown}", shown).replace("{total}", numbers.format(pagination.total));
  const timestamp = new Intl.DateTimeFormat(localized.info.lang, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(meta.syncedAt));
  const homeUrl = ORIGIN + localized.info.path;
  const documentUrl = new URL(homeUrl);
  const filtered = !!query.q || ["category", "kind", "language", "activity"].some(key => query[key] !== "all") || query.sort !== "stars-desc";
  for (const key of ["q", "category", "kind", "language", "activity", "sort"]) {
    if (query[key] !== (key === "q" ? "" : key === "sort" ? "stars-desc" : "all")) documentUrl.searchParams.set(key, query[key]);
  }
  if (pagination.page > 1) documentUrl.searchParams.set("page", String(pagination.page));
  const pageUrl = documentUrl.href;
  const canonical = filtered ? homeUrl : pageUrl;
  const pageLabel = t("apps.page", "Page {page} of {pages}").replace("{page}", numbers.format(pagination.page)).replace("{pages}", numbers.format(pagination.totalPages));
  // Keep the localized editorial metadata while giving each paginated collection its own identity.
  const source = await response.clone().text();
  const decode = value => value.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity]);
  const baseTitle = decode(source.match(/<title>([^<]*)<\/title>/i)?.[1] || t("apps.title", "Jev projects"));
  const title = !filtered && pagination.page > 1 ? `${baseTitle.replace(/\s*[|·]\s*JevHunt$/, "")} — ${pageLabel} | JevHunt` : baseTitle;
  let siteSchema;
  try { siteSchema = JSON.parse(source.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)?.[1] || "null"); } catch { /* Leave unrelated malformed source metadata untouched. */ }
  for (const node of siteSchema?.["@graph"] || []) {
    if (node["@type"] === "WebSite") { node.url = homeUrl; node["@id"] = homeUrl + "#website"; }
    if (node["@type"] === "CollectionPage") {
      node.url = pageUrl; node["@id"] = pageUrl + "#directory"; node.isPartOf = { "@id": homeUrl + "#website" };
      if (!filtered && pagination.page > 1) node.name = `${node.name} — ${pageLabel}`;
    }
  }
  const categories = [{ id: "all", name: t("apps.all", "All") }, ...CATEGORY_IDS.filter(id => Object.hasOwn(meta.categoryCounts, id)).map((id, i) => ({ id, name: t(`category.${id}.name`, CATEGORY_NAMES[CATEGORY_IDS.indexOf(id)]) }))];
  const languages = [...new Set(["all", ...meta.languages, query.language])];
  const selectedOption = selected => ({ element: el => {
    if (el.getAttribute("value") === selected) el.setAttribute("selected", ""); else el.removeAttribute("selected");
  } });
  const rewrite = new HTMLRewriter()
    .on("title", { element: el => el.setInnerContent(title) })
    .on('link[rel="canonical"]', { element: el => el.setAttribute("href", canonical) })
    .on('meta[property="og:url"]', { element: el => el.setAttribute("content", pageUrl) })
    .on('meta[property="og:title"], meta[name="twitter:title"]', { element: el => el.setAttribute("content", title) })
    .on('meta[name="robots"]', { element: el => { if (filtered) el.setAttribute("content", "noindex, follow"); } })
    .on('link[rel="alternate"][hreflang]', { element: el => {
      if (filtered) { el.remove(); return; }
      const alternate = new URL(el.getAttribute("href"));
      if (pagination.page > 1) alternate.searchParams.set("page", String(pagination.page)); else alternate.searchParams.delete("page");
      el.setAttribute("href", alternate.href);
    } })
    .on('script[type="application/ld+json"]:not([id])', { element: el => { if (siteSchema) el.setInnerContent(jsonLd(siteSchema), { html: true }); } })
    .on("#dirSearch", { element: el => el.setAttribute("value", query.q) })
    .on("#dirFilters", { element: el => el.setInnerContent(categories.map(category => `<button class="fchip${query.category === category.id ? " is-active" : ""}" data-cat="${esc(category.id)}" aria-pressed="${query.category === category.id}">${esc(category.name)}<span class="fchip__count">${numbers.format(category.id === "all" ? meta.projectCount : meta.categoryCounts[category.id] || 0)}</span></button>`).join(""), { html: true }) })
    .on("#languageFilter", { element: el => el.setInnerContent(languages.map(language => `<option value="${esc(language)}"${query.language === language ? " selected" : ""}>${esc(language === "all" ? t("apps.allLanguages", "All languages") : language === "unknown" ? t("apps.unknownLanguage", "Not reported") : language)}</option>`).join(""), { html: true }) })
    .on("#kindFilter option", selectedOption(query.kind))
    .on("#activityFilter option", selectedOption(query.activity))
    .on("#dirSort option", selectedOption(query.sort))
    .on("#taskGrid", { element: el => el.setInnerContent(taskCardsHtml({ localeKey: locale }), { html: true }) })
    .on("#featuredGrid", { element: el => el.setInnerContent(featuredCardsHtml(featured, localeMessages, { basePath: sectionBase, locale: sectionLang }), { html: true }) })
    .on("#newGrid", { element: el => el.setInnerContent(newListHtml(fresh, localeMessages, { basePath: sectionBase, locale, lang: sectionLang }), { html: true }) })
    .on("#categoryGrid", { element: el => el.setInnerContent(categoryCardsHtml(meta.categoryCounts, localeMessages, { localePrefix: sectionBase, lang: sectionLang }), { html: true }) })
    .on("#appGrid", { element: el => el.setInnerContent(apps.map(p => renderCard(p, localeMessages, { basePath: locale === "en" ? "" : `/${locale}` })).join(""), { html: true }) })
    .on("#dirCount", { element: el => el.setInnerContent(count) })
    .on("#dirEmpty", { element: el => { if (pagination.total) el.setAttribute("hidden", ""); else el.removeAttribute("hidden"); } })
    .on("#directoryPagesBottom", { element: el => {
      el.setAttribute("aria-label", (localeMessages["apps.page"] || "Page {page} of {pages}").replace("{page}", pagination.page).replace("{pages}", pagination.totalPages));
      el.setInnerContent(renderCatalogPagination(context.request.url, pagination, localeMessages), { html: true });
    } })
    .on("#statApps", { element: el => { el.setAttribute("data-count", String(meta.projectCount)); el.setInnerContent(String(meta.projectCount)); } })
    .on("#statStars", { element: el => { el.setAttribute("data-count", String(meta.totalStars)); el.setInnerContent(String(meta.totalStars)); } })
    .on("#catalogUpdated", { element: el => {
      el.setAttribute("data-iso", meta.syncedAt);
      el.setAttribute("datetime", meta.syncedAt);
      el.setAttribute("title", (localeMessages["stat.updatedAt"] || "Catalog updated {date} UTC").replace("{date}", timestamp));
      el.setInnerContent(timestamp + " UTC");
    } })
    .on("#liveCatalogSeed", { element: el => el.setInnerContent(jsonLd({ meta, apps, pagination, query }), { html: true }) })
    .on("#catalogStructuredData", { element: el => el.setInnerContent(jsonLd({ "@context": "https://schema.org", "@type": "ItemList", "@id": pageUrl + "#projects",
      inLanguage: localized.data.lang || "en", name: localeMessages["apps.title"] || "Jev projects", numberOfItems: apps.length,
      itemListElement: apps.map((p, i) => ({ "@type": "ListItem", position: pagination.start + i, item: { "@type": "SoftwareSourceCode", name: p.name, url: ORIGIN + projectPath(p.repo, locale === "en" ? "" : `/${locale}`), codeRepository: "https://github.com/" + p.repo } })) }), { html: true }) });
  const result = rewrite.transform(response);
  const live = new Response(result.body, result);
  live.headers.set("cache-control", "public, max-age=0, s-maxage=60");
  live.headers.set("x-catalog-version", meta.catalogHash);
  return live;
}

async function projectPageUncached(context, locale = "en") {
  const owner = String(context.params.owner), name = String(context.params.repo);
  const key = `${owner}/${name}`.toLowerCase();
  const prefix = locale === "en" ? "" : `/${locale}`;
  if (!/^[a-z0-9-]+\/[a-z0-9._-]+$/.test(key)) return missing(context);
  const alias = await context.env.DB.prepare("SELECT new_repo FROM catalog_aliases WHERE old_repo=?").bind(key).first();
  if (alias) return Response.redirect(new URL(projectPath(alias.new_repo, prefix), context.request.url).href, 301);
  const row = await context.env.DB.prepare(`SELECT payload FROM catalog_entries WHERE repo=? AND ${activeClause}`).bind(key).first();
  if (!row) {
    const exists = await context.env.DB.prepare("SELECT name FROM catalog_entries WHERE repo=?").bind(key).first();
    if (exists) {
      const localized = await localeData(context, locale);
      return htmlResponse(page({ title: exists.name + " — unavailable", description: "This listing is currently unavailable or awaiting review.", path: projectPath(key, prefix), noindex: true, messages: localized.messages, localeKey: locale, localeInfo: localized.info, localePrefix: prefix, body: `<h1>${esc(exists.name)}</h1><p>${esc(localized.messages["project.unavailableBody"] || "This listing is unavailable or has been withdrawn. It is excluded from the active directory.")}</p><a href="${prefix ? `${prefix}/#apps` : "/browse/"}">${esc(localized.messages["project.browse"] || "Browse available projects →")}</a>` }), { status: 410 });
    }
    return missing(context);
  }
  const p = JSON.parse(row.payload), meta = await catalogMeta(context.env.DB);
  const [similarRows, localized, sameName, content, recentlyPushed] = await Promise.all([
    context.env.DB.prepare(`SELECT preview AS data FROM catalog_entries WHERE ${activeClause} AND category=? AND repo!=? ORDER BY CASE WHEN relationship=? THEN 0 ELSE 1 END, stars DESC LIMIT 6`).bind(p.cat, key, p.relationship || "unclassified").all(),
    localeData(context, locale),
    context.env.DB.prepare(`SELECT repo FROM catalog_entries WHERE name = ? COLLATE NOCASE AND repo != ? AND ${activeClause} LIMIT 1`).bind(p.name, key).first(),
    readProjectContent(context.env.DB, p),
    catalogRecentPushed(context.env.DB),
  ]);
  const similar = similarRows.results.map(r => JSON.parse(r.data));
  const excluded = new Set([key, ...similar.map(project => project.repo.toLowerCase())]);
  // The snapshot already carries the newest active projects, so this is a filter
  // instead of a fourth full catalogue scan per project page.
  const active = recentlyPushed.filter(project => !excluded.has(project.repo.toLowerCase())).slice(0, 6);
  const localizedRecommendations = await localizeCatalogProjects(context.env.DB, [...similar, ...active], locale);
  return htmlResponse(renderProject(p, meta, localizedRecommendations.slice(0, similar.length), localizedRecommendations.slice(similar.length), localized.messages, { localeKey: locale, localeInfo: localized.info, localePrefix: prefix, duplicateName: !!sameName, content }));
}

async function listingPageUncached(context, category) {
  if (category && !CATEGORY_IDS.includes(category)) return missing(context);
  const tail = context.params.page;
  const raw = Array.isArray(tail) ? tail.join("/") : tail || "1";
  if (raw && !/^\d+$/.test(raw)) return missing(context);
  const number = Number(raw || 1);
  const meta = await catalogMeta(context.env.DB);
  if (!meta) return context.next();
  const total = category ? meta.categoryCounts[category] || 0 : meta.projectCount;
  if (number < 1 || number > Math.max(1, Math.ceil(total / 24))) return missing(context);
  const rows = await catalogRows(context.env.DB, { category, limit: 24, offset: (number - 1) * 24 });
  return htmlResponse(renderListing(rows.map(r => JSON.parse(r.data)), { number, total,
    base: category ? `/categories/${category}/` : "/browse/", title: category ? CATEGORY_NAMES[CATEGORY_IDS.indexOf(category)] + " for Jev" : "Jev ecosystem projects" }));
}

export async function missing(context) {
  const response = await context.env.ASSETS.fetch(new URL("/404.html", context.request.url));
  return new Response(response.body, { status: 404, headers: response.headers });
}

/** /categories/ — the missing index that made 400 category pages near-orphans. */
async function categoriesIndexUncached(context) {
  const meta = await catalogMeta(context.env.DB).catch(() => null);
  if (!meta) return context.next();
  const ids = CATEGORIES.map(category => category.id).filter(id => Object.hasOwn(meta.categoryCounts, id));
  const rows = await Promise.all(ids.map(id => context.env.DB
    .prepare(`SELECT preview AS data FROM catalog_entries WHERE ${activeClause} AND category=? ORDER BY stars DESC, name COLLATE NOCASE LIMIT 3`)
    .bind(id).all()));
  const samples = Object.fromEntries(ids.map((id, index) => [id, rows[index].results.map(row => JSON.parse(row.data))]));
  return htmlResponse(page(categoriesIndexView({ projectCount: meta.projectCount, categoryCounts: meta.categoryCounts, samples })));
}

/** /tasks/ — discovery by intent ("what do you want to build?"). */
async function tasksIndexUncached(context) {
  const meta = await catalogMeta(context.env.DB).catch(() => null);
  if (!meta) return context.next();
  return htmlResponse(page(tasksIndexView({ projectCount: meta.projectCount })));
}

/** /tasks/<id>/ and /tasks/<id>/<page>/ — paginated task listings rendered from D1. */
async function taskPageUncached(context, taskId) {
  const task = taskById(taskId);
  if (!task) return missing(context);
  const tail = context.params.page;
  const raw = Array.isArray(tail) ? tail.join("/") : tail || "1";
  if (raw && !/^\d+$/.test(raw)) return missing(context);
  const number = Number(raw || 1);
  const meta = await catalogMeta(context.env.DB).catch(() => null);
  if (!meta) return context.next();
  const { sql, values } = taskClause(task);
  const where = `${activeClause} AND ${sql}`;
  const [countRow, rows] = await Promise.all([
    context.env.DB.prepare(`SELECT COUNT(*) AS n FROM catalog_entries WHERE ${where}`).bind(...values).first(),
    context.env.DB.prepare(`SELECT preview AS data FROM catalog_entries WHERE ${where} ORDER BY stars DESC, name COLLATE NOCASE LIMIT 24 OFFSET ?`).bind(...values, (number - 1) * 24).all(),
  ]);
  const total = Number(countRow?.n || 0);
  const pages = Math.max(1, Math.ceil(total / 24));
  if (number < 1 || number > pages) return missing(context);
  const projects = rows.results.map(row => JSON.parse(row.data));
  return htmlResponse(page(taskPageView({ task, projects, total, number, pages })));
}


/** /compare/?ids=owner/repo,owner/repo2 — noindex comparison table. */
async function comparePageUncached(context) {
  const url = new URL(context.request?.url || "https://jevhunt.com/");
  const ids = String(url.searchParams.get("ids") || "").split(",").slice(0, 3).map(value => value.trim().toLowerCase()).filter(Boolean);
  let projects = [];
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const { results } = await context.env.DB.prepare(`SELECT payload AS data FROM catalog_entries WHERE repo IN (${placeholders}) AND ${activeClause}`).bind(...ids).all();
    const byRepo = new Map(results.map(row => { const project = JSON.parse(row.data); return [project.repo.toLowerCase(), project]; }));
    projects = ids.map(id => byRepo.get(id)).filter(Boolean);
  }
  return htmlResponse(page(compareView({ projects })));
}

/** /alternatives/<owner>/<repo>/ — indexable for featured or reviewed projects only. */
async function alternativesPageUncached(context) {
  const key = `${context.params.owner}/${context.params.repo}`.toLowerCase();
  if (!/^[a-z0-9-]+\/[a-z0-9._-]+$/.test(key)) return missing(context);
  const row = await context.env.DB.prepare(`SELECT payload FROM catalog_entries WHERE repo=? AND ${activeClause}`).bind(key).first();
  if (!row) return missing(context);
  const project = JSON.parse(row.payload);
  const [{ results }, reviewed] = await Promise.all([
    context.env.DB.prepare(`SELECT payload AS data FROM catalog_entries WHERE ${activeClause} AND category=? AND repo!=? ORDER BY stars DESC, name COLLATE NOCASE LIMIT 40`).bind(project.cat, key).all(),
    context.env.DB.prepare("SELECT 1 AS present FROM project_content WHERE repo=? LIMIT 1").bind(key).first(),
  ]);
  const alternatives = pickAlternatives(project, results.map(item => JSON.parse(item.data)), 10);
  const view = alternativesView({ project, alternatives, categoryName: CATEGORY_NAMES[CATEGORY_IDS.indexOf(project.cat)] || project.cat });
  if (!reviewed && !isFeatured(project)) view.noindex = true;
  return htmlResponse(page(view));
}

/* Public entry points. The anonymous HTML is identical for every visitor, so
   check the edge cache before touching D1 and only render on a miss. */
export function landing(context, locale = "en") {
  ensureScheduler(context);
  return cachedPage(context, `home:${locale}:${new URL(context.request?.url || "https://jevhunt.com/").search}`, () => landingUncached(context, locale), 120);
}

export function projectPage(context, locale = "en") {
  const key = `${context.params.owner}/${context.params.repo}`.toLowerCase();
  return cachedPage(context, `project:${locale}:${key}`, () => projectPageUncached(context, locale), 300);
}

export function listingPage(context, category) {
  return cachedPage(context, `listing:${new URL(context.request?.url || "https://jevhunt.com/").pathname}`, () => listingPageUncached(context, category), 120);
}

export function categoriesIndex(context) {
  return cachedPage(context, "categories", () => categoriesIndexUncached(context), 300);
}

export function tasksIndex(context) {
  return cachedPage(context, "tasks", () => tasksIndexUncached(context), 300);
}

export function taskPage(context, taskId) {
  return cachedPage(context, `task:${taskId}:${new URL(context.request?.url || "https://jevhunt.com/").pathname}`, () => taskPageUncached(context, taskId), 300);
}

export function comparePage(context) {
  const ids = new URL(context.request?.url || "https://jevhunt.com/").searchParams.get("ids") || "";
  return cachedPage(context, `compare:${ids}`, () => comparePageUncached(context), 60);
}

export function alternativesPage(context) {
  const key = `${context.params.owner}/${context.params.repo}`.toLowerCase();
  return cachedPage(context, `alternatives:${key}`, () => alternativesPageUncached(context), 300);
}


async function collectionsIndexUncached(context) {
  const meta = await catalogMeta(context.env.DB).catch(() => null);
  if (!meta) return context.next();
  const counts = Object.fromEntries(await Promise.all(COLLECTION_LIST.map(async collection => {
    const where = collectionWhere(collection);
    const row = await context.env.DB.prepare(`SELECT COUNT(*) AS n FROM catalog_entries WHERE ${activeClause} AND ${where.sql}`).bind(...where.values).first();
    return [collection.id, Number(row?.n || 0)];
  })));
  return htmlResponse(page(collectionsIndexView({ projectCount: meta.projectCount, counts })));
}

async function collectionPageUncached(context, collectionId) {
  const collection = collectionById(collectionId);
  if (!collection) return missing(context);
  const tail = context.params.page;
  const raw = Array.isArray(tail) ? tail.join("/") : tail || "1";
  if (raw && !/^\d+$/.test(raw)) return missing(context);
  const number = Number(raw || 1);
  const meta = await catalogMeta(context.env.DB).catch(() => null);
  if (!meta) return context.next();
  const where = collectionWhere(collection);
  const clause = `${activeClause} AND ${where.sql}`;
  const [countRow, rows] = await Promise.all([
    context.env.DB.prepare(`SELECT COUNT(*) AS n FROM catalog_entries WHERE ${clause}`).bind(...where.values).first(),
    context.env.DB.prepare(`SELECT preview AS data FROM catalog_entries WHERE ${clause} ORDER BY stars DESC, name COLLATE NOCASE LIMIT 24 OFFSET ?`).bind(...where.values, (number - 1) * 24).all(),
  ]);
  const total = Number(countRow?.n || 0);
  const pages = Math.max(1, Math.ceil(total / 24));
  if (number < 1 || number > pages) return missing(context);
  const projects = rows.results.map(row => JSON.parse(row.data));
  return htmlResponse(page(collectionPageView({ collection, projects, total, number, pages })));
}

export function collectionsIndex(context) {
  return cachedPage(context, "collections", () => collectionsIndexUncached(context), 300);
}

export function collectionPage(context, collectionId) {
  const pathname = new URL(context.request?.url || "https://jevhunt.com/").pathname;
  return cachedPage(context, `collection:${collectionId}:${pathname}`, () => collectionPageUncached(context, collectionId), 300);
}
