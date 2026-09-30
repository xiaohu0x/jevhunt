import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as stateHelpers from "../public/assets/js/catalog-state.js";
import * as localeHelpers from "../public/assets/js/catalog-locales.js";
import { renderProjectCard } from "../public/assets/js/project-card.js";
import { readCatalogQuery } from "../shared/catalog-query.js";
import { loadProjectContents } from "./lib/project-content.mjs";
import { buildStaticCatalog, buildSummaryOverlay, summaryOverlayScript } from "./lib/static-catalog.mjs";

const read = file => readFileSync(`public/${file}`, "utf8");
async function boot(t, { storageBlocked = false, live = false, locale = "en", query = "", catalogHandler, pagedSeed = false, fastTimeout = false, mobile = false, theme, staticBuild, summaryOverlay } = {}) {
  const path = locale === "en" ? "/" : `/${locale}/`;
  const dom = new JSDOM(read(path.slice(1) + "index.html"), { url: "https://jevhunt.com" + path + query, runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  Object.assign(window, stateHelpers, localeHelpers, { renderProjectCard });
  const mediaListeners = [];
  const mobileMedia = { matches: mobile, addEventListener: (_event, listener) => mediaListeners.push(listener) };
  window.matchMedia = query => query === "(max-width: 760px)" ? mobileMedia : { matches: true };
  const resize = matches => { mobileMedia.matches = matches; mediaListeners.forEach(listener => listener({ matches })); };
  if (fastTimeout) {
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 20000 ? 1 : delay, ...args);
  }
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  const scrolls = [];
  window.Element.prototype.scrollIntoView = function () { scrolls.push(this.id); };
  const requests = [];
  const snapshot = JSON.parse(read("catalog.json"));
  const added = { ...snapshot.apps[0], repo: "live/new-jev-app", name: "runtime-only-project", stars: 1, desc: "A newly indexed project", relationship: "jev-app" };
  function catalogResponse(path) {
    const url = new URL(path, "https://jevhunt.com");
    const requested = stateHelpers.readCatalogState(url, [...new Set(snapshot.apps.map(app => app.cat))]);
    requested.query = readCatalogQuery(url.searchParams).q;
    const matches = [...snapshot.apps, added].filter(app => stateHelpers.matchesProject(app, requested));
    matches.sort((left, right) => requested.sort === "name-asc" ? left.name.localeCompare(right.name) : right.stars - left.stars || right.created?.localeCompare(left.created || "") || left.name.localeCompare(right.name));
    const pageSize = Number(url.searchParams.get("per_page")) || 20;
    const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
    const page = Math.min(requested.page, totalPages);
    return Response.json({ meta: { ...snapshot.meta, mode: "live-d1", projectCount: snapshot.apps.length + 1 }, apps: matches.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total: matches.length, totalPages, start: matches.length ? (page - 1) * pageSize + 1 : 0, end: Math.min(page * pageSize, matches.length) } });
  }
  window.fetch = async (path, options = {}) => {
    if (path === "/api/me") return Response.json({ user: null, authEnabled: true });
    if (live && path.startsWith("/api/catalog")) {
      requests.push({ url: path, signal: options.signal });
      return catalogHandler ? catalogHandler(path, options, () => catalogResponse(path)) : catalogResponse(path);
    }
    throw new Error("Unexpected browser request: " + path);
  };
  if (theme) window.localStorage.setItem("jh-theme", theme);
  if (storageBlocked) Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage blocked"); } });
  let catalogLoads = 0;
  window.__loadCatalog = async () => { catalogLoads++; window.eval(staticBuild?.fullScript || read("assets/js/catalog-all.js")); };
  for (const file of [`locales/${locale}`, "data"]) window.eval(read(`assets/js/${file}.js`));
  window.eval(staticBuild?.initialScript || read("assets/js/projects.js"));
  if (summaryOverlay) window.eval(summaryOverlayScript(summaryOverlay));
  if (live) {
    const seed = pagedSeed ? await catalogResponse(path + query).json() : { meta: { ...window.JH.catalogMeta, mode: "live-d1" }, apps: window.JH.apps };
    if (pagedSeed) {
      seed.query = { ...readCatalogQuery(new URL(window.location.href).searchParams), page: seed.pagination.page, pageSize: 20, locale };
    }
    window.document.getElementById("liveCatalogSeed").textContent = JSON.stringify(seed);
  }
  const script = read("assets/js/main.js").replace(/^import[^\n]+\n/gm, "")
    .replace("import(staticCatalogIndexUrl(window.JH.catalogMeta))", "window.__loadCatalog()");
  window.eval(script);
  if (window.document.readyState === "loading") await new Promise(resolve => window.document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  await new Promise(resolve => setImmediate(resolve));
  return { window, document: window.document, loads: () => catalogLoads, requests, scrolls, resize };
}

test("Chinese static cards and full-index search retain the reviewed summaries after hydration", async t => {
  const catalog = JSON.parse(read("catalog.json"));
  const records = loadProjectContents();
  const staticBuild = buildStaticCatalog(catalog, records);
  const summaryOverlay = buildSummaryOverlay(catalog.apps, records, "zh-cn");
  const { document, window, loads } = await boot(t, { locale: "zh-cn", staticBuild, summaryOverlay });
  const first = staticBuild.initial[0];
  const firstCopy = records.get(first.repo.toLowerCase()).locales["zh-cn"].summary;
  assert.equal(document.querySelector("#appGrid .card__desc").textContent, firstCopy);
  assert.equal(loads(), 0);

  const repo = "realzachi/pg-jev";
  assert.ok(!staticBuild.initial.some(project => project.repo.toLowerCase() === repo));
  const input = document.getElementById("dirSearch");
  input.value = "自然语言 SQL 条件";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads(), 1);
  const card = document.querySelector(`#appGrid .card__name[href="/zh-cn/projects/${repo}/"]`)?.closest(".card");
  assert.ok(card, "Chinese terms in a reviewed summary must find a project outside the initial page");
  assert.equal(card.querySelector(".card__desc").textContent, records.get(repo).locales["zh-cn"].summary);
  assert.equal(window.JH.catalogRemote, undefined);
});

