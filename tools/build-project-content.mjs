import { readFileSync, writeFileSync } from "node:fs";
import { loadProjectContents, authoredProject } from "./lib/project-content.mjs";
import { authoredContentMetadata } from "./lib/static-catalog.mjs";

const path = "public/catalog.json", original = readFileSync(path, "utf8");
const catalog = JSON.parse(original), contents = loadProjectContents();
catalog.apps = catalog.apps.map(project => authoredProject(project, contents));
catalog.meta.mode = "snapshot";
catalog.meta.projectCount = catalog.apps.length;
catalog.meta.categoryCounts = Object.fromEntries([...new Set(catalog.apps.map(project => project.cat))].map(category => [category, catalog.apps.filter(project => project.cat === category).length]));
catalog.meta.authoredContent = authoredContentMetadata(contents);
const next = JSON.stringify(catalog) + "\n";
if (next !== original) writeFileSync(path, next);
console.log(`Applied reviewed content to ${contents.size} repositories in the static catalog snapshot.`);
