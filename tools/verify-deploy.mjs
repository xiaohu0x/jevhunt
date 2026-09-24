import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const origin = process.argv[2] || "https://jevhunt.com";
const expected = JSON.parse(readFileSync("public/build-info.json", "utf8"));
const fingerprint = text => createHash("sha256").update(text).digest("hex").slice(0, 20);
async function get(path, options = {}) {
  const url = new URL(path, origin);
  url.searchParams.set("release", expected.buildId);
  return fetch(url, { ...options, headers: { "Cache-Control": "no-cache", ...(options.headers || {}) }, signal: AbortSignal.timeout(20000) });
}
async function verify() {
  const response = await get("/build-info.json");
  if (!response.ok) throw new Error(`Build identity returned ${response.status}`);
  const actual = await response.json();
  if (actual.buildId !== expected.buildId || actual.catalogHash !== expected.catalogHash || actual.projectCount !== expected.projectCount) throw new Error("Production has not reached the expected build/catalog identity");
  for (let i = 0; i < expected.assets.length; i += 5) {
    await Promise.all(expected.assets.slice(i, i + 5).map(async asset => {
      const res = await get(asset.path);
      if (!res.ok || fingerprint(await res.text()) !== asset.hash) throw new Error(`Stale or modified asset: ${asset.path}`);
    }));
  }
  const health = await get("/api/health");
  const live = await health.json();
  if (!health.ok || live.mode !== "cloudflare-scheduler" || live.buildId !== expected.buildId || live.projectCount < 100) throw new Error("Database, scheduled worker or catalog health check failed");
  const catalog = await get("/api/catalog");
  const directory = await catalog.json();
  if (!catalog.ok || directory.apps?.length !== 20 || directory.meta?.mode !== "live-d1") throw new Error("Live catalog API failed");
  const detail = await get("/projects/" + directory.apps[0].repo.toLowerCase() + "/");
  if (!detail.ok || !(await detail.text()).includes(directory.apps[0].name)) throw new Error("Live project page failed");
  const home = await get("/");
  const html = await home.text();
  if (!home.ok || !html.includes('id="liveCatalogSeed"') || !html.includes('"mode":"live-d1"')) throw new Error("Server-rendered live catalog failed");
  const me = await get("/api/me");
  const identity = await me.json();
  if (!me.ok || identity.user !== null || !identity.authEnabled) throw new Error("Anonymous authentication check failed or Google OAuth is not configured");
  const admin = await get("/api/admin/submissions");
  if (admin.status !== 403) throw new Error("Anonymous moderation access was not denied");
  const logout = await get("/api/auth/logout", { method: "POST", headers: { Origin: new URL(origin).origin } });
  if (!logout.ok || !logout.headers.get("set-cookie")?.includes("Max-Age=0")) throw new Error("Logout cookie cleanup failed");
  const missing = await get("/this-route-must-not-exist-jevhunt-release-check/");
  if (missing.status !== 404) throw new Error("Unknown paths must return a real 404");
  if (new URL(origin).hostname === "jevhunt.com") {
    const canonical = await fetch("https://www.jevhunt.com/", { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (![301, 308].includes(canonical.status) || canonical.headers.get("location") !== "https://jevhunt.com/") throw new Error("www must redirect to the canonical origin");
  }
  return live;
}
let failure;
for (let attempt = 0; attempt < 8; attempt++) {
  try { const live = await verify(); console.log(`Verified production build ${expected.buildId}: ${live.projectCount} live projects, pages, API access control, D1 health and automatic scheduler heartbeat.`); failure = null; break; }
  catch (error) { failure = error; console.log(`Verification ${attempt + 1}/8: ${error.message}`); if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 5000)); }
}
if (failure) throw failure;
