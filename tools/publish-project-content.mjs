import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { loadProjectContents } from "./lib/project-content.mjs";
import { projectContentStatements, projectContentVerificationSql, verifyPublishedProjectContent, sqlValue } from "./lib/project-content-publish.mjs";

const { values } = parseArgs({ options: { remote: { type: "boolean", default: false }, apply: { type: "boolean", default: false },
  "verify-only": { type: "boolean", default: false }, "persist-to": { type: "string" },
  catalog: { type: "string", default: "public/catalog.json" }, selection: { type: "string", default: "content/project-selection.json" } } });
const selection = JSON.parse(readFileSync(values.selection, "utf8"));
const records = loadProjectContents();
const catalog = JSON.parse(readFileSync(values.catalog, "utf8"));
const projects = new Map(catalog.apps.map(project => [project.repo.toLowerCase(), project]));
const expected = new Set(selection.projects.map(project => project.repo.toLowerCase()));
if (records.size !== expected.size || [...records.keys()].some(repo => !expected.has(repo))) throw new Error("Authored content does not exactly match the selected batch");
const now = Math.floor(Date.now() / 1000), sql = [];
for (const item of selection.projects) {
  const project = projects.get(item.repo.toLowerCase()), record = records.get(item.repo.toLowerCase());
  if (!project || Number(project.id) !== item.repositoryId || record.repositoryId !== item.repositoryId) throw new Error("Selection identity changed: " + item.repo);
  sql.push(...projectContentStatements(project, record, now));
}
const revision = createHash("sha256").update(sql.join("\n")).digest("hex").slice(0, 24);
sql.push(`UPDATE catalog_control SET revision=${sqlValue("content-" + revision)},published_at=${now} WHERE id=1;`);
mkdirSync(".cache/project-content", { recursive: true });
writeFileSync(".cache/project-content/publish.sql", sql.join("\n") + "\n");
console.log(`Prepared ${records.size} reviewed repositories, ${records.size * 15} locale records, ${sql.length} statements (${values.remote ? "remote D1" : "local D1"}).`);
const databaseArgs = ["wrangler", "d1", "execute", "jevhunt-db", values.remote ? "--remote" : "--local", ...(values["persist-to"] ? ["--persist-to", values["persist-to"]] : [])];
if (values.apply && values["verify-only"]) throw new Error("Choose either --apply or --verify-only");
if (values.apply) {
  execFileSync(process.execPath, ["tools/check-project-content.mjs", "--selection", values.selection], { stdio: "inherit" });
  execFileSync("npx", [...databaseArgs, "--file=.cache/project-content/publish.sql"], { stdio: "inherit" });
}
if (values.apply || values["verify-only"]) {
  const output = execFileSync("npx", [...databaseArgs, "--command", projectContentVerificationSql(records), "--json"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const results = JSON.parse(output);
  if (results.some(result => !result.success)) throw new Error("D1 did not return a successful verification result");
  const report = verifyPublishedProjectContent(results.flatMap(result => result.results), records);
  writeFileSync(`.cache/project-content/published-${values.remote ? "remote" : "local"}.json`, JSON.stringify({ verifiedAt: new Date().toISOString(), ...report }, null, 2) + "\n");
  console.log(`Verified ${report.repositories} published repositories and ${report.localePages} locales, including identities, content hashes, classifications, previews and search text.`);
} else console.log("Preview saved to .cache/project-content/publish.sql. Use --apply to publish this selected batch.");
