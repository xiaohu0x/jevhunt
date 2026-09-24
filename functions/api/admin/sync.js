import { adminSession } from "../../_lib/admin.js";
import { sameOrigin, json } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "invalid_origin" }, { status: 403 });
  if (!await adminSession(request, env)) return json({ error: "forbidden" }, { status: 403 });
  if (!env.CATALOG_SYNC) return json({ error: "scheduler_unavailable" }, { status: 503 });
  return env.CATALOG_SYNC.fetch("https://catalog.internal/discover", { method: "POST" });
}
