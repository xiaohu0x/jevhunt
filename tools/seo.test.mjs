import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readPublic = file => readFileSync(resolve(root, "public", file), "utf8");
const index = readPublic("index.html");
const main = readPublic("assets/js/main.js");
const data = readPublic("assets/js/data.js");

function contentOf(selector) {
  const match = index.match(selector);
  assert.ok(match, `Missing SEO field: ${selector}`);
  return match[1].trim();
}

test("primary SEO fields lead with JEV AI and describe the directory", () => {
  const title = contentOf(/<title>([^<]+)<\/title>/i);
  const description = contentOf(/<meta name="description" content="([^"]+)"/i);
  const h1 = contentOf(/<h1[^>]*>([^<]+)<\/h1>/i);

  assert.match(title, /^JEV AI\b/);
  assert.match(description, /^JEV AI\b/);
  assert.match(h1, /^JEV AI\b/);
  assert.match(title, /Software Directory/);
  assert.match(description, /verified open-source projects/);
  assert.doesNotMatch(title + description + h1, /[\u3400-\u9fff]/);
  assert.equal(index.match(/<h1\b/gi)?.length, 1);
  assert.match(index, /<link rel="canonical" href="https:\/\/jevhunt\.com\/"/);
  assert.match(index, /<html lang="en"/);
  assert.doesNotMatch(index, /id="langBtn"/);
  assert.doesNotMatch(main, /jh-lang|applyLang/);
  assert.doesNotMatch(data, /JH\.i18n|catZh|\bzhDesc\b/);
  assert.doesNotMatch(index + main + data, /[\u3400-\u9fff]/);
});

test("social metadata and structured data use the same canonical identity", () => {
  assert.match(index, /<meta property="og:title" content="JEV AI/);
  assert.match(index, /<meta name="twitter:title" content="JEV AI/);
  assert.match(index, /<meta property="og:image" content="https:\/\/jevhunt\.com\/og\.png\?v=2"/);

  const jsonLd = contentOf(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  const graph = JSON.parse(jsonLd)["@graph"];
  assert.ok(graph.some(item => item["@type"] === "WebSite" && item.url === "https://jevhunt.com/"));
  assert.ok(graph.some(item => item["@type"] === "CollectionPage" && /^JEV AI\b/.test(item.name)));
  assert.ok(graph.every(item => !item.inLanguage || item.inLanguage === "en"));
});

test("manifest, sitemap and brand sources carry the updated identity", () => {
  const manifest = JSON.parse(readPublic("site.webmanifest"));
  assert.match(manifest.name, /^JEV AI\b/);
  assert.match(readPublic("sitemap.xml"), /<loc>https:\/\/jevhunt\.com\/<\/loc>/);
  assert.match(readPublic("favicon.svg"), /JevHunt J target mark/);
  assert.match(readPublic("og-source.svg"), />JEV AI<\/text>/);
});

test("first viewport includes the immediate OmniAKey API route", () => {
  assert.match(index, /Need the JEV model API without waiting\?/);
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
