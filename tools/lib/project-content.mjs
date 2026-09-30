import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateProjectContent, applyProjectContent, matchingProjectContent } from "../../shared/project-content.js";

export const projectContentHash = record => createHash("sha256").update(JSON.stringify(record)).digest("hex");
export function loadProjectContents(directory = "content/projects", { validate = true } = {}) {
  const records = new Map();
  if (!existsSync(directory)) return records;
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      if (!entry.name.endsWith(".json")) continue;
      const record = JSON.parse(readFileSync(file, "utf8"));
      const errors = validate ? validateProjectContent(record) : [];
      if (errors.length) throw new Error(`${file}: ${errors.join("; ")}`);
      const key = record.repo.toLowerCase();
      if (records.has(key)) throw new Error(`Duplicate authored project: ${record.repo}`);
      records.set(key, record);
    }
  }
  visit(directory);
  return records;
}

export function authoredProject(project, records) {
  return applyProjectContent(project, records.get(project.repo.toLowerCase()));
}
export function localizedProjectPreview(project, records, locale = "en") {
  const record = records.get(project.repo.toLowerCase());
  if (!matchingProjectContent(project, record)) return project;
  const content = record.locales[locale];
  return { ...applyProjectContent(project, record), ...(content ? { desc: content.summary } : {}) };
}
