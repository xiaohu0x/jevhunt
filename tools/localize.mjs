#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(root, "public");
const indexPath = resolve(publicDir, "index.html");
const localeDataPath = resolve(publicDir, "assets/js/i18n.js");
const sitemapPath = resolve(publicDir, "sitemap.xml");
const origin = "https://jevhunt.com";

const sandbox = { window: { JH: {} } };
runInNewContext(readFileSync(localeDataPath, "utf8"), sandbox, { filename: localeDataPath });

const { defaultLocale, locales } = sandbox.window.JH.i18n || {};
if (!defaultLocale || !locales || !locales[defaultLocale]) {
  throw new Error("Locale catalog is missing a valid default locale");
}

const entries = Object.entries(locales);
const escapePattern = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeHtml = value => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Missing ${label} in public/index.html`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

function replaceMeta(source, attribute, name, value) {
  const pattern = new RegExp(`<meta\\s+[^>]*\\b${attribute}="${escapePattern(name)}"[^>]*>`, "i");
  return replaceRequired(source, pattern, tag => {
    if (!/\bcontent="[^"]*"/i.test(tag)) throw new Error(`Missing content on ${attribute}=${name}`);
    return tag.replace(/\bcontent="[^"]*"/i, `content="${escapeHtml(value)}"`);
  }, `${attribute}=${name}`);
}

function translateElements(source, messages) {
  let html = source;
  for (const [key, value] of Object.entries(messages)) {
    const escapedKey = escapePattern(key);
    const htmlPattern = new RegExp(`(<([a-z][\\w:-]*)\\b[^>]*\\bdata-i18n-html="${escapedKey}"[^>]*>)[\\s\\S]*?(</\\2>)`, "gi");
    html = html.replace(htmlPattern, (_match, opening, _tag, closing) => `${opening}${value}${closing}`);

    const textPattern = new RegExp(`(<([a-z][\\w:-]*)\\b[^>]*\\bdata-i18n="${escapedKey}"[^>]*>)[\\s\\S]*?(</\\2>)`, "gi");
    html = html.replace(textPattern, (_match, opening, _tag, closing) => `${opening}${escapeHtml(value)}${closing}`);

    for (const [marker, attribute] of [
      ["data-i18n-ph", "placeholder"],
      ["data-i18n-aria-label", "aria-label"],
      ["data-i18n-title", "title"],
    ]) {
      const tagPattern = new RegExp(`<[^>]*\\b${marker}="${escapedKey}"[^>]*>`, "gi");
      html = html.replace(tagPattern, tag => {
        const attributePattern = new RegExp(`\\b${attribute}="[^"]*"`, "i");
        if (!attributePattern.test(tag)) return tag;
        return tag.replace(attributePattern, `${attribute}="${escapeHtml(value)}"`);
      });
    }
  }
  return html;
}

function localizePrerenderedCatalog(source, messages) {
  let html = source;
  const countPattern = /(<span id="dirCount">)Showing ([\d,]+) of ([\d,]+) projects(<\/span>)/;
  html = html.replace(countPattern, (_match, opening, shown, total, closing) =>
    opening + messages["apps.count"]
      .replace("{shown}", shown)
      .replace("{total}", total) + closing
  );

  for (const category of ["official", "sdks", "integrations", "agents", "browser", "apps", "games", "demos", "research", "lists"]) {
    const english = enMessages[`category.${category}.name`];
    const localized = messages[`category.${category}.name`];
    const pattern = new RegExp(`(<span class="badge badge--catalog">)${escapePattern(escapeHtml(english))}(<\\/span>)`, "g");
    html = html.replace(pattern, `$1${escapeHtml(localized)}$2`);
  }

  html = html.replace(/(<span class="tag">)published (\d{4}-\d{2}-\d{2})(<\/span>)/g,
    (_match, opening, date, closing) => opening + escapeHtml(messages["apps.published"].replace("{date}", date)) + closing);
  html = html.replace(/(<span class="tag">)updated (\d{4}-\d{2}-\d{2})(<\/span>)/g,
    (_match, opening, date, closing) => opening + escapeHtml(messages["apps.updated"].replace("{date}", date)) + closing);
  html = html.replace(/(<span class="tag">)update date unknown(<\/span>)/g,
    `$1${escapeHtml(messages["apps.unknownUpdate"])}$2`);
  html = html.replace(/aria-label="([\d,]+) GitHub stars"/g,
    (_match, count) => `aria-label="${escapeHtml(messages["apps.starsLabel"].replace("{count}", count))}"`);
  return html;
}

