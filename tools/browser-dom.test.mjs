import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as stateHelpers from "../public/assets/js/catalog-state.js";

const read = file => readFileSync(`public/${file}`, "utf8");
async function boot(t, { storageBlocked = false, live = false, locale = "en" } = {}) {
  const path = locale === "en" ? "/" : `/${locale}/`;
  const dom = new JSDOM(read(path.slice(1) + "index.html"), { url: "https://jevhunt.com" + path, runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  Object.assign(window, stateHelpers);
  window.matchMedia = () => ({ matches: true });
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.Element.prototype.scrollIntoView = () => {};
  window.fetch = async path => {
    if (path === "/api/me") return Response.json({ user: null, authEnabled: true });
    if (live && path.startsWith("/api/catalog")) {
      const snapshot = JSON.parse(read("catalog.json"));
      const added = { ...snapshot.apps[0], repo: "live/new-jev-app", name: "runtime-only-project", stars: 1, desc: "A newly indexed project", relationship: "jev-app" };
      return Response.json({ meta: { ...snapshot.meta, mode: "live-d1", projectCount: snapshot.apps.length + 1 }, apps: [...snapshot.apps, added] });
    }
    throw new Error("Unexpected browser request: " + path);
  };
  if (storageBlocked) Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage blocked"); } });
  let catalogLoads = 0;
  window.__loadCatalog = async () => { catalogLoads++; window.eval(read("assets/js/catalog-all.js")); };
  for (const file of [`locales/${locale}`, "data", "projects"]) window.eval(read(`assets/js/${file}.js`));
  if (live) window.document.getElementById("liveCatalogSeed").textContent = JSON.stringify({ meta: { ...window.JH.catalogMeta, mode: "live-d1" }, apps: window.JH.apps });
  const script = read("assets/js/main.js").replace(/^import[^\n]+\n/, "")
    .replace('import("./catalog-all.js?v=" + encodeURIComponent(window.JH.catalogMeta.catalogHash))', "window.__loadCatalog()");
  window.eval(script);
  if (window.document.readyState === "loading") await new Promise(resolve => window.document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  await new Promise(resolve => setImmediate(resolve));
  return { window, document: window.document, loads: () => catalogLoads };
}

test("directory initializes with blocked browser storage and only the first page", async t => {
  const { document, window, loads } = await boot(t, { storageBlocked: true });
  assert.equal(document.querySelectorAll("#appGrid .card").length, 20);
  assert.equal(document.getElementById("statApps").dataset.count, String(window.JH.catalogMeta.projectCount));
  assert.equal(document.getElementById("catalogUpdated").dataset.iso, window.JH.catalogMeta.syncedAt);
  assert.match(document.getElementById("catalogUpdated").getAttribute("aria-label"), /Catalog updated .* UTC/);
  assert.equal(loads(), 0);
  assert.equal(document.getElementById("loadMore").hidden, false);
  assert.ok(document.querySelector('#dirFilters [data-cat="sdks"]'));
  assert.ok(document.querySelector('#dirFilters [data-cat="games"]'));
  document.getElementById("freshProjects").click();
  assert.equal(document.getElementById("dirSort").value, "updated-desc");
  assert.equal(document.getElementById("freshProjects").getAttribute("aria-pressed"), "true");
  assert.ok(document.querySelector("#auth a[href^='/api/auth/google']"));
  document.getElementById("themeBtn").click();
  assert.equal(document.documentElement.dataset.theme, "light");
});
test("a failed full catalog request keeps the preview usable and leaves loading state", async t => {
  const { document, window } = await boot(t);
  const originalLoad = window.__loadCatalog;
  window.__loadCatalog = async () => { throw new Error("network unavailable"); };
  const input = document.getElementById("dirSearch");
  input.value = "a-query-that-forces-the-full-index";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(document.getElementById("dirCount").textContent, window.JH.i18n.locales.en.messages["apps.loading"]);
  assert.equal(document.getElementById("dirEmpty").hidden, false);
  assert.ok(document.getElementById("toast").textContent.includes(window.JH.i18n.locales.en.messages["apps.loadFailed"]));
  window.__loadCatalog = originalLoad;
});
test("new locales initialize and search with translated labels and all 15 language options", async t => {
  for (const locale of ["ru", "hi", "id", "vi", "tr", "it"]) {
    const { document, window } = await boot(t, { locale });
    const messages = window.JH.i18n.locales[locale].messages;
    const select = document.getElementById("languageSelect");
    assert.equal(select.options.length, 15, locale);
    assert.equal(select.value, `/${locale}/`, locale);
    assert.equal(document.querySelector("#auth a").textContent.includes(messages["auth.continue"]), true, locale);
    assert.equal(document.getElementById("subDesc").getAttribute("aria-label"), messages["sub.desc"], locale);
    assert.match(document.getElementById("catalogUpdated").getAttribute("aria-label"), /UTC/);
    assert.ok(document.querySelector("#appGrid .card__site").textContent.includes(messages["apps.evidence"]), locale);
    const input = document.getElementById("dirSearch");
    input.value = "no-project-can-match-this-unique-query";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(document.getElementById("dirCount").textContent, messages["apps.loading"], locale);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.querySelectorAll("#appGrid .card").length, 0, locale);
    assert.equal(document.getElementById("dirEmpty").hidden, false, locale);
    assert.equal(document.getElementById("dirEmpty").textContent.trim(), messages["apps.empty"], locale);
    assert.equal(new URL(window.location.href).pathname, `/${locale}/`, locale);
  }
});
test("load more obtains the complete index once and preserves the displayed page in the URL", async t => {
  const { document, window, loads } = await boot(t);
  document.getElementById("loadMore").click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads(), 1);
  assert.equal(document.querySelectorAll("#appGrid .card").length, 40);
  assert.equal(new URL(window.location.href).searchParams.get("page"), "2");
  document.getElementById("loadMore").click();
  assert.equal(loads(), 1);
  assert.equal(document.querySelectorAll("#appGrid .card").length, 60);
});
test("typing a search loads matching projects and combines relationship filters", async t => {
  const { document, window, loads } = await boot(t);
  const input = document.getElementById("dirSearch");
  input.value = "jaredpalmer/kev";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads(), 1);
  assert.ok(document.querySelector('#appGrid .card__name[href="/projects/jaredpalmer/kev/"]'));
  const kind = document.getElementById("kindFilter");
  kind.value = "jev-app"; kind.dispatchEvent(new window.Event("change"));
  assert.equal(document.querySelector('#appGrid .card__name[href="/projects/jaredpalmer/kev/"]'), null);
  assert.equal(new URL(window.location.href).searchParams.get("kind"), "jev-app");
});

test("a new D1 project appears in search without changing any static catalog asset", async t => {
  const { document, window, loads } = await boot(t, { live: true });
  const input = document.getElementById("dirSearch");
  input.value = "runtime-only-project";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(document.querySelector('#appGrid .card__name[href="/projects/live/new-jev-app/"]'));
  assert.equal(loads(), 0, "The live API must not import the old static index");
  assert.equal(window.JH.catalogMeta.mode, "live-d1");
});
