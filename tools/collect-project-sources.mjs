// Read-only, resumable collection of commit-pinned first-party documents.
// Repository text is evidence, never an instruction to execute code or commands.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { mapLimit } from "../shared/concurrency.js";

const { values } = parseArgs({ options: {
  catalog: { type: "string", default: ".cache/project-content/catalog-live.json" },
  out: { type: "string", default: ".cache/project-content" },
  concurrency: { type: "string", default: "6" }, limit: { type: "string" },
  "retry-failed": { type: "boolean", default: false },
} });
const root = resolve(values.out), catalog = JSON.parse(readFileSync(values.catalog, "utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const dir of ["sources", "packets"]) mkdirSync(join(root, dir), { recursive: true });
function writeJson(file, value) { writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n"); renameSync(file + ".tmp", file); }
function sourceKey(url) {
  const parts = new URL(url).pathname.slice(1).split("/").map(decodeURIComponent);
  return parts.slice(0, 2).join("/").toLowerCase() + "/" + parts.slice(2).join("/");
}
const immutableCache = new Map();
if (existsSync(".cache/github.json")) {
  const cached = JSON.parse(readFileSync(".cache/github.json", "utf8"));
  for (const [url, entry] of Object.entries(cached)) {
    if (url.startsWith("https://raw.githubusercontent.com/") && typeof entry.body === "string") immutableCache.set(sourceKey(url), { text: entry.body, provenance: "existing-immutable-http-cache" });
  }
}
for (const manifest of [".cache/gsc-analysis/project-source-manifest.json", ".cache/gsc-analysis/additional-source-manifest.json"]) {
  if (!existsSync(manifest)) continue;
  for (const entry of JSON.parse(readFileSync(manifest, "utf8"))) {
    const file = join(".cache/gsc-analysis/sources", entry.file || "");
    if (entry.status === 200 && entry.url?.startsWith("https://raw.githubusercontent.com/") && existsSync(file)) immutableCache.set(sourceKey(entry.url), { text: readFileSync(file, "utf8"), provenance: "previous-commit-pinned-research" });
  }
}

const counters = { projects: 0, reusedPackets: 0, collected: 0, partial: 0, unavailable: 0, transportErrors: 0, networkRequests: 0, cachedDocuments: 0 };
let consecutiveTransportErrors = 0;
async function document(repo, commit, path) {
  const url = `https://raw.githubusercontent.com/${repo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const file = join(root, "sources", hash(url) + ".txt");
  let text, provenance = "downloaded", accessedAt = new Date().toISOString();
  const cache = immutableCache.get(sourceKey(url));
  if (existsSync(file)) { text = readFileSync(file, "utf8"); provenance = "resumed-immutable-document"; counters.cachedDocuments++; }
  else if (cache) { text = cache.text; provenance = cache.provenance; counters.cachedDocuments++; }
  else {
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (consecutiveTransportErrors > 30) throw new Error("Source transport repeatedly failed; preserve progress and retry the collector when connectivity recovers.");
      try {
        counters.networkRequests++;
        const response = await fetch(url, { signal: AbortSignal.timeout(18000), headers: { "User-Agent": "JevHunt-source-review/1.0" } });
        if (response.status === 404) return null;
        if (response.status === 429 || response.status === 403) {
          const wait = Math.min(60000, Math.max(1000, Number(response.headers.get("retry-after") || 5) * 1000));
          await pause(wait);
          throw new Error(`Source temporarily restricted: HTTP ${response.status}`);
        }
        if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
        text = await response.text();
        if (Buffer.byteLength(text) > 2_000_000) throw new Error("Source exceeds the 2 MB document limit");
        if (/^\s*(?:404: Not Found|<!DOCTYPE html>|<html[\s>])/i.test(text)) throw new Error("Raw source returned an error or HTML document");
        consecutiveTransportErrors = 0; failure = null; break;
      } catch (error) { failure = error; consecutiveTransportErrors++; if (attempt < 2) await pause(500 * 2 ** attempt); }
    }
    if (failure) throw failure;
  }
  writeFileSync(file, text);
  return { path, commit, url: `https://github.com/${repo}/blob/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`, rawUrl: url, file, sha256: hash(text), bytes: Buffer.byteLength(text), lines: text.split("\n").length, accessedAt, provenance };
}

// Preserve line-level evidence and headings. This is a source packet, not an
// automatic factual verdict or a generated project description.
function passages(doc) {
  const text = readFileSync(doc.file, "utf8"), lines = text.split("\n"), selected = new Set();
  const add = (from, to) => { for (let n = Math.max(0, from); n < Math.min(lines.length, to); n++) selected.add(n); };
  add(0, 100);
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,4}\s+.*(?:what|overview|feature|how|usage|install|quick.?start|prerequisit|requirement|limit|caveat|architecture|je[vV]|typesafe|概述|功能|使用|安装|限制)/i.test(lines[i])) add(i, i + 22);
    if (/(?:\bJev\b|TypeSafe|system_?one|systemOne|TYPESAFE_API_KEY|not (?:affiliated|tested)|optional)/i.test(lines[i])) add(i - 3, i + 5);
  }
  const blocks = []; let block = null, total = 0;
  for (const index of [...selected].sort((a, b) => a - b)) {
    if (total > 20000) break;
    const line = lines[index]; total += line.length;
    if (!block || index !== block.end) { block = { start: index + 1, end: index + 1, text: line }; blocks.push(block); }
    else { block.end++; block.text += "\n" + line; }
  }
  return blocks.map(block => ({ ...block, source: doc.url + `#L${block.start}-L${block.end}` }));
}