function updateStructuredData(source, locale, canonical) {
  let html = source;
  const graphPattern = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/i;
  html = replaceRequired(html, graphPattern, (_match, opening, json, closing) => {
    const data = JSON.parse(json);
    for (const item of data["@graph"] || []) {
      if (item["@type"] === "WebSite") {
        item["@id"] = `${canonical}#website`;
        item.url = canonical;
        item.name = locale.seo.websiteName;
        item.description = locale.seo.description;
        item.inLanguage = locale.lang;
        item.availableLanguage = entries.map(([, entry]) => ({
          "@type": "Language",
          name: entry.label,
          alternateName: entry.hreflang,
        }));
      }
      if (item["@type"] === "CollectionPage") {
        item["@id"] = `${canonical}#directory`;
        item.url = canonical;
        item.name = locale.seo.collectionName;
        item.description = locale.seo.description;
        item.inLanguage = locale.lang;
        item.isPartOf = { "@id": `${canonical}#website` };
      }
    }
    return `${opening}\n${JSON.stringify(data, null, 2).replace(/</g, "\\u003c")}\n${closing}`;
  }, "WebSite structured data");

  const listPattern = /(<script id="catalogStructuredData" type="application\/ld\+json">)([\s\S]*?)(<\/script>)/i;
  html = replaceRequired(html, listPattern, (_match, opening, json, closing) => {
    const data = JSON.parse(json);
    data["@id"] = `${canonical}#projects`;
    data.name = locale.seo.itemListName;
    data.description = locale.seo.itemListDescription;
    data.inLanguage = locale.lang;
    return `${opening}\n${JSON.stringify(data, null, 2).replace(/</g, "\\u003c")}\n${closing}`;
  }, "ItemList structured data");
  return html;
}

function localeAlternates(currentKey) {
  const links = entries.map(([, locale]) =>
    `<link rel="alternate" hreflang="${locale.hreflang}" href="${origin}${locale.path}" />`
  );
  links.push(`<link rel="alternate" hreflang="x-default" href="${origin}${locales[defaultLocale].path}" />`);

  const openGraphAlternates = entries
    .filter(([key]) => key !== currentKey)
    .map(([, locale]) => `<meta property="og:locale:alternate" content="${locale.ogLocale}" />`);
  return [...links, ...openGraphAlternates].join("\n");
}

function selectCurrentLocale(source, localeKey) {
  return source.replace(/<option\b[^>]*\bdata-locale-option="([^"]+)"[^>]*>/g, (option, key) => {
    const clean = option.replace(/\sselected\b/g, "");
    return key === localeKey ? clean.replace(/>$/, " selected>") : clean;
  });
}

