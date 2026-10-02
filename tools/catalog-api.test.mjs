import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./helpers/d1.mjs";
import { onRequestGet as catalog } from "../functions/api/catalog.js";
import { publicPreview } from "../shared/catalog-data.js";
import { readCatalogQuery, catalogCacheRequest, readCatalogPage } from "../shared/catalog-query.js";

function setup(t, count = 0) {
  const DB = database();
  t.after(() => DB.db.close());
  DB.db.prepare("UPDATE catalog_control SET revision='test-v1',published_at=1790640000").run();
  const add = (overrides = {}) => {
    const p = { repo: "owner/example", name: "Example", desc: "An example project", cat: "apps", relationship: "jev-app", language: "Python", stars: 10,
      created: "2026-09-01", added: "2026-09-03", pushed: "2026-09-05", archived: false, evidenceDetail: { excerpt: "Source evidence" }, ...overrides };
    DB.db.prepare("INSERT INTO catalog_entries(repo,payload,preview,name,category,relationship,language,stars,created,active,checked_at,next_check_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,2)")
      .run(p.repo, JSON.stringify(p), JSON.stringify(publicPreview(p)), p.name, p.cat, p.relationship, p.language, p.stars, p.created, overrides.active ?? 1);
    return p;
  };
  for (let i = 1; i <= count; i++) add({ repo: `owner/project-${i}`, name: `Project ${String(i).padStart(2, "0")}`, stars: 1000 - i,
    cat: i % 2 ? "apps" : "agents", language: i % 2 ? "Python" : "TypeScript" });
  const env = { DB };
  const request = (params = "", extra = {}) => catalog({ request: new Request("https://jevhunt.com/api/catalog" + (params ? "?" + params : "")), env, ...extra });
  const get = async params => (await request(params)).json();
  return { DB, env, add, request, get };
}

test("live pagination returns bounded, nonoverlapping pages and clamps to the last page", async t => {
  const { get } = setup(t, 47);
  const first = await get("page=1"), second = await get("page=2"), last = await get("page=9999");
  assert.equal(first.apps.length, 20);
  assert.equal(second.apps.length, 20);
  assert.equal(last.apps.length, 7);
  assert.deepEqual(second.pagination, { page: 2, pageSize: 20, total: 47, totalPages: 3, start: 21, end: 40 });
  assert.deepEqual(last.pagination, { page: 3, pageSize: 20, total: 47, totalPages: 3, start: 41, end: 47 });
  assert.equal(new Set([...first.apps, ...second.apps, ...last.apps].map(p => p.repo)).size, 47);
  assert.equal(first.apps[0].repo, "owner/project-1");
  assert.equal(second.apps[0].repo, "owner/project-21");
  assert.equal(last.apps.at(-1).repo, "owner/project-47");
});

test("default previews and full catalog exports retain their existing response semantics", async t => {
  const { get } = setup(t, 25);
  const preview = await get();
  assert.equal(preview.apps.length, 20);
  assert.equal(preview.pagination, undefined);
  assert.equal(preview.apps[0].evidenceDetail, undefined);
  const all = await get("all=1&full=1&page=2&category=sdks&q=not-found");
  assert.equal(all.apps.length, 25);
  assert.equal(all.pagination, undefined);
  assert.equal(all.apps[0].evidenceDetail.excerpt, "Source evidence");
  const fullPage = await get("page=2&per_page=10&full=1");
  assert.equal(fullPage.apps.length, 10);
  assert.equal(fullPage.apps[0].evidenceDetail.excerpt, "Source evidence");
});

test("database filters combine correctly while metadata retains whole-catalog facets", async t => {
  const { add, get } = setup(t);
  add({ repo: "alpha/router", name: "Ticket Router", desc: "Classify support tickets", cat: "agents", relationship: "integration", stars: 40 });
  add({ repo: "beta/router", name: "Archived Router", cat: "agents", relationship: "integration", archived: true, stars: 30 });
  add({ repo: "gamma/client", name: "Client", cat: "sdks", relationship: "sdk", language: "TypeScript", stars: 20 });
  add({ repo: "delta/unknown", name: "Unknown", language: null, stars: 10 });
  const filtered = await get("page=1&category=agents&kind=integration&language=Python&activity=active&q=support");
  assert.deepEqual(filtered.apps.map(p => p.repo), ["alpha/router"]);
  assert.equal(filtered.pagination.total, 1);
  assert.equal(filtered.meta.projectCount, 4);
  assert.deepEqual(filtered.meta.categoryCounts, { agents: 2, apps: 1, sdks: 1 });
  assert.deepEqual(filtered.meta.languages, ["Python", "TypeScript", "unknown"]);
  assert.deepEqual((await get("activity=archived")).apps.map(p => p.repo), ["beta/router"]);
  assert.deepEqual((await get("language=unknown")).apps.map(p => p.repo), ["delta/unknown"]);
  assert.deepEqual((await get("q=gamma%2Fclient")).apps.map(p => p.repo), ["gamma/client"]);
  assert.deepEqual((await get("q=TYPESCRIPT")).apps.map(p => p.repo), ["gamma/client"]);
  const empty = await get("page=50&q=not-found");
  assert.deepEqual(empty.apps, []);
  assert.deepEqual(empty.pagination, { page: 1, pageSize: 20, total: 0, totalPages: 1, start: 0, end: 0 });
});

