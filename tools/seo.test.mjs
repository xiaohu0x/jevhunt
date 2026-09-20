import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readPublic = file => readFileSync(resolve(root, "public", file), "utf8");
const index = readPublic("index.html");
const notFound = readPublic("404.html");
const main = readPublic("assets/js/main.js");
const data = readPublic("assets/js/data.js");
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

function contentOf(selector) {
  const match = index.match(selector);
  assert.ok(match, `Missing SEO field: ${selector}`);
  return match[1].trim();
}

test("primary SEO fields lead with JEV AI Model and stay within limits", () => {
  const title = decodeHtml(contentOf(/<title>([^<]+)<\/title>/i));
  const description = contentOf(/<meta name="description" content="([^"]+)"/i);
  const h1 = contentOf(/<h1[^>]*>([^<]+)<\/h1>/i);

  assert.match(title, /^JEV AI Model\b/);
  assert.match(description, /^JEV AI Model\b/);
  assert.match(h1, /^JEV AI Model\b/);
  assert.ok([...title].length <= 60, `Title is ${[...title].length} characters`);
  assert.ok([...description].length <= 160, `Description is ${[...description].length} characters`);
  assert.ok([...h1].length <= 80, `H1 is ${[...h1].length} characters`);
  assert.match(title, /Directory/);
  assert.match(h1, /projects directory/i);
  assert.match(description, /verified open-source projects/);
  assert.doesNotMatch(title + description + h1, /[\u3400-\u9fff]/);
  assert.equal(index.match(/<h1\b/gi)?.length, 1);
  assert.match(index, /<link rel="canonical" href="https:\/\/jevhunt\.com\/"/);
  assert.match(index, /<html lang="en"/);
  assert.doesNotMatch(index, /id="langBtn"/);
  assert.doesNotMatch(main, /jh-lang|applyLang/);
  assert.doesNotMatch(data, /JH\.i18n|catZh|\bzhDesc\b/);
  assert.doesNotMatch(editorialIndex + main + data, /[\u3400-\u9fff]/);
});

test("social metadata and structured data use the same canonical identity", () => {
  assert.match(index, /<meta property="og:title" content="JEV AI Model/);
  assert.match(index, /<meta name="twitter:title" content="JEV AI Model/);
  assert.match(index, /<meta property="og:image" content="https:\/\/jevhunt\.com\/og\.png\?v=2"/);

  const jsonLd = contentOf(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  const graph = JSON.parse(jsonLd)["@graph"];
  assert.ok(graph.some(item => item["@type"] === "WebSite" && item.url === "https://jevhunt.com/"));
  assert.ok(graph.some(item => item["@type"] === "CollectionPage" && /^JEV AI Model\b/.test(item.name)));
  assert.ok(graph.every(item => !item.inLanguage || item.inLanguage === "en"));
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
  const jsonLd = contentOf(/<script id="catalogStructuredData" type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  const itemList = JSON.parse(jsonLd);
  assert.equal(itemList["@type"], "ItemList");
  assert.equal(itemList.numberOfItems, 20);
  assert.equal(itemList.itemListElement.length, 20);
  assert.deepEqual(itemList.itemListElement.map(item => item.position), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.ok(itemList.itemListElement.every(item => item.item.codeRepository.startsWith("https://github.com/")));
});

test("manifest, sitemap and brand sources carry the updated identity", () => {
  const manifest = JSON.parse(readPublic("site.webmanifest"));
  assert.match(manifest.name, /^JEV AI Model\b/);
  assert.match(readPublic("sitemap.xml"), /<loc>https:\/\/jevhunt\.com\/<\/loc>/);
  assert.match(readPublic("favicon.svg"), /JevHunt J target mark/);
  assert.match(readPublic("og-source.svg"), />JEV AI<\/text>/);
});

test("first viewport includes the immediate OmniAKey API route", () => {
  assert.match(index, /Need JEV AI Model API access without waiting\?/);
  assert.match(index, /href="https:\/\/omniakey\.com\/"/);
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
  for (const [name, html] of [["index.html", index], ["404.html", notFound]]) {
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
