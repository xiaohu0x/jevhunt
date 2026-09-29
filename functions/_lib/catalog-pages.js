import { catalogMeta, catalogRows, activeClause, CATEGORY_IDS, CATEGORY_NAMES } from "../../shared/catalog-data.js";
import { renderCard, renderProject, renderListing, htmlResponse } from "../../shared/catalog-view.js";
import { esc, jsonLd, page, projectPath, ORIGIN } from "../../shared/render.js";
import { ensureScheduler } from "./scheduler.js";
import { LOCALES } from "../../shared/locales.js";
import { readCatalogQuery, readCatalogPage } from "../../shared/catalog-query.js";
import { renderCatalogPagination } from "../../shared/catalog-pagination.js";

async function localeData(context, locale) {
  const response = await context.env.ASSETS.fetch(new URL(`/assets/locales/${locale}.json`, context.request.url));
  const data = response.ok ? await response.json() : {};
  return { data, messages: data.messages || {}, info: LOCALES[locale] || LOCALES.en };
}

export async function landing(context, locale = "en") {
  ensureScheduler(context);
  const response = await context.next();
  const meta = await catalogMeta(context.env.DB).catch(() => null);
  if (!meta || !response.ok) return response;
  const localized = await localeData(context, locale);
  const localeMessages = localized.messages;
  const query = { ...readCatalogQuery(new URL(context.request.url).searchParams), mode: "page", full: false, pageSize: 20, locale };
  const { apps, pagination } = await readCatalogPage(context.env.DB, query, localeMessages);
  const numbers = new Intl.NumberFormat(localized.info.lang);
  const shown = pagination.total ? `${numbers.format(pagination.start)}–${numbers.format(pagination.end)}` : "0";
  const count = (localeMessages["apps.count"] || "Showing {shown} of {total} projects").replace("{shown}", shown).replace("{total}", numbers.format(pagination.total));
  const timestamp = new Intl.DateTimeFormat(localized.info.lang, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(meta.syncedAt));
  const rewrite = new HTMLRewriter()
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
    .on("#catalogStructuredData", { element: el => el.setInnerContent(jsonLd({ "@context": "https://schema.org", "@type": "ItemList", "@id": ORIGIN + (locale === "en" ? "/" : `/${locale}/`) + "#projects",
      inLanguage: localized.data.lang || "en", name: localeMessages["apps.title"] || "Jev projects", numberOfItems: apps.length,
      itemListElement: apps.map((p, i) => ({ "@type": "ListItem", position: pagination.start + i, item: { "@type": "SoftwareSourceCode", name: p.name, url: ORIGIN + projectPath(p.repo, locale === "en" ? "" : `/${locale}`), codeRepository: "https://github.com/" + p.repo } })) }), { html: true }) });
  const result = rewrite.transform(response);
  const live = new Response(result.body, result);
  live.headers.set("cache-control", "public, max-age=0, s-maxage=60");
  live.headers.set("x-catalog-version", meta.catalogHash);
  return live;
}

export async function projectPage(context, locale = "en") {
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
  const [similarRows, localized] = await Promise.all([
    context.env.DB.prepare(`SELECT preview AS data FROM catalog_entries WHERE ${activeClause} AND category=? AND repo!=? ORDER BY CASE WHEN relationship=? THEN 0 ELSE 1 END, stars DESC LIMIT 6`).bind(p.cat, key, p.relationship || "unclassified").all(),
    localeData(context, locale),
  ]);
  const similar = similarRows.results.map(r => JSON.parse(r.data));
  const excluded = [key, ...similar.map(project => project.repo.toLowerCase())];
  const activeRows = await context.env.DB.prepare(`SELECT preview AS data FROM catalog_entries WHERE ${activeClause} AND repo NOT IN (${excluded.map(() => "?").join(",")}) AND json_extract(payload,'$.archived') = 0 AND json_extract(payload,'$.pushed') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(json_extract(payload,'$.pushed'), '+0 days') = json_extract(payload,'$.pushed') ORDER BY json_extract(payload,'$.pushed') DESC, stars DESC LIMIT 6`).bind(...excluded).all();
  return htmlResponse(renderProject(p, meta, similar, activeRows.results.map(r => JSON.parse(r.data)), localized.messages, { localeKey: locale, localeInfo: localized.info, localePrefix: prefix }));
}

export async function listingPage(context, category) {
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
