import { activeClause, catalogMeta } from "../../../shared/catalog-data.js";
import { discoverySummary } from "../../../shared/discovery-status.js";
import sourceConfig from "../../../catalog/sources.json" with { type: "json" };
import { json } from "../../_lib/auth.js";

export async function onRequestGet({ env }) {
  const meta = await catalogMeta(env.DB);
  const [control, recent, pending, oldest, review] = await env.DB.batch([
    env.DB.prepare("SELECT last_tick_at,last_scheduled_at,last_success_at,last_error FROM catalog_control WHERE id=1"),
    env.DB.prepare("SELECT started_at,finished_at,status,checked,published,message FROM catalog_runs ORDER BY started_at DESC LIMIT 20"),
    env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN due_at<=unixepoch() THEN 1 ELSE 0 END) AS ready FROM catalog_candidates"),
    env.DB.prepare(`SELECT MIN(checked_at) AS oldest_checked_at, COUNT(*) AS total,
      SUM(CASE WHEN checked_at>=unixepoch()-86400 THEN 1 ELSE 0 END) AS checked24h,
      SUM(CASE WHEN checked_at>=unixepoch()-259200 THEN 1 ELSE 0 END) AS checked72h FROM catalog_entries WHERE ${activeClause}`),
    env.DB.prepare("SELECT repo,attempts,last_error,due_at FROM catalog_candidates WHERE last_error IS NOT NULL ORDER BY due_at DESC LIMIT 50"),
  ]);
  const discovery = discoverySummary(meta?.sources || [], sourceConfig.githubQueries);
  return json({ meta, discoveryStatus: discovery.discoveryStatus, discovery, worker: control.results[0], runs: recent.results,
    candidates: pending.results[0], evidence: oldest.results[0], needsReview: review.results });
}
