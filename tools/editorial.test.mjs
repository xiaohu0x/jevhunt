import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import editorial from "../content/editorial.json" with { type: "json" };
import intents from "../docs/gsc-intent-plan.json" with { type: "json" };
import { EDITORIAL_ROUTES, editorialNavigation } from "../shared/editorial-routes.js";
import { LOCALES } from "../shared/locales.js";
import { onRequestGet as sitemap } from "../functions/sitemap.xml.js";
import { database } from "./helpers/d1.mjs";

const read = path => readFileSync("public" + path + (path.endsWith("/") ? "index.html" : ""), "utf8");
const dom = path => new JSDOM(read(path), { url: "https://jevhunt.com" + path });

test("every original GSC query has one main intent and a rendered target anchor", t => {
  const rows = intents.groups.flatMap(group => group.rows).sort((a, b) => a - b);
  assert.deepEqual(rows, Array.from({ length: 192 }, (_, index) => index + 2));
  for (const group of intents.groups) {
    const url = new URL(group.target, "https://jevhunt.com");
    assert.ok(EDITORIAL_ROUTES.some(route => route.path === url.pathname), group.id);
    if (url.hash) {
      const document = dom(url.pathname); t.after(() => document.window.close());
      assert.ok(document.window.document.getElementById(url.hash.slice(1)), group.target);
    }
  }
  assert.equal(intents.formulaRecovery.row, 128);
  assert.ok(intents.groups.find(group => group.id === "research").rows.includes(128));
});

test("rendered guides and FAQs have matching, indexable metadata and honest language identity", t => {
  const titles = new Set();
  for (const { path } of EDITORIAL_ROUTES) {
    const document = dom(path); t.after(() => document.window.close());
    const d = document.window.document;
    assert.equal(d.querySelectorAll("h1").length, 1, path);
    assert.equal(d.querySelector('link[rel="canonical"]').href, "https://jevhunt.com" + path);
    assert.ok(!d.querySelector('meta[name="robots"]')?.content.includes("noindex"), path);
    assert.ok(!titles.has(d.title), path); titles.add(d.title);
    assert.equal(d.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]').length, 1, path);
    assert.equal(d.querySelector('meta[property="og:url"]').content, "https://jevhunt.com" + path);
    const schema = JSON.parse(d.querySelector('script[type="application/ld+json"]').textContent);
    const article = editorial.articles.find(article => path === `/blog/${article.slug}/`);
    if (article) {
      const posting = schema["@graph"].find(node => node["@type"] === "BlogPosting");
      assert.equal(posting.headline, d.querySelector("h1").textContent);
      assert.equal(posting.mainEntityOfPage, "https://jevhunt.com" + path);
      assert.equal(posting.inLanguage, "en");
      assert.equal(posting.dateModified, d.querySelector("time").dateTime);
      assert.equal(d.querySelector('meta[name="description"]').content, article.description);
      assert.equal(d.querySelector('meta[property="og:type"]').content, "article");
    } else if (path.endsWith("faq/")) {
      const faq = editorial.faqPages.find(page => page.path === path);
      assert.equal(d.documentElement.lang, LOCALES[faq.locale].lang);
      assert.equal(schema.inLanguage, LOCALES[faq.locale].lang);
      assert.equal(schema["@type"], "WebPage");
      assert.equal(d.querySelector('link[hreflang]'), null, "Different FAQ task coverage is not a translation set");
    }
  }
});

test("contents, related guides and FAQ links resolve to real content", t => {
  for (const { path } of EDITORIAL_ROUTES) {
    const document = dom(path); t.after(() => document.window.close());
    const d = document.window.document;
    const ids = [...d.querySelectorAll("[id]")].map(element => element.id);
    assert.equal(new Set(ids).size, ids.length, path);
    for (const link of d.querySelectorAll("main a[href]")) {
      const target = new URL(link.href);
      if (target.origin !== "https://jevhunt.com") continue;
      if (target.pathname === path && target.hash) assert.ok(d.getElementById(decodeURIComponent(target.hash.slice(1))), link.href);
      if (EDITORIAL_ROUTES.some(entry => entry.path === target.pathname)) {
        assert.ok(existsSync("public" + target.pathname + "index.html"), link.href);
        if (target.hash && target.pathname !== path) {
          const other = dom(target.pathname); t.after(() => other.window.close());
          assert.ok(other.window.document.getElementById(decodeURIComponent(target.hash.slice(1))), link.href);
        }
      }
      if (target.searchParams.has("q")) assert.equal(target.pathname, "/", "Filtered discovery belongs to the live landing route");
    }
  }
});

test("the live and fallback sitemaps both include every editorial route once", async t => {
  const db = database(); t.after(() => db.db.close());
  const response = await sitemap({ env: { DB: db } });
  const live = new JSDOM(await response.text(), { contentType: "application/xml" });
  const fallback = new JSDOM(read("/sitemap.xml"), { contentType: "application/xml" });
  t.after(() => { live.window.close(); fallback.window.close(); });
  for (const document of [live, fallback]) {
    const urls = [...document.window.document.getElementsByTagName("loc")].map(element => element.textContent);
    for (const { path } of EDITORIAL_ROUTES) assert.equal(urls.filter(url => url === "https://jevhunt.com" + path).length, 1, path);
    assert.ok(!urls.includes("https://jevhunt.com/admin/"));
  }
});

test("direct FAQ links open the requested answer and malformed hashes stay harmless", t => {
  const document = new JSDOM(read("/faq/"), { url: "https://jevhunt.com/faq/#download", runScripts: "outside-only" });
  t.after(() => document.window.close());
  document.window.eval(read("/assets/js/faq.js"));
  assert.equal(document.window.document.getElementById("download").open, true);
  document.window.location.hash = "#pii";
  document.window.dispatchEvent(new document.window.HashChangeEvent("hashchange"));
  assert.equal(document.window.document.getElementById("pii").open, true);
  document.window.location.hash = "#%E0%A4%A";
  assert.doesNotThrow(() => document.window.dispatchEvent(new document.window.HashChangeEvent("hashchange")));
});

test("editorial screenshots have real image bytes and stable aspect ratios", t => {
  const document = dom("/blog/jev-cookbook-use-cases/"); t.after(() => document.window.close());
  const image = document.window.document.querySelector("figure img");
  const bytes = readFileSync("public" + new URL(image.src).pathname);
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.equal(bytes.readUInt32BE(16), image.width);
  assert.equal(bytes.readUInt32BE(20), image.height);
  assert.ok(image.alt);
  assert.ok(document.window.document.querySelector("figure figcaption a[href*='github.com']"));
});

test("every landing locale has the correct guide and FAQ destinations", t => {
  for (const [locale, info] of Object.entries(LOCALES)) {
    const document = dom(info.path); t.after(() => document.window.close());
    const links = [...document.window.document.querySelectorAll(".nav__links [data-editorial-link]")];
    assert.equal(links.length, 2, locale);
    for (const destination of editorialNavigation(locale)) assert.ok(links.some(link => link.pathname === destination.path && link.textContent === destination.label), locale);
  }
});
