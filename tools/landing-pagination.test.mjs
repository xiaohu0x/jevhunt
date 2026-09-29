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
            setAttribute: (name, value) => element.setAttribute(name, value),
            removeAttribute: name => element.removeAttribute(name),
            setInnerContent: (value, options = {}) => { element[options.html ? "innerHTML" : "textContent"] = value; },
          });
        }
        controller.enqueue(new TextEncoder().encode(dom.serialize()));
        controller.close(); dom.window.close();
      } catch (error) { controller.error(error); }
    } }), response);
  }
}

test("refreshing page six serves only items 101–120, bottom links and a matching hydration seed", async t => {
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
  for (const locale of ["en", "zh-cn", "ru"]) {
    const path = locale === "en" ? "/" : `/${locale}/`;
    const response = await landing({ request: new Request(`https://jevhunt.com${path}?page=6&language=Python`),
      env: { DB, ASSETS: { fetch: async url => new Response(readFileSync("public" + new URL(url).pathname, "utf8"), { headers: { "content-type": "application/json" } }) } },
      next: async () => new Response(readFileSync("public" + path + "index.html", "utf8")),
    }, locale);
    const dom = new JSDOM(await response.text(), { url: "https://jevhunt.com" + path });
    const document = dom.window.document, cards = [...document.querySelectorAll("#appGrid .card__name")];
    assert.equal(cards.length, 20);
    assert.ok(cards[0].href.endsWith("/fixture/project-101/"));
    assert.ok(cards.at(-1).href.endsWith("/fixture/project-120/"));
    assert.match(document.getElementById("dirCount").textContent, /101–120/);
    assert.equal(document.getElementById("directoryPages"), null);
    const next = new URL(document.querySelector('#directoryPagesBottom [rel="next"]').href);
    assert.equal(next.searchParams.get("page"), "7"); assert.equal(next.searchParams.get("language"), "Python"); assert.equal(next.pathname, path);
    const seed = JSON.parse(document.getElementById("liveCatalogSeed").textContent);
    assert.equal(seed.pagination.page, 6); assert.equal(seed.pagination.start, 101); assert.equal(seed.apps[0].repo, "fixture/project-101");
    const schema = JSON.parse(document.getElementById("catalogStructuredData").textContent);
    assert.equal(schema.itemListElement[0].position, 101);
    assert.match(document.getElementById("catalogUpdated").textContent, /UTC$/);
    assert.equal(document.getElementById("catalogUpdated").getAttribute("datetime"), seed.meta.syncedAt);
    dom.window.close();
  }
});
