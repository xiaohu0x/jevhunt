import { activeClause } from "../shared/catalog-data.js";
import { rssFeed } from "../shared/rss.js";

const CACHE_EPOCH = "rss-v1";

export async function onRequestGet(context) {
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const request = new Request(new URL("/rss.xml?__jh_cache=" + CACHE_EPOCH, context.request?.url || "https://jevhunt.com/").toString());
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  const { results } = await context.env.DB.prepare(`SELECT preview AS data FROM catalog_entries WHERE ${activeClause} AND json_extract(payload,'$.added') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' ORDER BY json_extract(payload,'$.added') DESC, stars DESC LIMIT 20`).all();
  const response = new Response(rssFeed(results.map(row => JSON.parse(row.data))), {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=300", "x-content-type-options": "nosniff" },
  });
  if (cache && context.waitUntil) context.waitUntil(cache.put(request, response.clone()).catch(() => {}));
  return response;
}
