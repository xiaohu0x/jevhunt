import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { loadProjectContents } from "./lib/project-content.mjs";
import { authoredContentMetadata, buildStaticCatalog, buildSummaryOverlay } from "./lib/static-catalog.mjs";
import { localizeStaticProjects, staticCatalogIndexUrl } from "../public/assets/js/catalog-locales.js";

function fixture() {
  const source = JSON.parse(readFileSync("public/catalog.json", "utf8"));
  const all = loadProjectContents();
  const apps = source.apps.filter(project => ["tauricresearch/tradingagents", "agentscope-ai/agentscope"].includes(project.repo.toLowerCase()));
  const records = new Map(apps.map(project => [project.repo.toLowerCase(), structuredClone(all.get(project.repo.toLowerCase()))]));
  return { catalog: { meta: { ...source.meta, projectCount: apps.length }, apps }, records };
}

test("content-only edits invalidate the immutable static index URL without altering D1 identity", () => {
  const { catalog, records } = fixture();
  const original = buildStaticCatalog(catalog, records);
  const originalRevision = authoredContentMetadata(records).revision;
  const record = records.values().next().value;
  record.locales["zh-cn"].summary += " 新的中文说明。";
  const localizedEdit = buildStaticCatalog(catalog, records);
  assert.equal(localizedEdit.meta.catalogHash, original.meta.catalogHash);
  assert.equal(localizedEdit.fullScript, original.fullScript, "The common English index need not contain every locale");
  assert.notEqual(authoredContentMetadata(records).revision, originalRevision);
  assert.notEqual(staticCatalogIndexUrl(localizedEdit.meta), staticCatalogIndexUrl(original.meta));

  record.locales.en.summary += " Updated reviewed explanation.";
  const englishEdit = buildStaticCatalog(catalog, records);
  assert.notEqual(englishEdit.fullScript, localizedEdit.fullScript);
  assert.notEqual(staticCatalogIndexUrl(englishEdit.meta), staticCatalogIndexUrl(localizedEdit.meta));
  const reordered = new Map([...records].reverse());
  const repeated = buildStaticCatalog({ ...catalog, apps: [...catalog.apps].reverse() }, reordered);
  assert.equal(repeated.initialScript, englishEdit.initialScript);
  assert.equal(repeated.fullScript, englishEdit.fullScript);
  assert.deepEqual(authoredContentMetadata(reordered), authoredContentMetadata(records));
});

test("static summaries require both the requested locale and the stable repository identity", () => {
  const { catalog, records } = fixture();
  const built = buildStaticCatalog(catalog, records);
  const overlay = buildSummaryOverlay(catalog.apps, records, "zh-cn");
  const project = built.initial[0];
  const localized = localizeStaticProjects([project], overlay, "zh-cn");
  assert.equal(localized[0].desc, records.get(project.repo.toLowerCase()).locales["zh-cn"].summary);
  assert.notEqual(localized[0].desc, project.desc);
  const reusedPath = { ...project, id: project.id + 1, desc: "New repository at a reused path" };
  assert.equal(localizeStaticProjects([reusedPath], overlay, "zh-cn")[0], reusedPath);
  assert.equal(localizeStaticProjects([project], overlay, "ja")[0], project);
  assert.equal(localizeStaticProjects([project], overlay, "zh-cn", true)[0], project);
  assert.equal(localizeStaticProjects([{ ...project, id: null }], overlay, "zh-cn")[0].desc, project.desc);
  assert.equal(Object.hasOwn(buildSummaryOverlay([reusedPath], records, "zh-cn").summaries, project.repo.toLowerCase()), false);
});

test("generated static payloads cannot overwrite an already-live catalog", () => {
  const { catalog, records } = fixture();
  const built = buildStaticCatalog(catalog, records);
  const liveApps = [{ id: 1, repo: "live/current", desc: "Fresh D1 result" }];
  const liveMeta = { mode: "live-d1", catalogHash: "live-revision" };
  const sandbox = { window: { JH: { catalogRemote: true, apps: liveApps, catalogMeta: liveMeta } } };
  runInNewContext(built.initialScript, sandbox);
  runInNewContext(built.fullScript, sandbox);
  assert.equal(sandbox.window.JH.apps, liveApps);
  assert.equal(sandbox.window.JH.catalogMeta, liveMeta);
  assert.equal(sandbox.window.JH.catalogLoaded, undefined);
});
