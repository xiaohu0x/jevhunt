import { catalogMeta } from "../../../shared/catalog-data.js";
import { json } from "../../_lib/auth.js";

export async function onRequestGet({ env }) {
  const meta = await catalogMeta(env.DB);
  const [control, recent, pending, oldest, review] = await env.DB.batch([
    env.DB.prepare("SELECT last_tick_at,last_scheduled_at,last_success_at,last_error FROM catalog_control WHERE id=1"),
    env.DB.prepare("SELECT started_at,finished_at,status,checked,published,message FROM catalog_runs ORDER BY started_at DESC LIMIT 20"),
    env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN due_at<=unixepoch() THEN 1 ELSE 0 END) AS ready FROM catalog_candidates"),
    env.DB.prepare("SELECT MIN(checked_at) AS oldest_checked_at FROM catalog_entries WHERE active=1"),
    env.DB.prepare("SELECT repo,attempts,last_error,due_at FROM catalog_candidates WHERE last_error IS NOT NULL ORDER BY due_at DESC LIMIT 50"),
  ]);
  return json({ meta, worker: control.results[0], runs: recent.results, candidates: pending.results[0], evidence: oldest.results[0], needsReview: review.results });
}
