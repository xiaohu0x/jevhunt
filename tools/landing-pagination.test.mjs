import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { database } from "./helpers/d1.mjs";
import { publicPreview } from "../shared/catalog-data.js";
import { landing } from "../functions/_lib/catalog-pages.js";

// Exercise the real landing handler and D1 queries; only Cloudflare's HTML adapter is emulated.
class TestRewriter {
  handlers = [];
  on(selector, handler) { this.handlers.push([selector, handler]); return this; }
  transform(response) {
    const handlers = this.handlers;
    return new Response(new ReadableStream({ async start(controller) {
      try {
        const dom = new JSDOM(await response.text());
        for (const [selector, handler] of handlers) for (const element of dom.window.document.querySelectorAll(selector)) {
          handler.element({
            getAttribute: name => element.getAttribute(name),
            setAttribute: (name, value) => element.setAttribute(name, value),
            removeAttribute: name => element.removeAttribute(name),
            remove: () => element.remove(),
            setInnerContent: (value, options = {}) => { element[options.html ? "innerHTML" : "textContent"] = value; },
          });
        }
        controller.enqueue(new TextEncoder().encode(dom.serialize()));
        controller.close(); dom.window.close();
      } catch (error) { controller.error(error); }
    } }), response);
  }
}

function setup(t) {
  const DB = database(); t.after(() => DB.db.close());
  const original = Object.getOwnPropertyDescriptor(globalThis, "HTMLRewriter");
  Object.defineProperty(globalThis, "HTMLRewriter", { configurable: true, value: TestRewriter });
  t.after(() => original ? Object.defineProperty(globalThis, "HTMLRewriter", original) : delete globalThis.HTMLRewriter);
  DB.db.prepare("UPDATE catalog_control SET published_at=1790640000,revision='pagination-test'").run();
  for (let i = 1; i <= 125; i++) {
    const p = { repo: `fixture/project-${i}`, name: `Project ${i}`, cat: "apps", relationship: "jev-app", language: "Python", stars: 1000 - i, created: "2026-09-20", desc: "A project", freshness: "current", evidenceLevel: "documented", evidence: "https://github.com/fixture/source", archived: false };
    DB.db.prepare("INSERT INTO catalog_entries(repo,payload,preview,name,category,relationship,language,stars,created,active,checked_at,next_check_at) VALUES(?,?,?,?,?,?,?,?,?,1,1,2)")
      .run(p.repo, JSON.stringify(p), JSON.stringify(publicPreview(p)), p.name, p.cat, p.relationship, p.language, p.stars, p.created);
  }
  return async (locale, search = "") => {
    const path = locale === "en" ? "/" : `/${locale}/`;
    const response = await landing({ request: new Request(`https://jevhunt.com${path}${search}`),
      env: { DB, ASSETS: { fetch: async url => new Response(readFileSync("public" + new URL(url).pathname, "utf8"), { headers: { "content-type": "application/json" } }) } },
      next: async () => new Response(readFileSync("public" + path + "index.html", "utf8")),
    }, locale);
    const dom = new JSDOM(await response.text(), { url: "https://jevhunt.com" + path + search });
    t.after(() => dom.window.close());
    return { document: dom.window.document, path, messages: JSON.parse(readFileSync(`public/assets/locales/${locale}.json`, "utf8")).messages };
  };
}
const schemaGraph = document => JSON.parse(document.querySelector('script[type="application/ld+json"]:not([id])').textContent)["@graph"];
const seedOf = document => JSON.parse(document.getElementById("liveCatalogSeed").textContent);

test("refreshing page six serves only items 101–120, bottom links and a matching hydration seed", async t => {
  const render = setup(t);
  for (const locale of ["en", "zh-cn", "ru"]) {
    const { document, path } = await render(locale, "?page=6&language=Python");
    const cards = [...document.querySelectorAll("#appGrid .card__name")];
    assert.equal(cards.length, 20);
    assert.ok(cards[0].href.endsWith("/fixture/project-101/"));
    assert.ok(cards.at(-1).href.endsWith("/fixture/project-120/"));
    assert.match(document.getElementById("dirCount").textContent, /101–120/);
    assert.equal(document.getElementById("directoryPages"), null);
    const next = new URL(document.querySelector('#directoryPagesBottom [rel="next"]').href);
    assert.equal(next.searchParams.get("page"), "7"); assert.equal(next.searchParams.get("language"), "Python"); assert.equal(next.pathname, path);
    const seed = seedOf(document);
    assert.equal(seed.pagination.page, 6); assert.equal(seed.pagination.start, 101); assert.equal(seed.apps[0].repo, "fixture/project-101");
    const schema = JSON.parse(document.getElementById("catalogStructuredData").textContent);
    assert.equal(schema.itemListElement[0].position, 101);
    assert.match(document.getElementById("catalogUpdated").textContent, /UTC$/);
    assert.equal(document.getElementById("catalogUpdated").getAttribute("datetime"), seed.meta.syncedAt);
  }
});

