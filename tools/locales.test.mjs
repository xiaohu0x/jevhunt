import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { LOCALES } from "../shared/locales.js";
import { onRequestGet as localeRoute } from "../functions/[locale]/index.js";
import { onRequestGet as sitemap } from "../functions/sitemap.xml.js";
import { database } from "./helpers/d1.mjs";
import { loadData } from "./lib/site.mjs";

test("all supported locale routes read the live catalog; unrelated paths fall through", async t => {
  const { i18n } = loadData();
  assert.deepEqual(Object.keys(LOCALES), Object.keys(i18n.locales));
  const DB = database();
  t.after(() => DB.db.close());
  let catalogReads = 0;
  const originalBatch = DB.batch.bind(DB);
  DB.batch = statements => { catalogReads++; return originalBatch(statements); };
  for (const key of [...Object.keys(LOCALES).filter(key => key !== "en"), "ar", "fa", "en", "unknown", "constructor", "toString"]) {
    const before = catalogReads;
    const fallback = new Response("static fallback");
    const response = await localeRoute({ params: { locale: key }, env: { DB }, next: () => fallback });
    assert.equal(response, fallback, key);
    assert.equal(catalogReads - before, Object.hasOwn(LOCALES, key) && key !== "en" ? 1 : 0, key);
  }
});

test("the live sitemap publishes reciprocal language alternates for every landing page", async t => {
  const DB = database();
  t.after(() => DB.db.close());
  const response = await sitemap({ env: { DB } });
  const dom = new JSDOM(await response.text(), { contentType: "application/xml" });
  t.after(() => dom.window.close());
  const urls = [...dom.window.document.querySelectorAll("url")];
  for (const locale of Object.values(LOCALES)) {
    const url = urls.find(node => node.querySelector("loc").textContent === "https://jevhunt.com" + locale.path);
    assert.ok(url, locale.path);
    const links = [...url.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "link")];
    assert.equal(links.length, 16, locale.path);
    for (const alternate of Object.values(LOCALES)) {
      assert.ok(links.some(link => link.getAttribute("hreflang") === alternate.hreflang && link.getAttribute("href") === "https://jevhunt.com" + alternate.path), alternate.path);
    }
    assert.ok(links.some(link => link.getAttribute("hreflang") === "x-default" && link.getAttribute("href") === "https://jevhunt.com/"));
  }
  const policy = urls.find(node => node.querySelector("loc").textContent.endsWith("/privacy/"));
  assert.equal(policy.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "link").length, 0);
});
