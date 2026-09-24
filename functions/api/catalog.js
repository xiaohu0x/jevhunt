import { catalogMeta, catalogRows } from "../../shared/catalog-data.js";
import { ensureScheduler } from "../_lib/scheduler.js";

export async function onRequestGet({ request, env, waitUntil }) {
  ensureScheduler({ env, waitUntil });
  const url = new URL(request.url);
  const cache = globalThis.caches?.default;
  const version = await env.DB.prepare("SELECT revision FROM catalog_control WHERE id=1").first();
  const key = new URL(url.origin + url.pathname);
  for (const field of ["all", "full"]) if (url.searchParams.get(field) === "1") key.searchParams.set(field, "1");
  key.searchParams.set("version", version?.revision || "initializing");
  const cacheRequest = new Request(key);
  const cached = cache ? await cache.match(cacheRequest) : null;
  if (cached) return cached;
  const meta = await catalogMeta(env.DB);
  if (!meta) return Response.json({ error: "catalog_initializing" }, { status: 503, headers: { "cache-control": "no-store" } });
  const all = url.searchParams.get("all") === "1";
  const rows = await catalogRows(env.DB, { limit: all ? -1 : 20, full: url.searchParams.get("full") === "1" });
  const response = new Response(`{"meta":${JSON.stringify(meta)},"apps":[${rows.map(row => row.data).join(",")}]}`, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60, s-maxage=120", "x-catalog-version": meta.catalogHash, "x-content-type-options": "nosniff" },
  });
  if (cache && waitUntil) waitUntil(cache.put(cacheRequest, response.clone()));
  return response;
}
