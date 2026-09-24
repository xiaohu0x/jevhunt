import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as stateHelpers from "../public/assets/js/catalog-state.js";

const read = file => readFileSync(`public/${file}`, "utf8");
async function boot(t, { storageBlocked = false, live = false } = {}) {
  const dom = new JSDOM(read("index.html"), { url: "https://jevhunt.com/", runScripts: "outside-only", pretendToBeVisual: true });
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
  for (const file of ["locales/en", "data", "projects"]) window.eval(read(`assets/js/${file}.js`));
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
  assert.equal(loads(), 0);
  assert.equal(document.getElementById("loadMore").hidden, false);
  assert.ok(document.querySelector("#auth a[href^='/api/auth/google']"));
  document.getElementById("themeBtn").click();
  assert.equal(document.documentElement.dataset.theme, "light");
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
