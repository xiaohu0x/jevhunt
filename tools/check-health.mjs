const response = await fetch("https://jevhunt.com/api/health", { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000) });
const health = await response.json();
if (!response.ok || health.status !== "ok") throw new Error(`JevHunt health: ${health.status}; last check ${health.syncedAt || "unknown"}`);
console.log(`Healthy: ${health.projectCount} projects, checked ${health.syncedAt}, snapshot ${health.catalogHash}`);
