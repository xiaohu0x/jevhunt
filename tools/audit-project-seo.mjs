import { readFileSync, writeFileSync, mkdirSync, openSync, writeSync, closeSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { projectSeo, duplicateProjectNames, projectNameKey, PROJECT_SEO_VERSION } from "../shared/project-seo.js";
import { PROJECT_SEO_COPY, TOPIC_KEYS } from "../shared/project-seo-copy.js";
import { renderProject, RELATION_LABELS } from "../shared/catalog-view.js";
import { LOCALES } from "../shared/locales.js";
import { projectPath } from "../shared/render.js";
import { loadData } from "./lib/site.mjs";
import { CATEGORY_IDS, CATEGORY_NAMES } from "../shared/catalog-data.js";

const { values } = parseArgs({ options: { catalog: { type: "string", default: "public/catalog.json" }, out: { type: "string", default: "reports/project-seo" }, static: { type: "boolean", default: false } } });
const catalog = JSON.parse(readFileSync(values.catalog, "utf8"));
const { i18n } = loadData();
const duplicateNames = duplicateProjectNames(catalog.apps);
const output = resolve(values.out);
mkdirSync(output, { recursive: true });
const stream = openSync(resolve(output, "metadata.ndjson"), "w");
const reviewStream = openSync(resolve(output, "review.ndjson"), "w");
const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, key) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[key]);
const extract = (html, expression) => decode(html.match(expression)?.[1] || "");
const errors = [];
const summary = { version: PROJECT_SEO_VERSION, auditedAt: new Date().toISOString(), catalog: resolve(values.catalog), catalogHash: catalog.meta?.catalogHash, catalogSyncedAt: catalog.meta?.syncedAt,
  projectCount: catalog.apps.length, localeCount: Object.keys(LOCALES).length, renderedPages: 0, staticPages: 0,
  baseline: { missingDescriptions: catalog.apps.filter(p => !p.desc?.trim()).length, duplicateNameGroups: duplicateNames.size },
  locales: {}, examples: {}, errors };

try {
  for (const [localeKey, localeInfo] of Object.entries(LOCALES)) {
    const copy = PROJECT_SEO_COPY[localeKey];
    if (copy?.topics.length !== TOPIC_KEYS.length || !copy.topics.every(Boolean)) throw new Error(`Incomplete locale: ${localeKey}`);
    const titles = new Set(), descriptions = new Set();
    const counts = { pages: 0, genericFallbacks: 0, sourceRelationshipConflicts: 0, longTitles: 0, longDescriptions: 0 };
    for (const project of catalog.apps) {
      const context = { localeKey, localeInfo, localePrefix: localeKey === "en" ? "" : `/${localeKey}`, duplicateName: duplicateNames.has(projectNameKey(project)) };
      const seo = projectSeo(project, context);
      const path = projectPath(project.repo, context.localePrefix);
      const html = renderProject(project, catalog.meta || {}, [], [], i18n.locales[localeKey].messages, context);
      const title = extract(html, /<title>([^<]*)<\/title>/);
      const description = extract(html, /<meta name="description" content="([^"]*)"/);
      const heading = extract(html, /<h1>([^<]*)<\/h1>/);
      const check = (ok, message) => { if (!ok) errors.push({ repo: project.repo, locale: localeKey, message }); };
      check(title === seo.title + " | JevHunt", "Title changed during rendering");
      check(description === seo.description && description.length > 0, "Description missing or truncated");
      check(heading === seo.heading && (html.match(/<h1>/g) || []).length === 1, "H1 mismatch");
      check(title.startsWith(seo.name), "Project name is not first");
      check(!titles.has(title.toLowerCase()), "Duplicate title");
      check(!descriptions.has(description.toLowerCase()), "Duplicate description");
      check(!/\{(?:name|topic|language|code|platform)\}/.test(title + description), "Unexpanded locale placeholder");
      check(extract(html, /<link rel="canonical" href="([^"]*)"/) === "https://jevhunt.com" + path, "Canonical mismatch");
      check(!/<meta name="robots" content="noindex/.test(html), "Active project excluded from indexing");
      check((html.match(/<link rel="alternate" hreflang=/g) || []).length === 16, "Language alternates incomplete");
      check(extract(html, /<p class="legal__summary">([^<]*)<\/p>/) === description, "Visible summary differs");
      for (const expression of [/<meta property="og:description" content="([^"]*)"/, /<meta name="twitter:description" content="([^"]*)"/]) check(extract(html, expression) === description, "Social description differs");
      const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"];
      check(graph[0].description === description && graph[0].inLanguage === localeInfo.lang, "Structured data differs");
      if (values.static && localeKey === "en") {
        const file = "public" + path + "index.html";
        check(existsSync(file), "Static fallback missing");
        if (existsSync(file)) {
          const built = readFileSync(file, "utf8");
          check(extract(built, /<title>([^<]*)<\/title>/) === title && extract(built, /<meta name="description" content="([^"]*)"/) === description && extract(built, /<h1>([^<]*)<\/h1>/) === heading, "Static/live metadata mismatch");
          summary.staticPages++;
        }
      }
      titles.add(title.toLowerCase()); descriptions.add(description.toLowerCase());
      counts.pages++; summary.renderedPages++;
      counts.genericFallbacks += seo.basis === "catalog-facts" ? 1 : 0;
      counts.sourceRelationshipConflicts += seo.flags.includes("source-relationship-conflict") ? 1 : 0;
      counts.longTitles += seo.flags.includes("long-title") ? 1 : 0;
      counts.longDescriptions += seo.flags.includes("long-description") ? 1 : 0;
      const messages = i18n.locales[localeKey].messages;
      const oldRelation = messages["relationship." + project.relationship] || RELATION_LABELS[project.relationship] || "Relationship under review";
      const oldCategory = messages["category." + project.cat + ".name"] || CATEGORY_NAMES[CATEGORY_IDS.indexOf(project.cat)] || project.cat;
      const oldDescription = project.desc?.trim() || `${project.name} (${project.repo}) — ${oldRelation}. ${[oldCategory, project.language].filter(Boolean).join(" · ")}.`;
      const row = { repo: project.repo, locale: localeKey, path, title, description, h1: heading, intent: seo.intent, basis: seo.basis, flags: seo.flags,
        before: { title: `${project.repo} — ${oldRelation} | JevHunt`, description: oldDescription.slice(0, 160) } };
      writeSync(stream, JSON.stringify(row) + "\n");
      if (seo.flags.length) writeSync(reviewStream, JSON.stringify(row) + "\n");
      if (project.repo.toLowerCase() === "tauricresearch/tradingagents") summary.examples[localeKey] = row;
    }
    summary.locales[localeKey] = { ...counts, uniqueTitles: titles.size, uniqueDescriptions: descriptions.size };
    console.log(`${localeKey}: ${counts.pages} rendered; ${titles.size} unique titles; ${counts.genericFallbacks} factual fallbacks; ${counts.longTitles} long titles.`);
  }
} finally { closeSync(stream); closeSync(reviewStream); }
writeFileSync(resolve(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`${summary.renderedPages} rendered pages, ${summary.staticPages} static fallbacks, ${errors.length} errors. Report: ${output}`);
if (errors.length) process.exitCode = 1;