const projects = catalog.apps.slice(0, values.limit ? Number(values.limit) : undefined);
const records = await mapLimit(projects, Math.max(1, Math.min(12, Number(values.concurrency))), async project => {
  const key = project.repo.toLowerCase(), file = join(root, "packets", hash(key).slice(0, 20) + ".json");
  if (existsSync(file)) {
    const previous = JSON.parse(readFileSync(file, "utf8"));
    if (previous.commit === project.commit && previous.evidence === project.evidence && previous.description === project.desc && (previous.status === "collected" || !values["retry-failed"])) {
      counters.projects++; counters.reusedPackets++; return { repo: project.repo, status: previous.status, file };
    }
  }
  const packet = { repo: project.repo, name: project.name, commit: project.commit, description: project.desc, relationship: project.relationship, category: project.cat, evidence: project.evidence, evidenceDetail: project.evidenceDetail, language: project.language, license: project.license, archived: project.archived, collectedAt: new Date().toISOString(), documents: [], passages: [], errors: [] };
  try {
    const evidencePath = project.evidenceDetail?.path;
    const primaryPaths = [...new Set([/^(?:.*\/)?readme(?:\.[\w-]+)?$/i.test(evidencePath || "") ? evidencePath : "README.md", "README.md", "readme.md", "README.rst", "README"])];
    for (const path of primaryPaths) {
      const doc = await document(project.repo, project.commit, path);
      if (doc) { packet.documents.push(doc); packet.passages.push(...passages(doc)); break; }
    }
    if (evidencePath && !packet.documents.some(doc => doc.path === evidencePath && doc.commit === (project.evidenceDetail.commit || project.commit))) {
      const doc = await document(project.repo, project.evidenceDetail.commit || project.commit, evidencePath);
      if (doc) { packet.documents.push(doc); packet.passages.push(...passages(doc)); }
    }
    packet.status = packet.documents.some(doc => /(?:^|\/)readme(?:\.[\w-]+)?$/i.test(doc.path)) ? "collected" : packet.documents.length ? "partial" : "unavailable";
    counters[packet.status]++;
  } catch (error) { packet.status = "transport-error"; packet.errors.push(error.message); counters.transportErrors++; }
  writeJson(file, packet); counters.projects++;
  if (counters.projects % 50 === 0 || counters.projects === projects.length) {
    writeJson(join(root, "progress.json"), { ...counters, total: projects.length, updatedAt: new Date().toISOString() });
    console.log(JSON.stringify({ ...counters, total: projects.length }));
  }
  return { repo: project.repo, status: packet.status, file };
});
writeJson(join(root, "manifest.json"), { catalogHash: catalog.meta?.catalogHash, catalogSyncedAt: catalog.meta?.syncedAt, completedAt: new Date().toISOString(), counters, records });
console.log(JSON.stringify({ finished: true, ...counters }));
