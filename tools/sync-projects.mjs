#!/usr/bin/env node
/**
 * Build the public Jev project snapshot from Awesome Jev's CC0 data.
 *
 * The browser only receives validated GitHub repositories. Articles, standalone
 * websites, removed repositories, and duplicate repository names are excluded.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditProjects, POLICY_VERSION } from "./catalog-policy.mjs";

const DEFAULT_SOURCE =
  "https://raw.githubusercontent.com/hellogumbo/awesome-jev/main/data/projects.json";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "public/assets/js/projects.js");
const auditPath = resolve(root, "public/catalog-audit.json");
const sitemapPath = resolve(root, "public/sitemap.xml");
const source = process.argv[2] || DEFAULT_SOURCE;

const uiCategories = new Set([
  "official",
  "sdks",
  "integrations",
  "agents",
  "browser",
  "apps",
  "games",
  "demos",
  "research",
  "lists",
]);

async function readSource(value) {
  if (!/^https?:\/\//i.test(value)) {
    return readFileSync(resolve(process.cwd(), value), "utf8");
  }

  const response = await fetch(value, {
    headers: { accept: "application/json", "user-agent": "JevHunt catalog sync" },
  });
  if (!response.ok) {
    throw new Error(`Catalog download failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function text(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function date(value) {
  const normalized = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function webUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function serialize(value) {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const upstream = JSON.parse(await readSource(source));
if (!Array.isArray(upstream.projects) || !Array.isArray(upstream.categories)) {
  throw new Error("Catalog source must contain projects and categories arrays");
}

const categoryOrder = new Map(
  upstream.categories.map((category, index) => [category.id, index])
);
const seen = new Set();
const candidates = [];

for (const project of upstream.projects) {
  if (!project.repo || project.gone) continue;

  const repo = text(project.repo, 180);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`Invalid GitHub repository: ${repo || "(empty)"}`);
  }
  if (!uiCategories.has(project.category)) {
    throw new Error(`Unsupported category "${project.category}" on ${repo}`);
  }

  const key = repo.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);

  const [owner, repoName] = repo.split("/");
  candidates.push({
    name: text(project.name, 120) || repoName,
    repo,
    author: owner,
    desc: text(project.description, 600),
    cat: project.category,
    language: text(project.language, 40) || null,
    stars: Number.isFinite(project.stars) ? Math.max(0, Math.trunc(project.stars)) : 0,
    created: date(project.created),
    added: date(project.added),
    pushed: date(project.pushed),
    site: webUrl(project.site),
  });
}

console.log(`Verifying ${candidates.length} repository READMEs against ${POLICY_VERSION}...`);
const { verified: projects, rejected } = await auditProjects(candidates, {
  onProgress: (completed, total) => console.log(`  verified ${completed}/${total}`),
});

projects.sort((a, b) =>
  (categoryOrder.get(a.cat) ?? 999) - (categoryOrder.get(b.cat) ?? 999) ||
  b.stars - a.stars ||
  a.name.localeCompare(b.name, "en")
);

if (projects.length < 100) {
  throw new Error(`Refusing to publish suspiciously small catalog (${projects.length} projects)`);
}

const catalog = {
  source: "hellogumbo/awesome-jev",
  sourceUrl: "https://github.com/hellogumbo/awesome-jev",
  updated: date(upstream.updated),
  policy: POLICY_VERSION,
  candidateCount: candidates.length,
  rejectedCount: rejected.length,
  projectCount: projects.length,
  totalStars: projects.reduce((total, project) => total + project.stars, 0),
};

const auditReport = {
  policy: POLICY_VERSION,
  source: catalog.source,
  sourceUpdated: catalog.updated,
  candidateCount: candidates.length,
  verifiedCount: projects.length,
  rejectedCount: rejected.length,
  criteria: [
    "Official repositories owned by typesafe-ai are accepted.",
    "Other repositories must contain first-party Jev or System One technical evidence in their default-branch README.",
    "Accepted signals include Jev model/API identifiers, the System One endpoint, official SDK identifiers, or Jev references paired with TypeSafe or operational context.",
    "A TypeSafe name or website link alone is not evidence, and Jev-only repository naming is insufficient.",
    "A third-party catalog description, repository name, stars, or external post is not evidence.",
  ],
  rejected,
};

mkdirSync(dirname(auditPath), { recursive: true });
writeFileSync(auditPath, JSON.stringify(auditReport, null, 2) + "\n");

let existingSitemap = "";
try {
  existingSitemap = readFileSync(sitemapPath, "utf8");
} catch {
  // The first sync can create the sitemap.
}
const previousLastModified = existingSitemap.match(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/)?.[1];
const sitemapLastModified = [previousLastModified, catalog.updated].filter(Boolean).sort().at(-1);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://jevhunt.com/</loc>
    <lastmod>${sitemapLastModified}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
writeFileSync(sitemapPath, sitemap);

const projectLines = projects.map(project => `  ${serialize(project)}`).join(",\n");
const generated = `/* Generated by tools/sync-projects.mjs from CC0 source data. */\n` +
  `window.JH = window.JH || {};\n` +
  `window.JH.catalogMeta = ${serialize(catalog)};\n` +
  `window.JH.apps = [\n${projectLines}\n];\n`;

let current = "";
try {
  current = readFileSync(outputPath, "utf8");
} catch {
  // First sync creates the snapshot.
}

if (current === generated) {
  console.log(`Catalog already current: ${projects.length} repositories.`);
} else {
  const temporaryPath = `${outputPath}.tmp`;
  writeFileSync(temporaryPath, generated);
  renameSync(temporaryPath, outputPath);
  console.log(
    `Catalog synced: ${projects.length} repositories, ${catalog.totalStars} stars, updated ${catalog.updated}.`
  );
}
