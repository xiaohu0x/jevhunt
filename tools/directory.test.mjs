import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { loadData, projectPath, hash } from "./lib/site.mjs";
import { JSDOM } from "jsdom";
import { renderProject } from "../shared/catalog-view.js";
const { apps, i18n, catalogMeta } = loadData();
const read = path => readFileSync("public/" + path, "utf8");

test("every indexed repository has a unique local page, safe evidence, and crawlable sitemap entry", () => {
  const sitemap = read("sitemap.xml"), repos = new Set(), ids = new Set();
  for (const project of apps) {
    assert.ok(!repos.has(project.repo.toLowerCase()), project.repo); repos.add(project.repo.toLowerCase());
    if (project.id) { assert.ok(!ids.has(project.id), project.repo); ids.add(project.id); }
    const path = projectPath(project.repo);
    assert.ok(existsSync("public" + path + "index.html"), path);
    assert.ok(sitemap.includes("https://jevhunt.com" + path), path);
    const evidence = new URL(project.evidence);
    assert.equal(evidence.origin, "https://github.com", project.repo);
    if (project.evidenceLevel !== "legacy-unreviewed") assert.match(evidence.pathname, /\/(?:blob|tree)\/[a-f0-9]{40}(?:\/|$)/, project.repo);
    assert.ok(project.evidenceLevel, project.repo);
  }
});
test("the initial browser payload is bounded and full catalog data is loaded separately", () => {
  const source = read("assets/js/projects.js"), sandbox = { window: { JH: {} } };
  runInNewContext(source, sandbox);
  assert.equal(sandbox.window.JH.apps.length, 20);
  assert.equal(sandbox.window.JH.catalogMeta.projectCount, apps.length);
  assert.ok(Buffer.byteLength(source) < 60_000, "The initial index should not contain the whole catalog");
  runInNewContext(read("assets/js/catalog-all.js"), sandbox);
  assert.equal(sandbox.window.JH.apps.length, apps.length);
  assert.equal(sandbox.window.JH.catalogLoaded, true);
});
test("locale pages load only their own messages and the main script is a module", () => {
  for (const [key, locale] of Object.entries(i18n.locales)) {
    const html = read(locale.path.slice(1) + "index.html");
    assert.ok(html.includes(`/assets/js/locales/${key}.js?v=`), key);
    assert.doesNotMatch(html, /src="\/assets\/js\/i18n\.js/);
    assert.match(html, /<script type="module" src="\/assets\/js\/main\.js/);
    const sandbox = { window: { JH: {} } };
    runInNewContext(read(`assets/js/locales/${key}.js`), sandbox);
    assert.deepEqual(Object.keys(sandbox.window.JH.i18n.locales), [key]);
  }
});
test("release manifest describes the files actually built", () => {
  const manifest = JSON.parse(read("build-info.json"));
  assert.equal(manifest.catalogHash, catalogMeta.catalogHash);
  assert.equal(manifest.projectCount, apps.length);
  for (const asset of manifest.assets) assert.equal(hash(readFileSync("public" + asset.path + (asset.path.endsWith("/") ? "index.html" : ""))), asset.hash, asset.path);
  assert.doesNotMatch(read("sitemap.xml"), /<loc>https:\/\/jevhunt\.com\/admin\//);
  assert.match(read("admin/index.html"), /noindex, nofollow/);
});

test("static project fallbacks share live SEO metadata and both recommendation sections", t => {
  const samples = [...new Set([apps[0], apps.find(project => !project.desc), apps.find(project => project.relationship === "resource")].filter(Boolean))];
  for (const project of samples) {
    const path = projectPath(project.repo);
    const built = new JSDOM(read(path.slice(1) + "index.html"), { url: "https://jevhunt.com" + path });
    const live = new JSDOM(renderProject(project, catalogMeta, [], [], i18n.locales.en.messages, { localeInfo: i18n.locales.en }));
    t.after(() => { built.window.close(); live.window.close(); });
    const actual = built.window.document, expected = live.window.document;
    assert.equal(actual.title, expected.title, path);
    assert.ok(actual.title.includes(project.repo), path);
    assert.equal(actual.querySelector('link[rel="canonical"]').href, "https://jevhunt.com" + path);
    assert.equal(actual.querySelector('meta[name="description"]').content, expected.querySelector('meta[name="description"]').content);
    const schema = document => JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
    assert.deepEqual(schema(actual), schema(expected), path);
    assert.equal(schema(actual)["@graph"][0].inLanguage, "en");
    assert.equal(schema(actual)["@graph"][1]["@type"], "BreadcrumbList");
    assert.equal(actual.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]').length, 1);
    assert.equal(actual.querySelectorAll('script[src*="/assets/js/analytics.js"]').length, 1);
    assert.ok(actual.querySelector("#similar-projects"), path);
    assert.ok(actual.querySelector("#active-projects"), path);
    const recommendations = [...actual.querySelectorAll(".related .card__name")].map(link => link.pathname);
    assert.equal(new Set(recommendations).size, recommendations.length, path);
    assert.ok(recommendations.every(link => link !== path), path);
  }
});

test("static pagination publishes the same page identity as live pagination", t => {
  const dom = new JSDOM(read("browse/2/index.html"), { url: "https://jevhunt.com/browse/2/" });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  assert.equal(document.title, "Jev ecosystem projects — page 2 | JevHunt");
  assert.equal(document.querySelector('link[rel="canonical"]').href, "https://jevhunt.com/browse/2/");
  const schema = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
  assert.equal(schema.inLanguage, "en");
  assert.equal(schema.itemListElement[0].position, 25);
  assert.equal(document.querySelector('a[rel="prev"]').href, "https://jevhunt.com/browse/");
});
