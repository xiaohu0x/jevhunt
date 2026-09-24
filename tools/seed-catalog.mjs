import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { publicPreview } from "../shared/catalog-data.js";

const mode = process.argv.includes("--remote") ? "--remote" : "--local";
const { apps, meta, unavailable = [] } = JSON.parse(readFileSync("public/catalog.json", "utf8"));
const now = Math.floor(Date.now() / 1000);
const quote = value => value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
const sql = [];
// Insert-only bootstrap: rerunning cannot overwrite newer worker or editor data.
for (const [index, p] of [...apps, ...unavailable].entries()) {
  const active = p.freshness === "unavailable" ? 0 : 1;
  const data = { ...p, evidenceCheckedAt: p.evidenceCheckedAt || meta.syncedAt, metadataCheckedAt: p.metadataCheckedAt || meta.syncedAt };
  const values = [p.repo.toLowerCase(), p.id || null, JSON.stringify(data), JSON.stringify(publicPreview(data)), p.name,
    p.cat, p.relationship || "unclassified", p.language || null, p.stars || 0, p.created || null, active,
    Math.floor(Date.parse(meta.syncedAt) / 1000), now + Math.floor(index / 3) * 60];
  sql.push(`INSERT OR IGNORE INTO catalog_entries(repo,github_id,payload,preview,name,category,relationship,language,stars,created,active,checked_at,next_check_at) VALUES(${values.map(quote).join(",")});`);
}
const bootstrap = { policy: meta.policy, updated: meta.updated, candidateCount: meta.candidateCount, exhaustive: false, bootstrapHash: meta.catalogHash, automaticRemovalFloor: Math.floor(apps.length * 0.75) };
sql.push(`UPDATE catalog_control SET revision=${quote(meta.catalogHash)},published_at=${now},last_success_at=${now},meta=${quote(JSON.stringify(bootstrap))} WHERE id=1 AND revision='uninitialized';`);
mkdirSync(".cache", { recursive: true });
writeFileSync(".cache/catalog-seed.sql", sql.join("\n") + "\n");
console.log(`Seeding ${apps.length} active and ${unavailable.length} retained repositories (${mode}).`);
const position = process.argv.indexOf("--persist-to");
const extra = position >= 0 ? ["--persist-to", process.argv[position + 1]] : [];
execFileSync("npx", ["wrangler", "d1", "execute", "jevhunt-db", mode, "--file=.cache/catalog-seed.sql", ...extra], { stdio: "inherit" });
