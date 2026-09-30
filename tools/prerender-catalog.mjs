#!/usr/bin/env node
import { renderCard as projectCard } from "../shared/catalog-view.js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { loadProjectContents, localizedProjectPreview } from "./lib/project-content.mjs";

export const PRERENDER_COUNT = 20;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(root, "public/index.html");
const dataPath = resolve(root, "public/assets/js/data.js");
const projectsPath = resolve(root, "public/assets/js/projects.js");
const number = new Intl.NumberFormat("en-US");

const sandbox = { window: { JH: {} } };
sandbox.JH = sandbox.window.JH;
runInNewContext(readFileSync(dataPath, "utf8"), sandbox, { filename: dataPath });
const snapshot = JSON.parse(readFileSync(resolve(root, "public/catalog.json"), "utf8"));
const projectContents = loadProjectContents();
snapshot.apps = snapshot.apps.map(project => localizedProjectPreview(project, projectContents));
snapshot.meta.categoryCounts = Object.fromEntries([...new Set(snapshot.apps.map(project => project.cat))].map(category => [category, snapshot.apps.filter(project => project.cat === category).length]));
sandbox.window.JH.apps = snapshot.apps; sandbox.window.JH.catalogMeta = snapshot.meta;

runInNewContext(readFileSync(resolve(root, "public/assets/js/i18n.js"), "utf8"), sandbox);
const { apps, catalogMeta, categories, i18n } = sandbox.window.JH;
const labels = i18n.locales.en.messages;
if (!Array.isArray(apps) || !apps.length || !catalogMeta || !Array.isArray(categories)) {
  throw new Error("Catalog snapshot is missing apps, metadata, or categories");
}

const esc = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const compareDate = (left, right) => {
  if (left && right) return right.localeCompare(left);
  if (left) return -1;
  if (right) return 1;
  return 0;
};

const topProjects = [...apps]
  .sort((a, b) =>
    b.stars - a.stars ||
    compareDate(a.created, b.created) ||
    a.name.localeCompare(b.name, "en", { sensitivity: "base" })
  )
  .slice(0, PRERENDER_COUNT);

const categoryNames = new Map(categories.map(category => [category.id, category.name]));
const detailUrl = project => "/projects/" + project.repo.toLowerCase().split("/").map(encodeURIComponent).join("/") + "/";
const repoUrl = project =>
  `https://github.com/${project.repo.split("/").map(encodeURIComponent).join("/")}`;

const renderCard = project => projectCard(project, labels);

const itemList = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  "@id": "https://jevhunt.com/#projects",
  name: "Top JEV AI Model open-source projects",
  description: "Jev ecosystem applications, integrations and research with linked documentation and source evidence.",
  numberOfItems: topProjects.length,
  itemListOrder: "https://schema.org/ItemListOrderDescending",
  itemListElement: topProjects.map((project, index) => ({
    "@type": "ListItem",
    position: index + 1,
    item: {
      "@type": "SoftwareSourceCode",
      name: project.name,
      description: project.desc || undefined,
      url: "https://jevhunt.com" + detailUrl(project),
      codeRepository: repoUrl(project),
      applicationCategory: categoryNames.get(project.cat) || project.cat,
      programmingLanguage: project.language || undefined,
      dateCreated: project.created || undefined,
      dateModified: project.pushed || undefined,
    },
  })),
};

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Missing ${label} marker in public/index.html`);
  return source.replace(pattern, replacement);
}

let html = readFileSync(indexPath, "utf8");
const cards = topProjects.map(renderCard).join("\n");
html = replaceRequired(
  html,
  /(<!-- catalog-prerender:start -->)[\s\S]*?(<!-- catalog-prerender:end -->)/,
  `$1\n${cards}\n        $2`,
  "catalog prerender"
);

const structuredData = JSON.stringify(itemList, null, 2).replace(/</g, "\\u003c");
html = replaceRequired(
  html,
  /(<script id="catalogStructuredData" type="application\/ld\+json">)[\s\S]*?(<\/script>)/,
  `$1\n${structuredData}\n$2`,
  "catalog structured data"
);

html = replaceRequired(
  html,
  /(<span id="dirCount"[^>]*>)[^<]*(<\/span>)/,
  `$1Showing ${topProjects.length} of ${apps.length} projects$2`,
  "directory count"
);
for (const [id, value] of [["statApps", apps.length], ["statCats", categories.length], ["statStars", catalogMeta.totalStars]]) {
  const pattern = new RegExp('<([a-z][\\w:-]*)\\b([^>]*\\bid="' + id + '"[^>]*)>[^<]*</\\1>', 'i');
  html = replaceRequired(html, pattern, (_match, tag, attributes) =>
    '<' + tag + attributes.replace(/data-count="[^"]*"/, 'data-count="' + value + '"') + '>' + number.format(value) + '</' + tag + '>', id);
}
const catalogDate = catalogMeta.syncedAt || catalogMeta.updated;
html = replaceRequired(html, /<([a-z][\w:-]*)\b([^>]*\bid="catalogUpdated"[^>]*)>[^<]*<\/\1>/i,
  (_match, tag, attributes) => '<' + tag + attributes.replace(/data-iso="[^"]*"/, 'data-iso="' + esc(catalogDate) + '"').replace(/datetime="[^"]*"/, 'datetime="' + esc(catalogDate) + '"') + '>' + esc(catalogDate.slice(0, 10)) + '</' + tag + '>', 'catalog timestamp');

writeFileSync(indexPath, html);
console.log(`Prerendered ${topProjects.length} of ${apps.length} verified JEV AI Model projects.`);