test("SSR restores localized search controls, category selection, and empty-result context", async t => {
  const render = setup(t);
  for (const locale of ["en", "zh-cn", "ru"]) {
    const { document, path, messages } = await render(locale, "?q=PROJECT&language=Python&category=apps&kind=jev-app&activity=active&sort=name-asc");
    assert.equal(document.getElementById("dirSearch").value, "project");
    assert.equal(document.getElementById("languageFilter").value, "Python");
    assert.equal(document.getElementById("kindFilter").value, "jev-app");
    assert.equal(document.getElementById("activityFilter").value, "active");
    assert.equal(document.getElementById("dirSort").value, "name-asc");
    assert.equal(document.querySelector('#languageFilter option[value="all"]').textContent, messages["apps.allLanguages"]);
    assert.deepEqual([...document.querySelectorAll("#dirFilters button")].map(button => button.dataset.cat), ["all", "apps"]);
    assert.equal(document.querySelector('#dirFilters [aria-pressed="true"]').dataset.cat, "apps");
    assert.equal(document.querySelector('#dirFilters [data-cat="apps"]').textContent, messages["category.apps.name"]);
    assert.equal(document.querySelector('#dirFilters [data-cat="all"]').textContent, messages["apps.all"]);
    assert.equal(document.getElementById("dirEmpty").hidden, true);
    assert.equal(document.querySelector('meta[name="robots"]').content, "noindex, follow");
    assert.equal(document.querySelector('link[rel="canonical"]').href, "https://jevhunt.com" + path);
    assert.equal(document.querySelectorAll('link[rel="alternate"][hreflang]').length, 0);
    const graph = schemaGraph(document), collection = graph.find(node => node["@type"] === "CollectionPage");
    assert.equal(new URL(collection.url).searchParams.get("q"), "project");
    assert.equal(JSON.parse(document.getElementById("catalogStructuredData").textContent)["@id"], collection.url + "#projects");
    const empty = (await render(locale, "?q=no-such-project&language=Rust&kind=sdk&activity=archived&sort=updated-desc")).document;
    assert.equal(empty.getElementById("dirSearch").value, "no-such-project");
    assert.equal(empty.getElementById("languageFilter").value, "Rust", "A requested absent language remains visible instead of silently selecting All");
    assert.equal(empty.getElementById("kindFilter").value, "sdk");
    assert.equal(empty.getElementById("activityFilter").value, "archived");
    assert.equal(empty.getElementById("dirSort").value, "updated-desc");
    assert.equal(empty.querySelectorAll("#appGrid .card").length, 0);
    assert.equal(empty.getElementById("dirEmpty").hidden, false);
    assert.equal(empty.getElementById("directoryPagesBottom").textContent, "");
    assert.equal(empty.querySelector('meta[name="robots"]').content, "noindex, follow");
  }
});

test("pure SSR pagination has self canonical and language alternates with a stable WebSite identity", async t => {
  const render = setup(t);
  for (const locale of ["en", "zh-cn", "ru"]) {
    const { document, path, messages } = await render(locale, "?page=6");
    const home = "https://jevhunt.com" + path, page = home + "?page=6";
    const label = messages["apps.page"].replace("{page}", "6").replace("{pages}", "7");
    assert.ok(document.title.includes(label));
    assert.equal(document.querySelector('meta[property="og:title"]').content, document.title);
    assert.equal(document.querySelector('meta[name="twitter:title"]').content, document.title);
    assert.equal(document.querySelector('link[rel="canonical"]').href, page);
    assert.equal(document.querySelector('meta[property="og:url"]').content, page);
    assert.ok(!document.querySelector('meta[name="robots"]').content.includes("noindex"));
    const alternates = [...document.querySelectorAll('link[rel="alternate"][hreflang]')];
    assert.equal(alternates.length, 16);
    assert.ok(alternates.every(link => new URL(link.href).search === "?page=6"));
    assert.equal(document.querySelector('link[hreflang="x-default"]').href, "https://jevhunt.com/?page=6");
    const graph = schemaGraph(document), site = graph.find(node => node["@type"] === "WebSite"), collection = graph.find(node => node["@type"] === "CollectionPage");
    assert.equal(site.url, home); assert.equal(site["@id"], home + "#website");
    assert.equal(collection.url, page); assert.equal(collection["@id"], page + "#directory");
    assert.equal(collection.isPartOf["@id"], site["@id"]);
    assert.equal(JSON.parse(document.getElementById("catalogStructuredData").textContent)["@id"], page + "#projects");
    const first = (await render(locale, "?page=1")).document;
    assert.equal(first.querySelector('link[rel="canonical"]').href, home);
    assert.ok([...first.querySelectorAll('link[rel="alternate"][hreflang]')].every(link => !new URL(link.href).search));
    assert.notEqual(first.title, document.title);
    const clamped = (await render(locale, "?page=999")).document;
    assert.equal(clamped.querySelector('link[rel="canonical"]').href, home + "?page=7");
    assert.equal(seedOf(clamped).query.page, 7);
    assert.equal(seedOf(clamped).pagination.page, 7);
    const sorted = (await render(locale, "?sort=updated-desc&page=2")).document;
    assert.equal(sorted.querySelector('meta[name="robots"]').content, "noindex, follow");
    assert.equal(sorted.querySelector('link[rel="canonical"]').href, home);
  }
});
