#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

export const PRERENDER_COUNT = 20;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(root, "public/index.html");
const dataPath = resolve(root, "public/assets/js/data.js");
const projectsPath = resolve(root, "public/assets/js/projects.js");
const number = new Intl.NumberFormat("en-US");

const sandbox = { window: { JH: {} } };
sandbox.JH = sandbox.window.JH;
runInNewContext(readFileSync(dataPath, "utf8"), sandbox, { filename: dataPath });
runInNewContext(readFileSync(projectsPath, "utf8"), sandbox, { filename: projectsPath });

const { apps, catalogMeta, categories } = sandbox.window.JH;
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
const repoUrl = project =>
  `https://github.com/${project.repo.split("/").map(encodeURIComponent).join("/")}`;

function renderCard(project) {
  const repository = repoUrl(project);
  const description = project.desc || "No project description available.";
  const published = project.created ? `published ${project.created}` : null;
  const updated = project.pushed ? `updated ${project.pushed}` : "update date unknown";
  const category = categoryNames.get(project.cat) || project.cat;
  const tags = [
    project.language ? `<span class="tag">${esc(project.language)}</span>` : null,
    published ? `<span class="tag">${esc(published)}</span>` : null,
    `<span class="tag">${esc(updated)}</span>`,
  ].filter(Boolean).map(tag => `            ${tag}`).join("\n");
  const links = [
    `<a class="card__go" href="${esc(repository)}" target="_blank" rel="noopener">GitHub <span aria-hidden="true">↗</span></a>`,
    `<a class="card__site" href="${esc(project.evidence)}" target="_blank" rel="noopener">README <span aria-hidden="true">↗</span></a>`,
    project.site ? `<a class="card__site" href="${esc(project.site)}" target="_blank" rel="noopener">site <span aria-hidden="true">↗</span></a>` : null,
  ].filter(Boolean).map(link => `              ${link}`).join("\n");

  return `        <article class="card">
          <div class="card__top">
            <div>
              <h2 class="card__heading"><a class="card__name" href="${esc(repository)}" target="_blank" rel="noopener">${esc(project.name)}</a></h2>
              <div class="card__author">${esc(project.repo)}</div>
            </div>
            <span class="badge badge--catalog">${esc(category)}</span>
          </div>
          <p class="card__desc">${esc(description)}</p>
          <div class="card__tags">
${tags}
          </div>
          <div class="card__foot">
            <span class="card__links">
${links}
            </span>
            <span class="card__stat" aria-label="${number.format(project.stars)} GitHub stars">★ ${number.format(project.stars)}</span>
          </div>
        </article>`;
}

const itemList = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  "@id": "https://jevhunt.com/#projects",
  name: "Top JEV AI Model open-source projects",
  description: "Verified open-source projects, SDKs, integrations and tools built with the JEV AI Model.",
  numberOfItems: topProjects.length,
  itemListOrder: "https://schema.org/ItemListOrderDescending",
  itemListElement: topProjects.map((project, index) => ({
    "@type": "ListItem",
    position: index + 1,
    item: {
      "@type": "SoftwareSourceCode",
      name: project.name,
      description: project.desc || undefined,
      url: repoUrl(project),
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
  /(<span id="dirCount">)[^<]*(<\/span>)/,
  `$1Showing ${topProjects.length} of ${apps.length} projects$2`,
  "directory count"
);
html = replaceRequired(
  html,
  /(<div class="stat__n" id="statApps" data-count=")[^"]*(">)[^<]*(<\/div>)/,
  `$1${apps.length}$2${number.format(apps.length)}$3`,
  "project statistic"
);
html = replaceRequired(
  html,
  /(<div class="stat__n" id="statCats" data-count=")[^"]*(">)[^<]*(<\/div>)/,
  `$1${categories.length}$2${number.format(categories.length)}$3`,
  "category statistic"
);
html = replaceRequired(
  html,
  /(<div class="stat__n" id="statStars" data-count=")[^"]*(">)[^<]*(<\/div>)/,
  `$1${catalogMeta.totalStars}$2${number.format(catalogMeta.totalStars)}$3`,
  "star statistic"
);
html = replaceRequired(
  html,
  /(<div class="stat__n stat__n--date" id="catalogUpdated">)[^<]*(<\/div>)/,
  `$1${esc(catalogMeta.updated || "Unknown")}$2`,
  "catalog date"
);

writeFileSync(indexPath, html);
console.log(`Prerendered ${topProjects.length} of ${apps.length} verified JEV AI Model projects.`);