test("natural queries split repository punctuation and rank matching project names first", async t => {
  const { add, get } = setup(t);
  add({ repo: "CoderInPajamas/JEV-MLX", name: "JEV-MLX", desc: "JEV-inspired local decisions for Apple Silicon", stars: 2 });
  add({ repo: "andrewdeng318/paperclip-plugin-jev", name: "paperclip-plugin-jev", desc: "Community Paperclip plugin for Jev", stars: 1 });
  add({ repo: "Eliot5566/JEV-Paper-Radar", name: "JEV-Paper-Radar", desc: "Reads new papers against plain-language interests", stars: 3 });
  add({ repo: "owner/broad-paper", name: "Broad paper helper", desc: "A Jev tool for papers", stars: 900 });
  assert.deepEqual((await get("q=jev%20mlx")).apps.map(project => project.name), ["JEV-MLX"]);
  assert.deepEqual((await get("q=paperclip%20jev")).apps.map(project => project.name), ["paperclip-plugin-jev"]);
  assert.deepEqual((await get("q=jev%20paper")).apps.slice(0, 2).map(project => project.name), ["JEV-Paper-Radar", "Broad paper helper"]);
});

test("category names match English and the requested locale without downloading the catalog", async t => {
  const { env, add, get } = setup(t);
  add({ repo: "owner/agent", cat: "agents" });
  add({ repo: "owner/client", cat: "sdks" });
  const assets = [];
  env.ASSETS = { async fetch(url) { assets.push(new URL(url).pathname); return Response.json({ messages: { "category.agents.name": "智能体工具" } }); } };
  assert.deepEqual((await get("q=Agent%20Tooling")).apps.map(p => p.repo), ["owner/agent"]);
  assert.deepEqual((await get("q=" + encodeURIComponent("智能体") + "&locale=zh-cn")).apps.map(p => p.repo), ["owner/agent"]);
  assert.deepEqual(assets, ["/assets/locales/zh-cn.json"]);
});

test("search treats SQL quotes and LIKE wildcards as literal text", async t => {
  const { add, get, DB } = setup(t);
  add({ repo: "owner/literal", desc: "Coverage 100%_strict with C:\\tools and O'Reilly" });
  add({ repo: "owner/ordinary", desc: "Coverage 100xxstrict" });
  for (const query of ["100%_strict", "C:\\tools", "O'Reilly"]) {
    assert.deepEqual((await get("q=" + encodeURIComponent(query))).apps.map(p => p.repo), ["owner/literal"]);
  }
  assert.deepEqual((await get("q=" + encodeURIComponent("' OR 1=1 --"))).apps, []);
  assert.equal(DB.db.prepare("SELECT COUNT(*) AS n FROM catalog_entries").get().n, 2);
});

test("withdrawals, withdrawn aliases and inactive entries are excluded from results and counts", async t => {
  const { DB, add, get } = setup(t);
  add({ repo: "owner/visible" });
  add({ repo: "owner/withdrawn" });
  add({ repo: "owner/renamed" });
  add({ repo: "owner/inactive", active: 0 });
  DB.db.prepare("INSERT INTO catalog_withdrawals VALUES(?,1,'test')").run("owner/withdrawn");
  DB.db.prepare("INSERT INTO catalog_withdrawals VALUES(?,1,'test')").run("owner/old");
  DB.db.prepare("INSERT INTO catalog_aliases VALUES('owner/old','owner/renamed',1)").run();
  const result = await get("page=1");
  assert.deepEqual(result.apps.map(p => p.repo), ["owner/visible"]);
  assert.equal(result.pagination.total, 1);
  assert.equal(result.meta.projectCount, 1);
});

