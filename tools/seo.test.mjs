import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readPublic = file => readFileSync(resolve(root, "public", file), "utf8");
const index = readPublic("index.html");
const notFound = readPublic("404.html");
const privacy = readPublic("privacy/index.html");
const terms = readPublic("terms/index.html");
const security = readPublic("security/index.html");
const main = readPublic("assets/js/main.js");
const data = readPublic("assets/js/data.js");
const i18n = readPublic("assets/js/i18n.js");
const localeSandbox = { window: { JH: {} } };
runInNewContext(i18n, localeSandbox);
const localeEntries = Object.entries(localeSandbox.window.JH.i18n.locales);
const localizedPages = localeEntries.map(([key, locale]) => ({
  key,
  locale,
  html: readPublic(key === "en" ? "index.html" : `${key}/index.html`),
}));
const editorialIndex = index.replace(
  /<!-- catalog-prerender:start -->[\s\S]*?<!-- catalog-prerender:end -->/,
  ""
);

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function visibleWords(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || "";
  const text = decodeHtml(body
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
  return text.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g) || [];
}

function contentOf(selector, html = index) {
  const match = html.match(selector);
  assert.ok(match, `Missing SEO field: ${selector}`);
  return match[1].trim();
}

test("every locale publishes search-oriented Title, Description and H1 fields", () => {
  for (const { key, locale, html } of localizedPages) {
    const title = decodeHtml(contentOf(/<title>([^<]+)<\/title>/i, html));
    const description = contentOf(/<meta name="description" content="([^"]+)"/i, html);
    const h1 = decodeHtml(contentOf(/<h1[^>]*>([^<]+)<\/h1>/i, html));
    const canonical = `https://jevhunt.com${locale.path}`;

    assert.match(title, /JEV AI/, `${key} title`);
    assert.match(description, /JEV AI/, `${key} description`);
    assert.match(h1, /JEV AI/, `${key} H1`);
    assert.ok([...title].length <= 65, `${key} title is ${[...title].length} characters`);
    assert.ok([...description].length <= 160, `${key} description is ${[...description].length} characters`);
    assert.ok([...h1].length <= 80, `${key} H1 is ${[...h1].length} characters`);
    assert.equal(html.match(/<h1\b/gi)?.length, 1, `${key} must have exactly one H1`);
    assert.match(html, new RegExp(`<html lang="${locale.lang}" data-locale="${key}"`));
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(html, new RegExp(`<option value="${locale.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" data-locale-option="${key}" selected>`));
    assert.equal(html.match(/rel="alternate" hreflang=/g)?.length, localeEntries.length + 1);
  }

  assert.match(index, /<title>JEV AI Model Directory/);
  assert.match(index, /id="languageSelect"/);
  assert.match(main, /initLocaleSelect/);
  assert.doesNotMatch(data, /catZh|\bzhDesc\b/);
});

test("social metadata and structured data use each locale's canonical identity", () => {
  for (const { key, locale, html } of localizedPages) {
    const canonical = `https://jevhunt.com${locale.path}`;
    assert.match(html, /<meta property="og:title" content="[^"]*JEV AI/);
    assert.match(html, /<meta name="twitter:title" content="[^"]*JEV AI/);
    assert.match(html, /<meta property="og:image" content="https:\/\/jevhunt\.com\/og\.png\?v=2"/);
    assert.match(html, new RegExp(`<meta property="og:locale" content="${locale.ogLocale}"`));

    const jsonLd = contentOf(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i, html);
    const graph = JSON.parse(jsonLd)["@graph"];
    assert.ok(graph.some(item => item["@type"] === "WebSite" && item.url === canonical), key);
    assert.ok(graph.some(item => item["@type"] === "CollectionPage" && item.url === canonical), key);
    assert.ok(graph.every(item => !item.inLanguage || item.inLanguage === locale.lang), key);
    assert.equal(graph.find(item => item["@type"] === "WebSite").availableLanguage.length, localeEntries.length);
  }
});

