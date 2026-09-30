import { readFileSync, writeFileSync } from "node:fs";
import { loadProjectContents } from "./lib/project-content.mjs";
import { buildStaticCatalog } from "./lib/static-catalog.mjs";
const catalog = JSON.parse(readFileSync("public/catalog.json", "utf8"));
const contents = loadProjectContents();
const built = buildStaticCatalog(catalog, contents);
writeFileSync("public/assets/js/projects.js", built.initialScript);
writeFileSync("public/assets/js/catalog-all.js", built.fullScript);
console.log(`Browser catalog: ${built.initial.length} initial listings; ${built.projects.length} in the searchable index.`);