test("supported sorts are stable and dates missing from projects sort last", async t => {
  const { add, get } = setup(t);
  add({ repo: "owner/bravo", name: "Bravo", stars: 20, created: "2026-09-02", pushed: "2026-09-09", added: "2026-09-02" });
  add({ repo: "owner/alpha", name: "Alpha", stars: 30, created: "2026-09-01", pushed: "2026-09-08", added: "2026-09-03" });
  add({ repo: "owner/missing", name: "Missing", stars: 10, created: null, pushed: null, added: null });
  const orders = {
    "stars-desc": ["Alpha", "Bravo", "Missing"], "stars-asc": ["Missing", "Bravo", "Alpha"],
    "created-desc": ["Bravo", "Alpha", "Missing"], "created-asc": ["Alpha", "Bravo", "Missing"],
    "updated-desc": ["Bravo", "Alpha", "Missing"], "added-desc": ["Alpha", "Bravo", "Missing"], "name-asc": ["Alpha", "Bravo", "Missing"],
  };
  for (const [sort, names] of Object.entries(orders)) assert.deepEqual((await get("sort=" + sort)).apps.map(p => p.name), names, sort);
  add({ repo: "owner/alpha-2", name: "Alpha", stars: 30, created: "2026-09-01" });
  const first = await get("page=1&per_page=1"), second = await get("page=2&per_page=1");
  assert.equal(first.apps[0].repo, "owner/alpha");
  assert.equal(second.apps[0].repo, "owner/alpha-2");
});

test("invalid parameters cannot expand page size or inject sorting and filters", async t => {
  const { get } = setup(t, 125);
  for (const value of ["-4", "1.2", "20junk", "1e2", "Infinity"]) {
    const result = await get(`page=${value}&per_page=${value}`);
    assert.equal(result.pagination.page, 1);
    assert.equal(result.pagination.pageSize, 20);
    assert.equal(result.apps.length, 20);
  }
  assert.equal((await get("page=0&per_page=0")).pagination.pageSize, 1);
  assert.equal((await get("per_page=999999")).apps.length, 100);
  const result = await get("page=1&category=bad&kind=bad&activity=bad&sort=" + encodeURIComponent("stars; DROP TABLE catalog_entries"));
  assert.equal(result.apps[0].repo, "owner/project-1");
  assert.equal(result.pagination.total, 125);
  const normalized = readCatalogQuery(new URLSearchParams("locale=../../secrets&q=" + "x".repeat(400) + "&language=" + "y".repeat(80)));
  assert.equal(normalized.locale, "en"); assert.equal(normalized.q.length, 300); assert.equal(normalized.language.length, 50);
});

test("SSR can share the same bounded database query and localized matching", async t => {
  const { DB } = setup(t, 47);
  const query = readCatalogQuery(new URLSearchParams("page=2&per_page=20"));
  const result = await readCatalogPage(DB, query);
  assert.equal(result.apps[0].repo, "owner/project-21");
  assert.equal(result.pagination.start, 21);
});

test("cache keys include normalized result parameters and revision", () => {
  const key = (params, revision = "v1") => {
    const url = new URL("https://jevhunt.com/api/catalog?" + params);
    return catalogCacheRequest(url, readCatalogQuery(url.searchParams), revision).url;
  };
  assert.equal(key("page=01&per_page=020&q=Hello%20%20World&sort=bad&locale=bad"), key("page=1&q=hello%20world"));
  assert.equal(key("all=1&full=1&page=50&q=ignored"), key("all=1&full=1"));
  for (const suffix of ["page=2", "per_page=10", "q=router", "category=agents", "kind=sdk", "language=Python", "activity=active", "sort=name-asc", "locale=zh-cn", "full=1"]) {
    assert.notEqual(key(suffix.startsWith("page=") ? suffix : "page=1&" + suffix), key("page=1"), suffix);
  }
  assert.notEqual(key("page=1"), key("page=1", "v2"));
});

test("cached pages never leak a different page, filter, or catalog revision", async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "caches"), entries = new Map();
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { default: {
    async match(request) { return entries.get(request.url)?.clone(); },
    async put(request, response) { entries.set(request.url, response.clone()); },
  } } });
  t.after(() => original ? Object.defineProperty(globalThis, "caches", original) : delete globalThis.caches);
  const { DB, request } = setup(t, 47);
  const get = async params => {
    const pending = [], response = await request(params, { waitUntil: promise => pending.push(promise) });
    await Promise.all(pending);
    return response.json();
  };
  assert.equal((await get("page=1")).apps[0].repo, "owner/project-1");
  assert.equal((await get("page=2")).apps[0].repo, "owner/project-21");
  assert.equal((await get("page=1&category=agents")).pagination.total, 23);
  assert.equal((await get("page=1")).apps[0].repo, "owner/project-1");
  assert.equal(entries.size, 3);
  DB.db.prepare("UPDATE catalog_control SET revision='test-v2'").run();
  assert.equal((await get("page=1")).meta.catalogHash, "test-v2");
  assert.equal(entries.size, 4);
});
