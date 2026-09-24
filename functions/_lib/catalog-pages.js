import { catalogMeta, catalogRows, activeClause, CATEGORY_IDS, CATEGORY_NAMES } from "../../shared/catalog-data.js";
import { renderCard, renderProject, renderListing, htmlResponse } from "../../shared/catalog-view.js";
import { esc, jsonLd, page, projectPath, ORIGIN } from "../../shared/render.js";
import { ensureScheduler } from "./scheduler.js";

export async function landing(context, locale = "en") {
  ensureScheduler(context);
  const response = await context.next();
  const meta = await catalogMeta(context.env.DB).catch(() => null);
  if (!meta || !response.ok) return response;
  const rows = await catalogRows(context.env.DB);
  const apps = rows.map(row => JSON.parse(row.data));
  const localeResponse = await context.env.ASSETS.fetch(new URL(`/assets/locales/${locale}.json`, context.request.url));
  const localeData = localeResponse.ok ? await localeResponse.json() : {};
  const messages = localeData.messages || {};
  const count = (messages["apps.count"] || "Showing {shown} of {total} projects").replace("{shown}", String(apps.length)).replace("{total}", String(meta.projectCount));
  const rewrite = new HTMLRewriter()
    .on("#appGrid", { element: el => el.setInnerContent(apps.map(p => renderCard(p, messages)).join(""), { html: true }) })
    .on("#dirCount", { element: el => el.setInnerContent(count) })
    .on("#statApps", { element: el => { el.setAttribute("data-count", String(meta.projectCount)); el.setInnerContent(String(meta.projectCount)); } })
    .on("#statStars", { element: el => { el.setAttribute("data-count", String(meta.totalStars)); el.setInnerContent(String(meta.totalStars)); } })
    .on("#catalogUpdated", { element: el => el.setInnerContent(meta.syncedAt.slice(0, 10)) })
    .on("#liveCatalogSeed", { element: el => el.setInnerContent(jsonLd({ meta, apps }), { html: true }) })
    .on("#catalogStructuredData", { element: el => el.setInnerContent(jsonLd({ "@context": "https://schema.org", "@type": "ItemList", "@id": ORIGIN + (locale === "en" ? "/" : `/${locale}/`) + "#projects",
      inLanguage: localeData.lang || "en", name: messages["apps.title"] || "Jev projects", numberOfItems: apps.length,
      itemListElement: apps.map((p, i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": "SoftwareSourceCode", name: p.name, url: ORIGIN + projectPath(p.repo), codeRepository: "https://github.com/" + p.repo } })) }), { html: true }) });
  const result = rewrite.transform(response);
  const live = new Response(result.body, result);
  live.headers.set("cache-control", "public, max-age=0, s-maxage=60");
  live.headers.set("x-catalog-version", meta.catalogHash);
  return live;
}

export async function projectPage(context) {
  const owner = String(context.params.owner), name = String(context.params.repo);
  const key = `${owner}/${name}`.toLowerCase();
  if (!/^[a-z0-9-]+\/[a-z0-9._-]+$/.test(key)) return missing(context);
  const alias = await context.env.DB.prepare("SELECT new_repo FROM catalog_aliases WHERE old_repo=?").bind(key).first();
  if (alias) return Response.redirect(new URL(projectPath(alias.new_repo), context.request.url).href, 301);
  const row = await context.env.DB.prepare(`SELECT payload FROM catalog_entries WHERE repo=? AND ${activeClause}`).bind(key).first();
  if (!row) {
    const exists = await context.env.DB.prepare("SELECT name FROM catalog_entries WHERE repo=?").bind(key).first();
    if (exists) return htmlResponse(page({ title: exists.name + " — unavailable", description: "This listing is currently unavailable or awaiting review.", path: projectPath(key), noindex: true, body: `<h1>${esc(exists.name)}</h1><p>This listing is unavailable or has been withdrawn. It is excluded from the active directory.</p><a href="/browse/">Browse available projects →</a>` }), { status: 410 });
    return missing(context);
  }
  const p = JSON.parse(row.payload), meta = await catalogMeta(context.env.DB);
  const related = await context.env.DB.prepare(`SELECT preview AS data FROM catalog_entries WHERE ${activeClause} AND category=? AND repo!=? ORDER BY stars DESC LIMIT 4`).bind(p.cat, key).all();
  return htmlResponse(renderProject(p, meta, related.results.map(r => JSON.parse(r.data))));
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
