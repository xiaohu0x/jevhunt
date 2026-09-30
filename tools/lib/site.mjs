import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { loadProjectContents, authoredProject } from "./project-content.mjs";
export * from "../../shared/render.js";
export function loadData() {
  const sandbox = { window: { JH: {} } }; sandbox.JH = sandbox.window.JH;
  for (const name of ["i18n", "data"]) runInNewContext(readFileSync(`public/assets/js/${name}.js`, "utf8"), sandbox);
  const catalog = JSON.parse(readFileSync("public/catalog.json", "utf8"));
  const projectContents = loadProjectContents();
  const apps = catalog.apps.map(project => authoredProject(project, projectContents));
  const meta = { ...catalog.meta, projectCount: apps.length,
    categoryCounts: Object.fromEntries([...new Set(apps.map(project => project.cat))].map(category => [category, apps.filter(project => project.cat === category).length])) };
  return { ...sandbox.JH, apps, catalogMeta: meta, projectContents };
}
export const hash = value => createHash("sha256").update(value).digest("hex").slice(0, 20);
