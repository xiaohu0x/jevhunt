#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { GitHub, mapLimit } from "./lib/github.mjs";
import { inspectRepository, POLICY_VERSION, RELATIONSHIPS } from "./catalog-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const config = JSON.parse(readFileSync("catalog/sources.json", "utf8"));
const overrides = JSON.parse(readFileSync("catalog/overrides.json", "utf8"));
const github = new GitHub();
const started = new Date().toISOString();
const candidates = new Map(), sources = [], rejected = [], errors = [];
let previous = { apps: [], meta: {} };
if (existsSync("public/catalog.json")) previous = JSON.parse(readFileSync("public/catalog.json", "utf8"));
else {
  const sandbox = { window: { JH: {} } }; sandbox.JH = sandbox.window.JH;
  runInNewContext(readFileSync("public/assets/js/projects.js", "utf8"), sandbox);
  previous = { apps: sandbox.JH.apps, meta: sandbox.JH.catalogMeta };
}
const history = [...previous.apps, ...(previous.unavailable || [])];
const previousByRepo = new Map(history.map(p => [p.repo.toLowerCase(), p]));
const previousById = new Map(history.filter(p => p.id).map(p => [p.id, p]));
const text = (value, max = 600) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const categories = new Set(["official","sdks","integrations","agents","browser","apps","games","demos","research","lists"]);
const sourceCategory = { "client-libraries-and-integrations": "integrations", "agent-and-developer-tooling": "agents", "browser-agents": "browser", "applications-and-workflows": "apps", "games-and-robotics": "games", "evaluations-and-independent-research": "research", "showcases-and-field-notes": "demos" };
function categoryOf(p) {
  if (categories.has(p.cat || p.category)) return p.cat || p.category;
  const hint = (p.repo || "") + " " + (p.description || "");
  if (/awesome|directory|curated list/i.test(hint)) return "lists";
  if (/benchmark|eval|replica|alternative|reconstruction/i.test(hint)) return "research";
  if (/sdk|client library/i.test(hint)) return "sdks";
  if (/browser|computer.use|desktop/i.test(hint)) return "browser";
  if (/game|mario|minecraft|drone|simulation/i.test(hint)) return "games";
  if (/plugin|mcp|agent|router|context|skill/i.test(hint)) return "agents";
  return "apps";
}
function add(project, source) {
  const repo = text(project.repo, 160).replace(/\.git$/i, "");
  if (!/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repo) || project.gone) return;
  const key = repo.toLowerCase(), existing = candidates.get(key);
  candidates.set(key, { ...existing, ...project, repo, cat: ["editorial", "approved-submissions", "typesafe-official", "awesome-jev"].includes(source) ? categoryOf(project) : (existing?.cat || categoryOf(project)),
    provenance: [...new Set([...(existing?.provenance || []), source])] });
}
async function sourceData(source) {
  const value = await github.request(source.url);
  if (source.type === "projects") {
    if (!Array.isArray(value?.projects)) throw new Error("Invalid projects feed");
    for (const project of value.projects) add(project, source.id);
  } else {
    if (!Array.isArray(value?.categories)) throw new Error("Invalid resources feed");
    for (const category of value.categories) for (const p of category.resources || []) {
      const match = /^https:\/\/github.com\/([a-z0-9-]+\/[a-z0-9_.-]+)\/?$/i.exec(p.url);
      if (match) add({ repo: match[1], name: p.name, category: sourceCategory[category.id] }, source.id);
    }
  }
  return { id: source.id, url: source.homepage, sourceUpdatedAt: value.updated || value.last_updated || null, status: "ok" };
}
async function submitted() {
  const approved = [];
  approved.blocked = undefined;
  let cursor = "", pages = 0;
  do {
    if (++pages > 100) throw new Error("Submission pagination limit");
    const page = await github.request(config.submissionsUrl + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""));
    if (!Array.isArray(page?.projects)) throw new Error("Approved submission feed unavailable");
    if (Array.isArray(page.excluded)) approved.blocked = page.excluded.filter(repo => typeof repo === "string" && /^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repo));
    for (const p of page.projects) {
      const match = /^https:\/\/github.com\/([a-z0-9-]+\/[a-z0-9_.-]+)$/i.exec(p.url);
      if (match) approved.push({ ...p, repo: match[1], reviewed: true, reviewedEvidence: p.evidence_url });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return approved;
}

