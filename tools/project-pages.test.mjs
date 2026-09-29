import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { onRequestGet as projectRoute } from "../functions/projects/[owner]/[repo]/index.js";
import { onRequestGet as localizedProjectRoute } from "../functions/[locale]/projects/[owner]/[repo]/index.js";
import { onRequestGet as browseRoute } from "../functions/browse/[[page]].js";
import { onRequestGet as categoryRoute } from "../functions/categories/[category]/[[page]].js";
import { LOCALES } from "../shared/locales.js";
import { publicPreview } from "../shared/catalog-data.js";
import { database } from "./helpers/d1.mjs";
import { loadData } from "./lib/site.mjs";

const origin = "https://jevhunt.com";
const source = "https://github.com/owner/example/blob/" + "a".repeat(40) + "/README.md";
const example = { name: "Example", repo: "owner/example", desc: "A documented project description.", cat: "agents", relationship: "jev-app", evidenceLevel: "documented", evidence: source, evidenceDetail: { excerpt: "Original source excerpt", commit: "a".repeat(40) }, language: "Python", stars: 1000, created: "2026-08-20", pushed: "2026-09-23", archived: false, fork: false, freshness: "current", provenance: ["github-search"] };

function fixture(t) {
  const DB = database();
  t.after(() => DB.db.close());
  const { i18n } = loadData();
  const assets = { async fetch(input) {
    const url = new URL(input.url || input);
    const locale = url.pathname.match(/^\/assets\/locales\/([a-z-]+)\.json$/)?.[1];
    if (locale && i18n.locales[locale]) return Response.json({ messages: i18n.locales[locale].messages, lang: i18n.locales[locale].lang });
    try {
      const path = url.pathname + (url.pathname.endsWith("/") ? "index.html" : "");
      return new Response(readFileSync(new URL("../public" + path, import.meta.url)), { headers: { "content-type": "text/html" } });
    } catch { return new Response("Not found", { status: 404 }); }
  } };
  const env = { DB, ASSETS: assets };
  function insert(overrides = {}, active = 1) {
    const project = { ...example, ...overrides };
    DB.db.prepare("INSERT INTO catalog_entries (repo,payload,preview,name,category,relationship,language,stars,created,active,checked_at,next_check_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(project.repo.toLowerCase(), JSON.stringify(project), JSON.stringify(publicPreview(project)), project.name, project.cat, project.relationship, project.language, project.stars, project.created, active, 1790640000, 1790643600);
    return project;
  }
  async function dispatch(input) {
    const url = new URL(input, origin);
    const context = { request: new Request(url), env, next: () => assets.fetch(url) };
    let match = url.pathname.match(/^\/projects\/([^/]+)\/([^/]+)\/$/);
    if (match) return projectRoute({ ...context, params: { owner: match[1], repo: match[2] } });
    match = url.pathname.match(/^\/([^/]+)\/projects\/([^/]+)\/([^/]+)\/$/);
    if (match) return localizedProjectRoute({ ...context, params: { locale: match[1], owner: match[2], repo: match[3] } });
    match = url.pathname.match(/^\/browse\/(.*?)\/?$/);
    if (match) return browseRoute({ ...context, params: { page: match[1] } });
    match = url.pathname.match(/^\/categories\/([^/]+)\/(.*?)\/?$/);
    if (match) return categoryRoute({ ...context, params: { category: match[1], page: match[2] } });
    return assets.fetch(url);
  }
  return { DB, insert, dispatch, i18n };
}

function documentOf(t, html, url) {
  const dom = new JSDOM(html, { url });
  t.after(() => dom.window.close());
  return dom.window.document;
}

test("every locale project route returns usable internal journeys and consistent SEO metadata", async t => {
  const { insert, dispatch, i18n } = fixture(t);
  insert();
  insert({ repo: "other/similar", name: "Similar", stars: 20 });
  insert({ repo: "other/recent", name: "Recent", cat: "apps", stars: 10, pushed: "2026-09-25" });
  for (const [key, locale] of Object.entries(LOCALES)) {
    const path = locale.path + "projects/owner/example/";
    const response = await dispatch(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    const document = documentOf(t, html, origin + path);
    assert.equal(document.documentElement.lang, locale.lang);
    assert.equal(document.querySelector('link[rel="canonical"]').href, origin + path);
    assert.equal(document.querySelector('meta[name="description"]').content, example.desc);
    assert.ok(document.title.includes(example.repo));
    assert.equal(document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]').length, 1);
    assert.equal(document.querySelectorAll('script[src*="/assets/js/analytics.js"]').length, 1);
    assert.equal(document.querySelector(".breadcrumbs a:last-child").textContent, i18n.locales[key].messages["category.agents.name"]);
    const graph = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)["@graph"];
    assert.equal(graph[0].inLanguage, locale.lang);
    assert.equal(graph[0].dateModified, example.pushed);
    assert.equal(graph[1]["@type"], "BreadcrumbList");
    assert.equal(graph[1].itemListElement.at(-1).item, origin + path);
    const destinations = [...document.querySelectorAll('a[href],link[rel="alternate"]')].map(node => new URL(node.href, origin));
    const checked = new Set();
    for (const destination of destinations.filter(url => url.origin === origin)) {
      if (checked.has(destination.href)) continue;
      checked.add(destination.href);
      const linkedResponse = await dispatch(destination);
      assert.equal(linkedResponse.status, 200, `${key}: ${destination.href}`);
      if (destination.hash) {
        const linkedDocument = documentOf(t, await linkedResponse.text(), destination.href);
        assert.ok(linkedDocument.getElementById(destination.hash.slice(1)), `${key}: missing anchor ${destination.href}`);
      }
    }
    const switches = document.querySelectorAll(".footer a[hreflang]");
    assert.equal(switches.length, Object.keys(LOCALES).length);
    for (const link of switches) {
      assert.ok(new URL(link.href).pathname.endsWith("/projects/owner/example/"));
      const targetLocale = Object.values(LOCALES).find(item => item.hreflang === link.hreflang);
      if (targetLocale.label) assert.equal(link.textContent, targetLocale.label);
    }
  }
});

test("D1 recommendations exclude duplicate, archived, withdrawn, and undated active projects", async t => {
  const { DB, insert, dispatch } = fixture(t);
  insert();
  for (let i = 0; i < 6; i++) insert({ repo: `similar/item-${i}`, name: `Similar ${i}`, stars: 100 - i, pushed: "2026-09-28" });
  for (let i = 0; i < 6; i++) insert({ repo: `recent/item-${i}`, name: `Recent ${i}`, cat: "apps", stars: 50 - i, pushed: `2026-09-${String(27 - i).padStart(2, "0")}` });
  insert({ repo: "excluded/archived", cat: "apps", pushed: "2026-09-29", archived: true });
  insert({ repo: "excluded/unknown-status", cat: "apps", pushed: "2026-09-29", archived: null });
  insert({ repo: "excluded/no-date", cat: "apps", pushed: null });
  insert({ repo: "excluded/unknown-date", cat: "apps", pushed: "unknown" });
  insert({ repo: "excluded/invalid-date", cat: "apps", pushed: "2026-02-31" });
  insert({ repo: "excluded/inactive", cat: "apps", pushed: "2026-09-29" }, 0);
  insert({ repo: "excluded/withdrawn", cat: "apps", pushed: "2026-09-29" });
  DB.db.prepare("INSERT INTO catalog_withdrawals VALUES ('excluded/withdrawn', 1, 'reviewer')").run();
  const response = await dispatch("/projects/owner/example/");
  const document = documentOf(t, await response.text(), origin);
  const links = id => [...document.querySelectorAll(`#${id} .card__name`)].map(link => link.getAttribute("href"));
  const similar = links("similar-projects"), active = links("active-projects");
  assert.equal(similar.length, 6);
  assert.equal(active.length, 6);
  assert.equal(new Set([...similar, ...active]).size, 12);
  assert.ok(similar.every(url => url.startsWith("/projects/similar/")));
  assert.deepEqual(active, Array.from({ length: 6 }, (_, i) => `/projects/recent/item-${i}/`));
});

test("project alias, withdrawn and missing route responses preserve status and usable recovery", async t => {
  const { DB, insert, dispatch } = fixture(t);
  insert();
  insert({ repo: "owner/withdrawn" }, 0);
  DB.db.prepare("INSERT INTO catalog_aliases VALUES ('old/example', 'owner/example', 1)").run();
  const redirect = await dispatch("/zh-cn/projects/old/example/");
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), origin + "/zh-cn/projects/owner/example/");
  const withdrawn = await dispatch("/zh-cn/projects/owner/withdrawn/");
  assert.equal(withdrawn.status, 410);
  const document = documentOf(t, await withdrawn.text(), origin);
  assert.equal(document.querySelector('meta[name="robots"]').content, "noindex, nofollow");
  assert.equal(document.querySelectorAll('link[rel="alternate"]').length, 0);
  const recovery = document.querySelector("main a").href;
  assert.equal(new URL(recovery).pathname + new URL(recovery).hash, "/zh-cn/#apps");
  assert.equal((await dispatch(recovery)).status, 200);
  assert.equal((await dispatch("/projects/unknown/missing/")).status, 404);
});

test("live pagination has unique page titles and self canonical URLs", async t => {
  const { insert, dispatch } = fixture(t);
  for (let i = 0; i < 25; i++) insert({ repo: `owner/project-${i}`, name: `Project ${i}` });
  for (const base of ["/browse/", "/categories/agents/"]) {
    const first = documentOf(t, await (await dispatch(base)).text(), origin + base);
    const secondResponse = await dispatch(base + "2/");
    assert.equal(secondResponse.status, 200);
    const second = documentOf(t, await secondResponse.text(), origin + base + "2/");
    assert.notEqual(first.title, second.title);
    assert.ok(second.title.includes("page 2"));
    assert.equal(second.querySelector('link[rel="canonical"]').href, origin + base + "2/");
    assert.equal(second.querySelectorAll(".card").length, 1);
    assert.equal(second.querySelector('a[rel="prev"]').href, origin + base);
    assert.equal((await dispatch(base + "3/")).status, 404);
  }
});
