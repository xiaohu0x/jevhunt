import { authoredProject, projectContentHash } from "./project-content.mjs";
import { matchingProjectContent } from "../../shared/project-content.js";
import { publicPreview } from "../../shared/catalog-data.js";

const byRepo = (a, b) => a.repo.toLowerCase().localeCompare(b.repo.toLowerCase(), "en");
const scriptJson = value => JSON.stringify(value).replace(/</g, "\\u003c");

export function authoredContentMetadata(records) {
  const sorted = [...records.values()].sort(byRepo);
  return {
    repositories: sorted.length,
    localePages: sorted.reduce((count, record) => count + Object.keys(record.locales).length, 0),
    revision: projectContentHash(sorted.map(record => ({ repo: record.repo.toLowerCase(), hash: projectContentHash(record) }))),
  };
}

export function fullCatalogScript(projects) {
  // An in-flight static import must not replace a newer live API result.
  return "window.JH = window.JH || {};\nif (!window.JH.catalogRemote) {\nwindow.JH.apps = " + scriptJson(projects) + ";\nwindow.JH.catalogLoaded = true;\n}\n";
}

export function buildStaticCatalog(catalog, records) {
  const apps = catalog.apps.map(project => authoredProject(project, records));
  const projects = apps.map(publicPreview).sort(byRepo);
  const initial = [...projects].sort((a, b) => b.stars - a.stars || (b.created || "").localeCompare(a.created || "")
    || a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || byRepo(a, b)).slice(0, 20);
  const fullScript = fullCatalogScript(projects);
  const meta = Object.fromEntries(["policy", "updated", "syncedAt", "catalogHash", "projectCount", "totalStars"].map(key => [key, catalog.meta[key]]));
  meta.categoryCounts = Object.fromEntries([...new Set(apps.map(project => project.cat))].sort()
    .map(category => [category, apps.filter(project => project.cat === category).length]));
  meta.languages = [...new Set(apps.map(project => project.language || "unknown"))].sort();
  // Keep the upstream/D1 catalog identity separate from this static asset's
  // revision. Locale-only authored edits must also invalidate the static index.
  meta.staticIndexHash = projectContentHash({ catalog: meta.catalogHash || null,
    content: authoredContentMetadata(records).revision, index: fullScript });
  const initialScript = "/* Initial page; full index loads on interaction. */\nwindow.JH = window.JH || {};\nif (!window.JH.catalogRemote) {\nwindow.JH.catalogMeta = "
    + scriptJson(meta) + ";\nwindow.JH.apps = " + scriptJson(initial) + ";\n}\n";
  return { meta, projects, initial, initialScript, fullScript };
}

export function buildSummaryOverlay(projects, records, locale) {
  const summaries = {};
  for (const project of [...projects].sort(byRepo)) {
    const record = records.get(project.repo.toLowerCase());
    if (!matchingProjectContent(project, record) || !record.locales[locale]) continue;
    summaries[project.repo.toLowerCase()] = { repositoryId: record.repositoryId, summary: record.locales[locale].summary };
  }
  return { locale, summaries };
}

export const summaryOverlayScript = overlay => "window.JH.catalogSummaryOverlay = " + scriptJson(overlay) + ";\n";