try {
  for (const project of history) add(project, "previous-snapshot");
  const fetched = await Promise.allSettled(config.sources.map(sourceData));
  fetched.forEach((result, i) => sources.push(result.status === "fulfilled" ? result.value : { id: config.sources[i].id, url: config.sources[i].homepage, status: "failed", error: result.reason.message }));
  for (const repo of config.officialRepos) add({ repo, category: "official" }, "typesafe-official");
  sources.push({ id: "typesafe-official", url: "https://github.com/typesafe-ai", status: "ok" });
  const approved = await submitted().catch(error => { sources.push({ id: "approved-submissions", status: "failed", error: error.message }); return null; });
  const editorialBlocks = approved?.blocked ?? previous.meta.editorialBlocks ?? [];
  if (approved) {
    // A successful public feed is authoritative for moderation withdrawal.
    const active = new Set(approved.map(p => p.repo.toLowerCase()));
    for (const [key, p] of candidates) {
      if (p.reviewed && !active.has(key) && !(p.provenance || []).some(s => !["previous-snapshot", "approved-submissions"].includes(s))) candidates.delete(key);
    }
    for (const project of approved) add(project, "approved-submissions");
    sources.push({ id: "approved-submissions", status: "ok", count: approved.length });
  }
  for (const project of overrides.projects) add(project, "editorial");
  if (!process.argv.includes("--skip-search")) {
    for (const query of config.githubQueries) {
      console.log("Discovering:", query);
      try {
        const result = await github.search(query + " is:public");
        for (const item of result.items) add({ repo: item.full_name, description: item.description }, "github-search");
        sources.push({ id: "github-search", query, count: result.items.length, status: result.truncated ? "partial" : "ok" });
      } catch (error) { sources.push({ id: "github-search", query, status: "failed", error: error.message }); }
    }
  } else {
    const cachedSearches = (previous.meta.sources || []).filter(source => source.id === "github-search" && source.query);
    sources.push(...(cachedSearches.length ? cachedSearches.map(source => ({ ...source, status: "cached", checkedAt: source.checkedAt || previous.meta.syncedAt })) : [{ id: "github-search", status: "skipped" }]));
  }
  if (!sources.some(source => ["awesome-jev", "typesafe-field-guide"].includes(source.id) && source.status === "ok")) throw new Error("All community discovery feeds failed; retaining published snapshot.");
  const excluded = new Set([...editorialBlocks, ...overrides.excluded].map(p => (typeof p === "string" ? p : p.repo).toLowerCase()));
  const input = [...candidates.values()].filter(p => !excluded.has(p.repo.toLowerCase()));
  console.log(`Fetching canonical metadata for ${input.length} repository candidates...`);
  const metadata = await github.metadata(input.map(p => p.repo));
  let completed = 0;
  const seen = new Set();
  const output = await mapLimit(input, 8, async candidate => {
    const meta = metadata.get(candidate.repo.toLowerCase());
    const prior = previousByRepo.get(candidate.repo.toLowerCase()) || previousById.get(meta?.databaseId);
    try {
      if (meta?.unavailable) {
        if (prior) {
          errors.push({ repo: prior.repo, reason: meta.reason });
          return { ...prior, freshness: meta.reason === "not-found" ? "unavailable" : "stale", evidenceLevel: prior.evidenceLevel || "legacy-unreviewed" };
        }
        rejected.push({ repo: candidate.repo, reason: meta?.reason || "metadata unavailable" }); return null;
      }
      if (!meta || meta.isPrivate || !meta.defaultBranchRef?.target?.oid) { rejected.push({ repo: candidate.repo, reason: "No public source commit" }); return null; }
      if (seen.has(meta.databaseId)) return null;
      seen.add(meta.databaseId);
      const repo = meta.nameWithOwner, commit = meta.defaultBranchRef.target.oid;
      const project = {
        id: meta.databaseId, name: repo.split("/")[1], repo,
        author: repo.split("/")[0], desc: text(meta.description || candidate.description || candidate.desc),
        cat: candidate.cat, language: meta.primaryLanguage?.name || null, stars: meta.stargazerCount,
        created: meta.createdAt?.slice(0, 10) || null, added: prior?.added || started.slice(0, 10),
        pushed: meta.pushedAt?.slice(0, 10) || null, archived: !!meta.isArchived, fork: !!meta.isFork,
        license: meta.licenseInfo?.spdxId === "NOASSERTION" ? null : meta.licenseInfo?.spdxId || null,
        commit, provenance: candidate.provenance.filter(s => s !== "previous-snapshot"),
        freshness: "current",
      };
      if (!project.provenance.length) project.provenance = prior?.provenance || ["previous-snapshot"];
      const cachedEvidence = prior?.evidencePolicy === POLICY_VERSION && prior.commit === commit ? prior.evidenceDetail : null;
      let detail = cachedEvidence || await inspectRepository(project, github, {
        codePaths: overrides.codePaths[repo.toLowerCase()] || [],
        inspectCode: !!overrides.codePaths[repo.toLowerCase()],
      });
      if (candidate.reviewed && candidate.reviewedEvidence && RELATIONSHIPS.includes(candidate.relationship)) {
        const match = candidate.reviewedEvidence.match(/^https:\/\/github.com\/([^/]+\/[^/]+)\/blob\/([a-f0-9]{40})\/(.+?)(?:#.*)?$/i);
        if (match && match[1].toLowerCase() === repo.toLowerCase() && await github.raw(repo, match[2], decodeURIComponent(match[3]))) {
          detail = { level: "reviewed", signal: "editor-reviewed", relationship: candidate.relationship,
            url: candidate.reviewedEvidence, commit: match[2], path: match[3], excerpt: "Reviewed source reference. Runtime behavior has not been independently tested." };
          project.reviewed = true;
        }
      }
      if (!detail && config.officialRepos.some(r => r.toLowerCase() === repo.toLowerCase())) detail = {
        level: "official", signal: "official-sdk", relationship: repo.endsWith("/skills") ? "resource" : "sdk",
        url: `https://github.com/${repo}/tree/${commit}`, commit, excerpt: "Published by the official TypeSafe GitHub organization."
      };
      if (detail && candidate.relationship && RELATIONSHIPS.includes(candidate.relationship) && candidate.provenance.includes("editorial")) detail = { ...detail, relationship: candidate.relationship };
      if (!detail) { rejected.push({ repo, reason: "No qualifying first-party usage evidence; needs review" }); return null; }
      if (config.officialRepos.some(r => r.toLowerCase() === repo.toLowerCase())) detail = { ...detail, level: "official", relationship: repo.endsWith("/skills") ? "resource" : "sdk" };
      return { ...project, relationship: detail.relationship, evidenceLevel: detail.level, evidencePolicy: POLICY_VERSION,
        evidence: detail.url, evidenceDetail: detail, verification: detail.level,
        ...(prior && prior.repo.toLowerCase() !== repo.toLowerCase() ? { previousRepo: prior.repo } : {}) };
    } catch (error) {
      errors.push({ repo: candidate.repo, reason: error.message });
      return prior ? { ...prior, freshness: "stale", evidenceLevel: prior.evidenceLevel || "legacy-unreviewed" } : null;
    } finally {
      completed++;
      if (completed % 100 === 0 || completed === input.length) { console.log(`  inspected ${completed}/${input.length}`); github.save(); }
    }
  });
  const unavailable = output.filter(p => p?.freshness === "unavailable");
  const apps = output.filter(p => p && p.freshness !== "unavailable").sort((a, b) => a.repo.toLowerCase().localeCompare(b.repo.toLowerCase()));
  // Deduplicate retained entries against canonical, renamed repositories too.
  const unique = [...new Map(apps.map(p => [p.id || p.repo.toLowerCase(), p])).values()];
  const dataHash = createHash("sha256").update(JSON.stringify(unique)).digest("hex").slice(0, 20);
  const sourceDates = sources.map(s => s.sourceUpdatedAt).filter(Boolean).sort();
  const oldRepos = new Set(previous.apps.map(p => p.repo.toLowerCase())), newRepos = new Set(unique.map(p => p.repo.toLowerCase()));
  const changes = { added: unique.filter(p => !oldRepos.has(p.repo.toLowerCase())).map(p => p.repo), removed: previous.apps.filter(p => !newRepos.has(p.repo.toLowerCase())).map(p => p.repo) };
  const meta = { policy: POLICY_VERSION, source: "Multiple sources", sourceUrl: "https://jevhunt.com/methodology/",
    updated: sourceDates.at(-1) || started.slice(0, 10), syncedAt: started, catalogHash: dataHash,
    candidateCount: input.length, rejectedCount: rejected.length, projectCount: unique.length,
    totalStars: unique.reduce((sum, p) => sum + p.stars, 0), sources, staleCount: unique.filter(p => p.freshness !== "current").length, unavailableCount: unavailable.length,
    changes, editorialBlocks, exhaustive: false };
  mkdirSync(".cache", { recursive: true });
  writeFileSync(".cache/proposed-catalog.json", JSON.stringify({ meta, apps: unique, unavailable }, null, 2));
  if (unique.length < 100 || (unique.length < previous.apps.length * 0.75 && !process.argv.includes("--accept-policy-change"))) throw new Error("Catalog unexpectedly shrank; inspect .cache/proposed-catalog.json before accepting a policy change.");
  if (errors.length > Math.max(20, input.length * 0.15)) throw new Error("Too many repository checks failed; retaining last published catalog.");
  const write = (path, value) => { writeFileSync(path + ".tmp", value); renameSync(path + ".tmp", path); };
  write("public/catalog.json", JSON.stringify({ meta, apps: unique, unavailable }) + "\n");
  const browserProjects = unique.map(p => Object.fromEntries(["name","repo","desc","cat","language","stars","created","added","pushed","archived","fork","relationship","evidenceLevel","evidence","freshness"].map(key => [key, p[key]])));
  const firstPage = [...browserProjects].sort((a,b) => b.stars - a.stars || (b.created || "").localeCompare(a.created || "") || a.name.localeCompare(b.name, "en", { sensitivity: "base" })).slice(0,20);
  meta.categoryCounts = Object.fromEntries([...categories].map(cat => [cat, unique.filter(p => p.cat === cat).length]));
  meta.languages = [...new Set(unique.map(p => p.language || "unknown"))].sort();
  write("public/catalog.json", JSON.stringify({ meta, apps: unique, unavailable }) + "\n");
  write("public/assets/js/catalog-all.js", "window.JH.apps = " + JSON.stringify(browserProjects) + ";\nwindow.JH.catalogLoaded = true;\n");
  write("public/assets/js/projects.js", "/* Initial catalog page; the complete index loads on interaction. */\nwindow.JH = window.JH || {};\nwindow.JH.catalogMeta = " + JSON.stringify(Object.fromEntries(["policy","updated","syncedAt","catalogHash","projectCount","totalStars","categoryCounts","languages"].map(key => [key,meta[key]]))) + ";\nwindow.JH.apps = " + JSON.stringify(firstPage) + ";\n");
  write("public/catalog-audit.json", JSON.stringify({ excluded: overrides.excluded, policy: POLICY_VERSION, syncedAt: started, catalogHash: dataHash, sources,
    candidateCount: input.length, listedCount: unique.length, evidenceLevels: Object.fromEntries([...new Set(unique.map(p => p.evidenceLevel))].map(level => [level, unique.filter(p => p.evidenceLevel === level).length])),
    rejectedCount: rejected.length, rejected, unavailable: unavailable.map(p => ({ repo: p.repo, reason: "Repository is not publicly reachable; retained for rechecking" })), errors, changes,
    criteria: ["Documented means first-party documentation mentions an integration.", "Code reference means an API identifier was found in source; code was not executed.", "Reviewed means an editor reviewed the linked source. No listing implies independent runtime validation.", "Local alternatives, research and resources are labeled separately.", "Coverage is bounded by the reported sources, searches and errors; it is not exhaustive."] }, null, 2) + "\n");
  console.log(`Catalog: ${unique.length} projects; +${changes.added.length} / -${changes.removed.length}; ${errors.length} stale checks; hash ${dataHash}`);
} finally { github.save(); }
