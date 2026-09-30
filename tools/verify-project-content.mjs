import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { JSDOM } from "jsdom";
import { LOCALES } from "../shared/locales.js";
import { contentCitation } from "../shared/project-content.js";
import { projectSeo, duplicateProjectNames, projectNameKey } from "../shared/project-seo.js";
import { renderProject } from "../shared/catalog-view.js";
import { ORIGIN, projectPath } from "../shared/render.js";
import { loadData } from "./lib/site.mjs";

const { values } = parseArgs({ options: {
  origin: { type: "string", default: "https://jevhunt.com" },
  static: { type: "boolean", default: false },
  concurrency: { type: "string", default: "6" },
} });
const data = loadData();
const records = data.projectContents;
const selection = JSON.parse(readFileSync("content/project-selection.json", "utf8"));
assert.equal(records.size, selection.projects.length, "Authored inventory differs from the selected batch");
const build = JSON.parse(readFileSync("public/build-info.json", "utf8"));
const report = { checkedAt: new Date().toISOString(), mode: values.static ? "rendered-and-static" : "production", origin: values.origin,
  buildId: build.buildId, repositories: records.size, localePages: 0, staticPages: 0, listingSummaries: 0, sitemapUrls: 0, errors: [] };
const get = async path => {
  const url = new URL(path, values.origin);
  url.searchParams.set("content_release", build.buildId);
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      if (/noindex/i.test(response.headers.get("x-robots-tag") || "")) throw new Error(`${path}: X-Robots-Tag prevents indexing`);
      return await response.text();
    } catch (error) { failure = error; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); }
  }
  throw failure;
};

function verifyHtml(html, project, record, locale, duplicateName) {
  const info = LOCALES[locale], prefix = locale === "en" ? "" : "/" + locale;
  const path = projectPath(record.repo, prefix), copy = record.locales[locale];
  const seo = projectSeo(project, { content: record, localeKey: locale, duplicateName });
  const dom = new JSDOM(html, { url: ORIGIN + path });
  try {
    const document = dom.window.document;
    const text = selector => document.querySelector(selector)?.textContent;
    const attr = (selector, attribute) => document.querySelector(selector)?.getAttribute(attribute);
    assert.equal(document.documentElement.lang, info.lang, "document language");
    assert.equal(document.title, seo.title + " | JevHunt", "title");
    assert.equal(document.querySelectorAll("h1").length, 1, "one H1");
    assert.equal(text("h1"), copy.h1, "H1");
    assert.equal(text(".legal__summary"), seo.description, "visible introduction");
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) assert.equal(attr(selector, "content"), seo.description, selector);
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) assert.equal(attr(selector, "content"), document.title, selector);
    assert.equal(attr('link[rel="canonical"]', "href"), ORIGIN + path, "canonical");
    assert.ok(!/noindex/i.test(attr('meta[name="robots"]', "content") || ""), "indexable");
    const alternates = new Map([...document.querySelectorAll('link[rel="alternate"][hreflang]')].map(link => [link.hreflang, link.href]));
    assert.equal(alternates.size, Object.keys(LOCALES).length + 1, "complete alternates");
    for (const alternate of Object.values(LOCALES)) assert.equal(alternates.get(alternate.hreflang), ORIGIN + alternate.path + "projects/" + record.repo.toLowerCase() + "/", alternate.hreflang);
    assert.equal(alternates.get("x-default"), ORIGIN + projectPath(record.repo));
    assert.equal(attr(".project-explanation", "data-content-version"), record.version, "authored body version");
    assert.equal(document.querySelectorAll(".project-explanation section").length, 4, "complete body");
    for (const section of copy.sections) {
      assert.equal(text(`#project-${section.kind} > h2`), section.heading, section.kind + " heading");
      assert.equal(text(`#project-${section.kind} > p`), section.text, section.kind + " body");
      const citations = [...new Set(section.claims.flatMap(id => record.claims.find(claim => claim.id === id).evidence).map(evidence => contentCitation(record, evidence)))];
      assert.deepEqual([...document.querySelectorAll(`#project-${section.kind} .project-citations a`)].map(link => link.href), citations, section.kind + " citations");
    }
    assert.equal(attr(".project-content-date time", "datetime"), record.reviewedAt, "review date");
    const schema = JSON.parse(text('script[type="application/ld+json"]'))["@graph"][0];
    assert.equal(schema.description, seo.description, "schema description");
    assert.equal(schema.name, seo.name, "schema entity name");
    assert.equal(schema.inLanguage, info.lang, "schema language");
    assert.equal(schema.url, ORIGIN + path, "schema URL");
  } finally { dom.window.close(); }
}

