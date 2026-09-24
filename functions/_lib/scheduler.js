let lastKick = 0;
export function ensureScheduler({ env, waitUntil }) {
  if (!env.CATALOG_SYNC || !waitUntil || Date.now() - lastKick < 5 * 60000) return;
  lastKick = Date.now();
  waitUntil(env.CATALOG_SYNC.fetch("https://catalog.internal/start", { method: "POST" }).then(response => {
    if (!response.ok) { lastKick = 0; console.error("scheduler wake-up failed", response.status); }
  }).catch(() => { lastKick = 0; console.error("scheduler wake-up unavailable"); }));
}
