import { json } from "../_lib/auth.js";
import { catalogMeta } from "../../shared/catalog-data.js";
export async function onRequestGet({ env, request }) {
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    const response = await env.ASSETS.fetch(new URL("/build-info.json", request.url));
    if (!response.ok) throw new Error("build");
    const build = await response.json();
    const meta = await catalogMeta(env.DB);
    if (!meta) return json({ status: "initializing", buildId: build.buildId }, { status: 503 });
    const tickAge = meta.lastScheduledAt ? Date.now() - Date.parse(meta.lastScheduledAt) : Infinity;
    const sourcesFresh = meta.sources.some(source => source.lastSuccessAt && Date.now() - Date.parse(source.lastSuccessAt) < 24 * 3600_000);
    const fresh = tickAge < 10 * 60_000 && sourcesFresh;
    return json({ status: fresh ? "ok" : "stale", mode: "cloudflare-scheduler", buildId: build.buildId,
      catalogHash: meta.catalogHash, projectCount: meta.projectCount, syncedAt: meta.syncedAt,
      lastTickAt: meta.lastTickAt, lastScheduledAt: meta.lastScheduledAt, builtAt: build.builtAt }, { status: fresh ? 200 : 503 });
  } catch { return json({ status: "unavailable" }, { status: 503 }); }
}
