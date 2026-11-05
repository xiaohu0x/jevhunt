import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { EDITORIAL_ROUTES } from "../shared/editorial-routes.js";
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
  if (actual.mode !== "static" || actual.runtimeDatabase !== false || actual.runtimeWorker !== false) throw new Error("Release is not static-only");
  if (actual.syncSchedule !== "manual" || actual.dailySelection?.max !== 8) throw new Error("Manual synchronization and daily selection limits must be preserved");
  const catalog = await get("/catalog.json");
  const directory = await catalog.json();
  if (!catalog.ok || directory.apps?.length !== expected.projectCount) throw new Error("Static catalog failed");
  const featured = [...directory.apps].sort((a, b) => b.stars - a.stars)[0];
  const detail = await get("/projects/" + featured.repo.toLowerCase() + "/");
  if (!detail.ok || !(await detail.text()).includes(featured.name)) throw new Error("Static project page failed");
  const translated = await get("/zh-cn/projects/tauricresearch/tradingagents/", { redirect: "manual" });
  if (translated.status !== 200 || !(await translated.text()).includes('lang="zh-CN"')) throw new Error("Translated static page must render at its canonical URL");
  const home = await get("/");
  const html = await home.text();
  if (!home.ok || !html.includes('data-catalog-mode="static"') || /id="(?:auth|submitForm)"/.test(html)) throw new Error("Static homepage failed");
  if (!html.includes('data-daily-source="/assets/daily-picks.json?v=') || !html.includes('data-i18n="daily.lead"')) throw new Error("Static daily selection missing");
  const boardDom = new JSDOM(html);
  const board = boardDom.window.document.querySelector('#launchBoard');
  if (board?.querySelectorAll('.launch-pulse__day').length !== 30 || board.querySelectorAll('.launch-day').length !== 3) throw new Error('Daily history must render before JavaScript loads');
  boardDom.window.close();
  for (const path of ["/api/health", "/api/catalog", "/api/me", "/api/admin/submissions"]) {
    if ((await get(path)).status !== 404) throw new Error("Legacy API is still reachable: " + path);
  }
  const missing = await get("/this-route-must-not-exist-jevhunt-release-check/");
  if (missing.status !== 404) throw new Error("Unknown paths must return a real 404");
  const sitemapResponse = await get("/sitemap.xml");
  if (!sitemapResponse.ok) throw new Error("Editorial sitemap request failed");
  const sitemap = new JSDOM(await sitemapResponse.text(), { contentType: "application/xml" });
  const urls = new Set([...sitemap.window.document.getElementsByTagName("loc")].map(element => element.textContent));
  sitemap.window.close();
  for (const { path } of EDITORIAL_ROUTES) if (!urls.has("https://jevhunt.com" + path)) throw new Error("Missing editorial sitemap URL: " + path);
  const screenshot = await get("/assets/images/jev-showcase.png");
  const screenshotBytes = Buffer.from(await screenshot.arrayBuffer());
  if (!screenshot.ok || screenshotBytes.subarray(1, 4).toString() !== "PNG" || fingerprint(screenshotBytes) !== fingerprint(readFileSync("public/assets/images/jev-showcase.png"))) throw new Error("Editorial screenshot missing or modified");
  if (new URL(origin).hostname === "jevhunt.com") {
    const canonical = await fetch("https://www.jevhunt.com/", { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (![301, 308].includes(canonical.status) || canonical.headers.get("location") !== "https://jevhunt.com/") throw new Error("www must redirect to the canonical origin");
  }
  return actual;
}
let failure;
for (let attempt = 0; attempt < 8; attempt++) {
  try { const live = await verify(); console.log(`Verified ${origin} build ${expected.buildId}: ${live.projectCount} catalog projects, ${EDITORIAL_ROUTES.length} editorial routes, sitemap, screenshot and disabled legacy APIs.`); failure = null; break; }
  catch (error) { failure = error; console.log(`Verification ${attempt + 1}/8: ${error.message}`); if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 5000)); }
}
if (failure) throw failure;
