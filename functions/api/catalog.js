import { catalogMeta, catalogRows } from "../../shared/catalog-data.js";
import { readCatalogQuery, catalogCacheRequest, readCatalogPage } from "../../shared/catalog-query.js";
import { ensureScheduler } from "../_lib/scheduler.js";
import { localizeCatalogProjects } from "../../shared/project-content-store.js";

async function queryMessages(env, url, query) {
  if (!query.q || query.locale === "en" || !env.ASSETS) return {};
  try {
    const response = await env.ASSETS.fetch(new URL(`/assets/locales/${query.locale}.json`, url));
    return response.ok ? (await response.json()).messages || {} : {};
  } catch { return {}; }
}

export async function onRequestGet({ request, env, waitUntil }) {
  ensureScheduler({ env, waitUntil });
  const url = new URL(request.url);
  const query = readCatalogQuery(url.searchParams);
  const cache = globalThis.caches?.default;
  const version = await env.DB.prepare("SELECT revision FROM catalog_control WHERE id=1").first();
  const cacheRequest = catalogCacheRequest(url, query, version?.revision);
  const cached = cache ? await cache.match(cacheRequest) : null;
  if (cached) return cached;
  const meta = await catalogMeta(env.DB);
  if (!meta) return Response.json({ error: "catalog_initializing" }, { status: 503, headers: { "cache-control": "no-store" } });
  const result = query.mode === "page"
    ? await readCatalogPage(env.DB, query, await queryMessages(env, url, query))
    : { rows: await catalogRows(env.DB, { limit: query.mode === "all" ? -1 : 20, full: query.full }) };
  const pagination = result.pagination ? `,"pagination":${JSON.stringify(result.pagination)}` : "";
  const apps = result.apps ? JSON.stringify(result.apps) : query.full ? `[${result.rows.map(row => row.data).join(",")}]`
    : JSON.stringify(await localizeCatalogProjects(env.DB, result.rows.map(row => JSON.parse(row.data)), query.locale));
  const response = new Response(`{"meta":${JSON.stringify(meta)},"apps":${apps}${pagination}}`, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60, s-maxage=120", "x-catalog-version": meta.catalogHash, "x-content-type-options": "nosniff" },
  });
  if (cache && waitUntil) waitUntil(cache.put(cacheRequest, response.clone()));
  return response;
}