test("the initial catalog is prerendered within the target word count", () => {
  const catalog = contentOf(/<!-- catalog-prerender:start -->([\s\S]*?)<!-- catalog-prerender:end -->/i);
  assert.equal(catalog.match(/<article class="card">/g)?.length, 20);
  assert.equal(catalog.match(/<h2 class="card__heading">/g)?.length, 20);
  assert.match(index, /<span id="dirCount">Showing 20 of \d+ projects<\/span>/);
  assert.match(main, /const PAGE_SIZE = 20;/);

  const wordCount = visibleWords(index).length;
  assert.ok(wordCount >= 1200 && wordCount <= 1800, `Static body has ${wordCount} words`);

  const editorialMentions = (visibleWords(editorialIndex).join(" ").match(/\bJEV AI Model\b/g) || []).length;
  assert.ok(editorialMentions >= 6, `Only ${editorialMentions} editorial JEV AI Model mentions`);
});

test("prerendered projects publish matching ItemList structured data", () => {
  for (const { key, locale, html } of localizedPages) {
    const jsonLd = contentOf(/<script id="catalogStructuredData" type="application\/ld\+json">([\s\S]*?)<\/script>/i, html);
    const itemList = JSON.parse(jsonLd);
    assert.equal(itemList["@type"], "ItemList", key);
    assert.equal(itemList.numberOfItems, 20, key);
    assert.equal(itemList.itemListElement.length, 20, key);
    assert.equal(itemList.inLanguage, locale.lang, key);
    assert.equal(itemList["@id"], `https://jevhunt.com${locale.path}#projects`, key);
    assert.deepEqual(itemList.itemListElement.map(item => item.position), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.ok(itemList.itemListElement.every(item => item.item.codeRepository.startsWith("https://github.com/")), key);
  }
});

test("manifest, sitemap and brand sources carry the updated identity", () => {
  const manifest = JSON.parse(readPublic("site.webmanifest"));
  const sitemap = readPublic("sitemap.xml");
  assert.match(manifest.name, /^JEV AI Model\b/);
  for (const [, locale] of localeEntries) {
    assert.match(sitemap, new RegExp(`<loc>https://jevhunt\\.com${locale.path.replace(/\//g, "\\/")}<\\/loc>`));
    assert.match(sitemap, new RegExp(`hreflang="${locale.hreflang}" href="https://jevhunt\\.com${locale.path.replace(/\//g, "\\/")}"`));
  }
  assert.match(sitemap, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(sitemap, /hreflang="x-default" href="https:\/\/jevhunt\.com\/"/);
  assert.match(sitemap, /<loc>https:\/\/jevhunt\.com\/privacy\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/jevhunt\.com\/terms\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/jevhunt\.com\/security\/<\/loc>/);
  assert.match(readPublic("favicon.svg"), /JevHunt J target mark/);
  assert.match(readPublic("og-source.svg"), />JEV AI<\/text>/);
});

test("the home page does not promote third-party API access", () => {
  assert.doesNotMatch(index, /API access without waiting|instant API access/i);
});

test("editorial navigation points to the official JEV source", () => {
  assert.match(index, /href="https:\/\/typesafe\.ai\/"/);
  assert.doesNotMatch(index, /jevai\.org/i);
});

test("Google authentication stays visible in every auth state", () => {
  assert.match(index, /<div class="auth" id="auth"><\/div>/);
  assert.match(main, /auth__signin auth__signin--loading/);
  assert.match(main, /auth__signin auth__signin--disabled/);
  assert.match(main, /href="\/api\/auth\/google\?next=/);
});

test("every HTML page loads the configured Google tag exactly once", () => {
  const pages = [
    ["index.html", index],
    ...localizedPages.filter(page => page.key !== "en").map(page => [`${page.key}/index.html`, page.html]),
    ["404.html", notFound],
    ["privacy/index.html", privacy],
    ["terms/index.html", terms],
    ["security/index.html", security],
  ];
  for (const [name, html] of pages) {
    assert.match(html, /<head>\s*<!-- Google tag \(gtag\.js\) -->/);
    assert.equal(
      html.match(/googletagmanager\.com\/gtag\/js\?id=G-7QNDGTH1T4/g)?.length,
      1,
      `${name} must load gtag.js once`
    );
    assert.equal(
      html.match(/gtag\('config', 'G-7QNDGTH1T4'\)/g)?.length,
      1,
      `${name} must configure GA4 once`
    );
  }
});