test("static locale overlays and late static imports never replace live catalog descriptions", async t => {
  const catalog = JSON.parse(read("catalog.json"));
  const records = loadProjectContents();
  const staticBuild = buildStaticCatalog(catalog, records);
  const summaryOverlay = buildSummaryOverlay(catalog.apps, records, "zh-cn");
  const { document, window } = await boot(t, { live: true, locale: "zh-cn", staticBuild, summaryOverlay });
  const initialLiveApps = window.JH.apps;
  const first = initialLiveApps[0];
  assert.notEqual(first.desc, records.get(first.repo.toLowerCase()).locales["zh-cn"].summary);
  assert.equal(document.querySelector("#appGrid .card__desc").textContent, first.desc);
  await window.__loadCatalog();
  assert.equal(window.JH.apps, initialLiveApps, "An in-flight fallback import must not overwrite a live seed");
  document.querySelector('#directoryPagesBottom a[rel="next"]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.JH.catalogRemote, true);
  const current = window.JH.apps[0];
  assert.equal(document.querySelector("#appGrid .card__desc").textContent, current.desc, "API descriptions must remain authoritative");
});

test("directory initializes with blocked browser storage and only the first page", async t => {
  const { document, window, loads } = await boot(t, { storageBlocked: true });
  assert.equal(document.querySelectorAll("#appGrid .card").length, 20);
  assert.equal(document.getElementById("statApps").dataset.count, String(window.JH.catalogMeta.projectCount));
  assert.equal(document.getElementById("catalogUpdated").dataset.iso, window.JH.catalogMeta.syncedAt);
  assert.equal(document.getElementById("catalogUpdated").getAttribute("datetime"), window.JH.catalogMeta.syncedAt);
  assert.match(document.getElementById("catalogUpdated").getAttribute("aria-label"), /Catalog updated .* UTC/);
  assert.match(document.getElementById("catalogUpdated").textContent, /UTC$/);
  assert.equal(loads(), 0);
  assert.ok(!document.getElementById("loadMore") || document.getElementById("loadMore").hidden);
  assert.ok(document.querySelector('#dirFilters [data-cat="sdks"]'));
  assert.ok(document.querySelector('#dirFilters [data-cat="games"]'));
  assert.ok(document.querySelector('#appGrid .card__descLink[href="/projects/agentscope-ai/agentscope/"]'));
  assert.match(document.getElementById("directoryPagesBottom").textContent, /Page 1/);
  document.querySelector('#directoryPagesBottom [data-page="2"]').click();
  assert.equal(new URL(window.location.href).searchParams.get("page"), "2");
  assert.ok(document.querySelector("#auth a[href^='/api/auth/google']"));
  assert.equal(document.documentElement.dataset.theme, "light");
  document.getElementById("themeBtn").click();
  assert.equal(document.documentElement.dataset.theme, "dark");
});
test("a failed full catalog request preserves the preview and retries without claiming no results", async t => {
  const { document, window } = await boot(t);
  const preview = document.getElementById("appGrid").innerHTML;
  const previewCount = document.getElementById("dirCount").textContent;
  const originalLoad = window.__loadCatalog;
  window.__loadCatalog = async () => { throw new Error("network unavailable"); };
  const input = document.getElementById("dirSearch");
  input.value = "a-query-that-forces-the-full-index";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(document.getElementById("dirCount").textContent, window.JH.i18n.locales.en.messages["apps.loading"]);
  assert.equal(document.getElementById("dirEmpty").hidden, true);
  assert.equal(document.getElementById("appGrid").innerHTML, preview);
  assert.equal(document.getElementById("dirCount").textContent, previewCount);
  assert.equal(document.getElementById("appGrid").getAttribute("aria-busy"), "false");
  assert.equal(document.getElementById("catalogLoadError").hidden, false);
  assert.ok(document.getElementById("toast").textContent.includes(window.JH.i18n.locales.en.messages["apps.loadFailed"]));
  window.__loadCatalog = originalLoad;
  document.getElementById("catalogRetry").click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.getElementById("catalogLoadError").hidden, true);
  assert.equal(document.querySelectorAll("#appGrid .card").length, 0);
  assert.equal(document.getElementById("dirEmpty").hidden, false);
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
test("live bottom pagination requests only 20 rows per page and replaces cards after loading", async t => {
  const { document, window, loads, requests, scrolls } = await boot(t, { live: true });
  assert.equal(requests.length, 0, "SSR first-page data needs no duplicate API request");
  const cards = () => [...document.querySelectorAll("#appGrid .card__name")].map(link => link.getAttribute("href"));
  const firstPage = cards();
  const next = document.querySelector('#directoryPagesBottom a[rel="next"]');
  assert.equal(next.getAttribute("href"), "/?page=2#apps");
  next.click();
  assert.deepEqual(cards(), firstPage, "Keep usable cards while the next page is loading");
  assert.equal(document.getElementById("appGrid").getAttribute("aria-busy"), "true");
  assert.equal(document.getElementById("catalogLoadingStatus").hidden, false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads(), 0);
  assert.equal(requests.length, 1);
  const requested = new URL(requests[0].url, window.location.origin);
  assert.equal(requested.searchParams.get("page"), "2");
  assert.equal(requested.searchParams.get("per_page"), "20");
  assert.equal(requested.searchParams.has("all"), false);
  const secondPage = cards();
  assert.equal(secondPage.length, 20);
  assert.ok(secondPage.every(repo => !firstPage.includes(repo)));
  assert.equal(new URL(window.location.href).searchParams.get("page"), "2");
  assert.equal(new URL(window.location.href).hash, "#apps");
  assert.equal(document.querySelector('#directoryPagesBottom [aria-current="page"]').textContent, "2");
  assert.match(document.getElementById("directoryPagesBottom").textContent, /21–40/);
  assert.match(document.getElementById("dirCount").textContent, /21–40/);
  assert.equal(document.getElementById("directoryPages"), null);
  document.querySelector('#directoryPagesBottom a[rel="next"]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads(), 0);
  assert.equal(cards().length, 20);
  assert.ok(cards().every(repo => !firstPage.includes(repo) && !secondPage.includes(repo)));
  const restored = new Promise(resolve => window.addEventListener("popstate", resolve, { once: true }));
  window.history.back();
  await restored;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(cards(), secondPage);
  document.querySelector('#directoryPagesBottom a[rel="prev"]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(cards(), firstPage);
  assert.equal(new URL(window.location.href).searchParams.has("page"), false);
  assert.ok(scrolls.includes("appGrid"), "Scroll to the new results after a successful page change");
  assert.ok(requests.every(request => !new URL(request.url, window.location.origin).searchParams.has("all")));
});

test("localized pagination keeps filters in links and browser history restores every control", async t => {
  const { document, window, requests } = await boot(t, { live: true, locale: "zh-cn", query: "?q=jev&language=Python&activity=active&sort=name-asc&page=2#apps" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  const initialRequest = new URL(requests[0].url, window.location.origin);
  assert.equal(initialRequest.searchParams.get("locale"), "zh-cn");
  assert.equal(initialRequest.searchParams.get("page"), "2");
  assert.equal(initialRequest.searchParams.get("language"), "Python");
  const next = document.querySelector('#directoryPagesBottom a[rel="next"]');
  const target = new URL(next.href);
  assert.equal(target.pathname, "/zh-cn/");
  for (const [key, value] of [["q", "jev"], ["language", "Python"], ["activity", "active"], ["sort", "name-asc"], ["page", "3"]]) assert.equal(target.searchParams.get(key), value);
  const category = document.querySelector('#dirFilters [data-cat="agents"]');
  category.click();
  assert.equal(new URL(window.location.href).searchParams.has("page"), false);
  document.getElementById("resetFilters").click();
  assert.equal(document.getElementById("dirSearch").value, "");
  const restored = new Promise(resolve => window.addEventListener("popstate", resolve, { once: true }));
  window.history.back();
  await restored;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.getElementById("appGrid").getAttribute("aria-busy"), "false", "The restored filter request must finish before the browser closes");
  assert.equal(document.getElementById("dirSearch").value, "jev");
  assert.equal(document.getElementById("heroSearch"), null);
  assert.equal(document.getElementById("languageFilter").value, "Python");
  assert.equal(document.getElementById("activityFilter").value, "active");
  assert.equal(document.getElementById("dirSort").value, "name-asc");
  assert.equal(document.querySelector('#dirFilters [aria-pressed="true"]').dataset.cat, "agents");
});

test("a page beyond the filtered result set clamps to a valid final page", async t => {
  const { document, window, requests } = await boot(t, { live: true, query: "?q=jaredpalmer%2Fkev&page=999#apps" });
  await new Promise(resolve => setImmediate(resolve));
  const count = document.querySelectorAll("#appGrid .card").length;
  assert.ok(count > 0 && count <= 20);
  assert.ok(document.querySelector('#appGrid .card__name[href="/projects/jaredpalmer/kev/"]'));
  assert.equal(new URL(window.location.href).searchParams.has("page"), false);
  assert.equal(document.querySelector('#directoryPagesBottom [aria-current="page"]').textContent, "1");
  assert.ok(document.getElementById("directoryPagesBottom").textContent.includes(`1–${count}`));
  assert.equal(document.querySelector('#directoryPagesBottom a[rel="next"]'), null);
  assert.equal(requests.length, 1, "Server-clamped page should not trigger a second request");
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
  const { document, window, loads, requests } = await boot(t, { live: true });
  const input = document.getElementById("dirSearch");
  input.value = "runtime-only-project";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.ok(document.querySelector('#appGrid .card__name[href="/projects/live/new-jev-app/"]'));
  assert.equal(loads(), 0, "The live API must not import the old static index");
  assert.equal(window.JH.catalogMeta.mode, "live-d1");
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url, window.location.origin).searchParams.get("q"), "runtime-only-project");
});

test("live search debounces input, aborts old work and ignores out-of-order responses", async t => {
  const pending = [];
  const { document, window, requests } = await boot(t, { live: true, catalogHandler: (path, options, reply) => new Promise(resolve => pending.push({ path, signal: options.signal, reply, resolve })) });
  const input = document.getElementById("dirSearch");
  const type = value => { input.value = value; input.dispatchEvent(new window.Event("input", { bubbles: true })); };
  type("old");
  type("old-no-result");
  assert.equal(requests.length, 0);
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(requests.length, 1);
  type("runtime-only-project");
  assert.equal(pending[0].signal.aborted, true);
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(requests.length, 2);
  pending[1].resolve(pending[1].reply());
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(document.querySelector('#appGrid .card__name[href="/projects/live/new-jev-app/"]'));
  pending[0].resolve(pending[0].reply());
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(document.querySelector('#appGrid .card__name[href="/projects/live/new-jev-app/"]'));
  assert.equal(document.getElementById("dirEmpty").hidden, true);
  assert.equal(document.getElementById("appGrid").getAttribute("aria-busy"), "false");
});

test("a failed live page preserves the current page and retries the requested page", async t => {
  let fail = true;
  const { document, requests } = await boot(t, { live: true, catalogHandler: (_path, _options, reply) => { if (fail) throw new Error("network failed"); return reply(); } });
  const original = document.getElementById("appGrid").innerHTML;
  const originalCount = document.getElementById("dirCount").textContent;
  document.querySelector('#directoryPagesBottom a[rel="next"]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.getElementById("appGrid").innerHTML, original);
  assert.equal(document.getElementById("dirCount").textContent, originalCount);
  assert.equal(document.getElementById("dirEmpty").hidden, true);
  assert.equal(document.getElementById("catalogLoadError").hidden, false);
  fail = false;
  document.getElementById("catalogRetry").click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.notEqual(document.getElementById("appGrid").innerHTML, original);
  assert.equal(document.querySelector('#directoryPagesBottom [aria-current="page"]').textContent, "2");
  assert.equal(document.getElementById("catalogLoadError").hidden, true);
});

test("matching server-rendered filtered pages hydrate without a duplicate API request", async t => {
  const { document, requests, loads } = await boot(t, { live: true, pagedSeed: true, query: "?q=jev&language=Python&page=3" });
  assert.equal(requests.length, 0);
  assert.equal(loads(), 0);
  assert.equal(document.querySelectorAll("#appGrid .card").length, 20);
  assert.equal(document.querySelector('#directoryPagesBottom [aria-current="page"]').textContent, "3");
  assert.match(document.getElementById("dirCount").textContent, /41–60/);
});

test("server-normalized searches hydrate once while preserving the visitor's input", async t => {
  const query = "SYSTEM  ONE";
  const { document, requests } = await boot(t, { live: true, pagedSeed: true, query: "?q=" + encodeURIComponent(query) });
  assert.equal(requests.length, 0);
  assert.equal(document.getElementById("dirSearch").value, query);
  assert.equal(document.getElementById("appGrid").getAttribute("aria-busy"), "false");
  assert.equal(document.querySelectorAll("#appGrid .card").length, 20);
});

test("a server-clamped empty result keeps its requested language and does not refetch", async t => {
  const { document, requests, window } = await boot(t, { live: true, pagedSeed: true, query: "?page=999&language=NotARealLanguage" });
  assert.equal(requests.length, 0);
  assert.equal(document.getElementById("languageFilter").value, "NotARealLanguage");
  assert.equal(document.getElementById("dirEmpty").hidden, false);
  assert.equal(document.querySelectorAll("#appGrid .card").length, 0);
  assert.equal(new URL(window.location.href).searchParams.get("page"), null);
});

test("a live refresh keeps the readable catalog time and machine timestamp consistent", async t => {
  const syncedAt = "2026-09-29T12:34:56.000Z";
  const { document } = await boot(t, { live: true, catalogHandler: async (_path, _options, reply) => {
    const data = await reply().json(); data.meta.syncedAt = syncedAt; return Response.json(data);
  } });
  document.querySelector('#directoryPagesBottom a[rel="next"]').click();
  await new Promise(resolve => setImmediate(resolve));
  const time = document.getElementById("catalogUpdated");
  assert.equal(time.dataset.iso, syncedAt);
  assert.equal(time.getAttribute("datetime"), syncedAt);
  assert.match(time.textContent, /12:34/);
  assert.match(time.textContent, /UTC$/);
});

test("a timed-out live request leaves loading state and keeps the previous results", async t => {
  const { document, requests } = await boot(t, { live: true, fastTimeout: true, catalogHandler: (_path, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("request aborted")), { once: true })) });
  const previous = document.getElementById("appGrid").innerHTML;
  document.querySelector('#directoryPagesBottom a[rel="next"]').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(document.getElementById("appGrid").getAttribute("aria-busy"), "false");
  assert.equal(document.getElementById("catalogLoadingStatus").hidden, true);
  assert.equal(document.getElementById("catalogLoadError").hidden, false);
  assert.equal(document.getElementById("appGrid").innerHTML, previous);
});

test("submitting the search form executes immediately and cancels the pending debounce", async t => {
  const { document, window, requests, scrolls } = await boot(t, { live: true });
  const input = document.getElementById("dirSearch");
  input.value = "runtime-only-project";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(requests.length, 0);
  const submit = new window.Event("submit", { bubbles: true, cancelable: true });
  document.getElementById("directorySearchForm").dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
  assert.equal(requests.length, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(document.querySelector('#appGrid .card__name[href="/projects/live/new-jev-app/"]'));
  assert.ok(scrolls.includes("appGrid"));
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(requests.length, 1, "The canceled input timer must not issue a duplicate search");
});

test("mobile filters and navigation collapse accessibly and stay visible on desktop", async t => {
  const { document, window, resize } = await boot(t, { mobile: true });
  const filters = document.getElementById("filtersToggle"), facets = document.getElementById("directoryFacets");
  const toggle = document.getElementById("mobileMenuToggle"), menu = document.getElementById("mobileMenu");
  assert.equal(facets.hidden, true);
  assert.equal(menu.hidden, true);
  filters.click();
  assert.equal(facets.hidden, false);
  assert.equal(filters.getAttribute("aria-expanded"), "true");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(facets.hidden, true);
  assert.equal(document.activeElement, filters);
  toggle.click();
  assert.equal(menu.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, toggle);
  toggle.click();
  const anchor = menu.querySelector('a[href^="#"]');
  anchor.addEventListener("click", event => event.preventDefault(), { once: true });
  anchor.click();
  assert.equal(menu.hidden, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  resize(false);
  assert.equal(facets.hidden, false);
  assert.equal(menu.hidden, false);
  resize(true);
  assert.equal(facets.hidden, true);
  assert.equal(menu.hidden, true);
});

test("resource hash links open the containing disclosure", async t => {
  const { document, window } = await boot(t, { query: "#playbooks" });
  const section = document.getElementById("playbooks");
  const disclosure = section.closest("details");
  assert.ok(disclosure);
  assert.equal(disclosure.open, true);
  disclosure.open = false;
  const anchor = document.querySelector('a[href="#playbooks"]');
  anchor.addEventListener("click", event => event.preventDefault(), { once: true });
  anchor.click();
  assert.equal(disclosure.open, true);
  window.history.replaceState({}, "", "#timeline");
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  assert.equal(document.getElementById("timeline").closest("details").open, true);
});

test("the new light default preserves an explicit dark preference on every page", async t => {
  const { document } = await boot(t, { theme: "dark" });
  assert.equal(document.documentElement.dataset.theme, "dark");
  document.getElementById("themeBtn").click();
  assert.equal(document.documentElement.dataset.theme, "light");
  for (const [saved, expected] of [[null, "light"], ["dark", "dark"]]) {
    const dom = new JSDOM('<html data-theme="dark"><button id="pageTheme">Theme</button></html>', { url: "https://jevhunt.com/projects/example/project/", runScripts: "outside-only" });
    t.after(() => dom.window.close());
    if (saved) dom.window.localStorage.setItem("jh-theme", saved);
    dom.window.eval(read("assets/js/page.js"));
    assert.equal(dom.window.document.documentElement.dataset.theme, expected);
    dom.window.document.getElementById("pageTheme").click();
    assert.equal(dom.window.document.documentElement.dataset.theme, expected === "dark" ? "light" : "dark");
  }
});