function renderLocale(source, localeKey, locale) {
  const canonical = `${origin}${locale.path}`;
  let html = source;
  html = replaceRequired(html, /<html\b[^>]*>/i,
    `<html lang="${locale.lang}" data-locale="${localeKey}" data-theme="dark">`, "html language");
  html = replaceRequired(html, /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtml(locale.seo.title)}</title>`, "title");
  html = replaceMeta(html, "name", "description", locale.seo.description);
  html = replaceMeta(html, "name", "keywords", locale.seo.keywords);
  html = replaceMeta(html, "property", "og:title", locale.seo.ogTitle);
  html = replaceMeta(html, "property", "og:description", locale.seo.ogDescription);
  html = replaceMeta(html, "property", "og:url", canonical);
  html = replaceMeta(html, "property", "og:locale", locale.ogLocale);
  html = replaceMeta(html, "property", "og:image:alt", locale.seo.imageAlt);
  html = replaceMeta(html, "name", "twitter:title", locale.seo.ogTitle);
  html = replaceMeta(html, "name", "twitter:description", locale.seo.ogDescription);
  html = replaceMeta(html, "name", "twitter:image:alt", locale.seo.imageAlt);
  html = replaceRequired(html, /<link rel="canonical" href="[^"]*" \/>/i,
    `<link rel="canonical" href="${canonical}" />`, "canonical URL");
  html = replaceRequired(html,
    /<!-- locale-alternates:start -->[\s\S]*?<!-- locale-alternates:end -->/,
    `<!-- locale-alternates:start -->\n${localeAlternates(localeKey)}\n<!-- locale-alternates:end -->`,
    "locale alternate markers");
  html = translateElements(html, locale.messages);
  html = localizePrerenderedCatalog(html, locale.messages);
  html = updateStructuredData(html, locale, canonical);
  html = selectCurrentLocale(html, localeKey);
  return html;
}

const localePaths = new Set();
const hreflangs = new Set();
const enMessages = locales[defaultLocale].messages;
for (const [key, locale] of entries) {
  if (!locale.path.startsWith("/") || !locale.path.endsWith("/")) {
    throw new Error(`Locale ${key} must use an absolute trailing-slash path`);
  }
  if (localePaths.has(locale.path) || hreflangs.has(locale.hreflang)) {
    throw new Error(`Locale ${key} has a duplicate path or hreflang`);
  }
  localePaths.add(locale.path);
  hreflangs.add(locale.hreflang);
  for (const field of ["title", "description", "ogTitle", "ogDescription"]) {
    if (!locale.seo[field]?.includes("JEV AI")) {
      throw new Error(`Locale ${key} SEO ${field} must include JEV AI`);
    }
  }
  if ([...locale.seo.title].length > 65) {
    throw new Error(`Locale ${key} title is longer than 65 characters`);
  }
  if ([...locale.seo.description].length > 160) {
    throw new Error(`Locale ${key} description is longer than 160 characters`);
  }
  if (!locale.messages["apps.title"]?.includes("JEV AI")) {
    throw new Error(`Locale ${key} H1 must include JEV AI`);
  }
}

const template = readFileSync(indexPath, "utf8");
for (const [key, locale] of entries) {
  const html = renderLocale(template, key, locale);
  const output = key === defaultLocale
    ? indexPath
    : resolve(publicDir, locale.path.slice(1), "index.html");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html);
}

let sitemapLastModified = "2026-09-21";
try {
  sitemapLastModified = readFileSync(sitemapPath, "utf8")
    .match(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/)?.[1] || sitemapLastModified;
} catch {
  // The first build creates the sitemap.
}

const alternateXml = entries.map(([, locale]) =>
  `    <xhtml:link rel="alternate" hreflang="${locale.hreflang}" href="${origin}${locale.path}" />`
).concat(
  `    <xhtml:link rel="alternate" hreflang="x-default" href="${origin}${locales[defaultLocale].path}" />`
).join("\n");

const localizedUrls = entries.map(([, locale]) => `  <url>
    <loc>${origin}${locale.path}</loc>
    <lastmod>${sitemapLastModified}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${locale.path === "/" ? "1.0" : "0.9"}</priority>
${alternateXml}
  </url>`).join("\n");

const legalUrls = ["privacy", "terms", "security"].map(path => `  <url>
    <loc>${origin}/${path}/</loc>
    <lastmod>2026-09-21</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.2</priority>
  </url>`).join("\n");

writeFileSync(sitemapPath, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${localizedUrls}
${legalUrls}
</urlset>
`);

console.log(`Generated ${entries.length} localized static pages with hreflang SEO.`);