let projects = data.apps;
if (!values.static) {
  const liveBuild = JSON.parse(await get("/build-info.json"));
  assert.equal(liveBuild.buildId, build.buildId, "Production build differs");
  projects = JSON.parse(await get("/api/catalog?all=1&locale=en")).apps;
}
const byRepo = new Map(projects.map(project => [project.repo.toLowerCase(), project]));
const duplicates = duplicateProjectNames(projects);
const jobs = [];
for (const [repo, record] of records) {
  const project = byRepo.get(repo);
  assert.equal(project?.id, record.repositoryId, repo + " current identity");
  assert.equal(project.relationship, record.relationship, repo + " classification");
  assert.equal(project.cat, record.category, repo + " category");
  for (const locale of Object.keys(LOCALES)) jobs.push({ project, record, locale });
}
let cursor = 0;
await Promise.all(Array.from({ length: values.static ? 1 : Math.max(1, Math.min(10, Number(values.concurrency) || 6)) }, async () => {
  while (cursor < jobs.length) {
    const { project, record, locale } = jobs[cursor++];
    const path = projectPath(record.repo, locale === "en" ? "" : "/" + locale);
    const duplicateName = duplicates.has(projectNameKey(project));
    try {
      const html = values.static ? renderProject(project, data.catalogMeta, [], [], data.i18n.locales[locale].messages,
        { localeKey: locale, localeInfo: LOCALES[locale], localePrefix: locale === "en" ? "" : "/" + locale, duplicateName, content: record }) : await get(path);
      verifyHtml(html, project, record, locale, duplicateName);
      report.localePages++;
      if (values.static && locale === "en") {
        verifyHtml(readFileSync("public" + path + "index.html", "utf8"), project, record, locale, duplicateName);
        report.staticPages++;
      }
    } catch (error) { report.errors.push({ path, issue: error.message }); }
    if ((report.localePages + report.errors.length) % 100 === 0) console.log(`Checked ${report.localePages + report.errors.length}/${jobs.length} locale pages; ${report.errors.length} errors.`);
  }
}));

if (!values.static) {
  for (const locale of Object.keys(LOCALES)) {
    const apps = locale === "en" ? projects : JSON.parse(await get("/api/catalog?all=1&locale=" + locale)).apps;
    const listing = new Map(apps.map(project => [project.repo.toLowerCase(), project]));
    for (const [repo, record] of records) {
      try { assert.equal(listing.get(repo)?.desc, record.locales[locale].summary, "localized listing summary"); report.listingSummaries++; }
      catch (error) { report.errors.push({ path: locale + ":" + repo, issue: error.message }); }
    }
    console.log(`Checked ${locale} listing summaries.`);
  }
  for (const [locale, query] of [["zh-cn", "基本面"], ["ru", "фундаментальный"]]) {
    const result = JSON.parse(await get("/api/catalog?" + new URLSearchParams({ locale, q: query })));
    if (!result.apps.some(project => project.repo.toLowerCase() === "tauricresearch/tradingagents")) report.errors.push({ path: locale, issue: "Localized TradingAgents search failed" });
  }
}
const xml = values.static ? readFileSync("public/sitemap.xml", "utf8") : await get("/sitemap.xml");
const sitemap = new JSDOM(xml, { contentType: "application/xml" });
const urls = new Set([...sitemap.window.document.querySelectorAll("loc")].map(element => element.textContent));
sitemap.window.close();
for (const { record, locale } of jobs) {
  const path = projectPath(record.repo, locale === "en" ? "" : "/" + locale);
  if (urls.has(ORIGIN + path)) report.sitemapUrls++;
  else report.errors.push({ path, issue: "Missing sitemap URL" });
}
mkdirSync("reports/project-content-100", { recursive: true });
writeFileSync(`reports/project-content-100/${values.static ? "rendered" : "production"}.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
if (report.errors.length) process.exitCode = 1;
