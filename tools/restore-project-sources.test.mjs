import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { LOCALES } from "../shared/locales.js";
import { PROJECT_CONTENT_VERSION } from "../shared/project-content.js";
import { restoreProjectSources } from "./restore-project-sources.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const checker = fileURLToPath(new URL("./check-project-content.mjs", import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "jevhunt-source-restore-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value)); };
  const repo = "owner/example", contentPath = "content/projects/owner/example.json";
  const bodies = ["Primary documented behavior.\r\n", "Supplemental documented behavior.\n"];
  const sources = ["README.md", "docs/TypeSafe usage.md"].map((path, index) => {
    const commit = (index ? "b" : "a").repeat(40);
    return { id: "source-" + index, path, commit,
      url: `https://github.com/${repo}/blob/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`,
      sha256: hash(bodies[index]), accessedAt: "2026-09-30T00:00:00Z" };
  });
  const rawUrls = sources.map(source => source.url.replace("https://github.com/", "https://raw.githubusercontent.com/").replace("/blob/", "/"));
  const contentByUrl = new Map(rawUrls.map((url, index) => [url, bodies[index]]));
  const claims = ["purpose", "jev", "usage", "limits"].map((id, index) => ({ id, kind: "documented", text: `Fixture ${id}`,
    evidence: [{ source: sources[index % 2].id, start: 1, end: 1, quote: bodies[index % 2].trim() }] }));
  // Synthetic locale strings satisfy the checker contract; this is not a language test.
  const markers = { "zh-cn": "中文", "zh-tw": "中文", ja: "テスト", ko: "한국어", ru: "Проверка", hi: "परीक्षण" };
  const record = { version: PROJECT_CONTENT_VERSION, repo, repositoryId: 12345, relationship: "integration", category: "agents",
    status: "reviewed", reviewedAt: "2026-09-30", sources, claims,
    locales: Object.fromEntries(Object.keys(LOCALES).map(locale => [locale, {
      title: `Example ${locale}`, h1: `Example ${locale}`, description: `Description ${locale}`, summary: `Summary ${locale}`,
      sections: claims.map(claim => ({ kind: claim.id, heading: `${locale} ${claim.id}`, text: `${markers[locale] || locale} fixture ${claim.id}`, claims: [claim.id] })),
      review: { language: "model-reviewed", semantic: "source-checked", searchIntent: "inferred" },
    }])) };
  write(contentPath, record);
  write("content/project-selection.json", { projects: [{ repo, repositoryId: record.repositoryId }] });
  const options = { selectionFile: join(root, "content/project-selection.json"), contentDirectory: join(root, "content/projects"), out: join(root, ".cache/project-content-reviewed") };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    assert.ok(init.signal instanceof AbortSignal);
    assert.ok(contentByUrl.has(url), `Unexpected unpinned source request: ${url}`);
    return new Response(contentByUrl.get(url));
  };
  return { root, write, record, contentPath, bodies, sources, rawUrls, contentByUrl, options, calls, fetchImpl };
}

test("restoration includes supplemental pinned documents and passes the strict checker", async t => {
  const f = fixture(t);
  f.write(".cache/project-content/manifest.json", { records: [{ repo: "unrelated/catalog-entry" }] });
  const wholeCatalogBefore = readFileSync(join(f.root, ".cache/project-content/manifest.json"));
  const contentBefore = readFileSync(join(f.root, f.contentPath));
  const result = await restoreProjectSources({ ...f.options, fetchImpl: f.fetchImpl });
  assert.deepEqual(new Set(f.calls), new Set(f.rawUrls));
  assert.equal(result.projects, 1);
  assert.equal(result.documents, 2);
  assert.equal(result.downloaded, 2);
  const manifest = JSON.parse(readFileSync(result.manifest, "utf8"));
  const packet = JSON.parse(readFileSync(manifest.records[0].file, "utf8"));
  assert.deepEqual(packet.documents.map(document => document.commit), f.sources.map(source => source.commit));
  assert.deepEqual(packet.documents.map(document => document.path), f.sources.map(source => source.path));
  packet.documents.forEach((document, index) => {
    assert.equal(hash(readFileSync(document.file)), f.sources[index].sha256);
    assert.equal(document.accessedAt, f.sources[index].accessedAt);
  });
  assert.deepEqual(readFileSync(join(f.root, f.contentPath)), contentBefore);
  assert.deepEqual(readFileSync(join(f.root, ".cache/project-content/manifest.json")), wholeCatalogBefore);
  const checked = spawnSync(process.execPath, [checker, "--sources", result.manifest], { cwd: f.root, encoding: "utf8", timeout: 10000 });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  const audit = JSON.parse(readFileSync(join(f.root, "reports/project-content-100/content-check.json"), "utf8"));
  assert.equal(audit.sourceVerification, "passed");
  assert.equal(audit.checkedSources, 2);
  assert.equal(audit.exactQuotes, 4);
});

test("verified cached bytes are reused and corrupt cached bytes are restored", async t => {
  const f = fixture(t);
  const first = await restoreProjectSources({ ...f.options, fetchImpl: f.fetchImpl });
  const manifest = JSON.parse(readFileSync(first.manifest, "utf8"));
  const packet = JSON.parse(readFileSync(manifest.records[0].file, "utf8"));
  const cached = await restoreProjectSources({ ...f.options, fetchImpl: async () => { throw new Error("Unexpected network request"); } });
  assert.equal(cached.reused, 2);
  assert.equal(cached.downloaded, 0);
  writeFileSync(packet.documents[0].file, "Damaged cached bytes.");
  f.calls.length = 0;
  const repaired = await restoreProjectSources({ ...f.options, fetchImpl: f.fetchImpl });
  assert.equal(repaired.reused, 1);
  assert.equal(repaired.downloaded, 1);
  assert.deepEqual(f.calls, [f.rawUrls[0]]);
  assert.equal(hash(readFileSync(packet.documents[0].file)), f.sources[0].sha256);
});

test("hash mismatches fail without publishing a manifest or altered source", async t => {
  const f = fixture(t);
  await assert.rejects(restoreProjectSources({ ...f.options, fetchImpl: async url => new Response(url === f.rawUrls[0] ? "Altered upstream body." : f.contentByUrl.get(url)) }), /SHA-256 mismatch/);
  assert.equal(existsSync(join(f.options.out, "manifest.json")), false);
  assert.equal(existsSync(join(f.options.out, "sources", hash(f.sources[0].url) + ".txt")), false);
  assert.deepEqual(readdirSync(join(f.options.out, "packets")), []);
  const resumed = await restoreProjectSources({ ...f.options, fetchImpl: f.fetchImpl });
  assert.equal(resumed.reused, 1);
  assert.equal(resumed.downloaded, 1);
});

test("transient HTTP failures retry with a bounded delay and a request timeout", async t => {
  const f = fixture(t), attempts = new Map(), waits = [];
  const result = await restoreProjectSources({ ...f.options, waitImpl: async delay => waits.push(delay), fetchImpl: async (url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    const count = (attempts.get(url) || 0) + 1; attempts.set(url, count);
    if (url === f.rawUrls[0] && count === 1) return new Response("Try later", { status: 429, headers: { "retry-after": "60" } });
    return new Response(f.contentByUrl.get(url));
  } });
  assert.equal(result.downloaded, 2);
  assert.equal(attempts.get(f.rawUrls[0]), 2);
  assert.deepEqual(waits, [10000]);
});

test("permanent source errors fail rather than changing commits or skipping documents", async t => {
  const f = fixture(t), calls = [];
  await assert.rejects(restoreProjectSources({ ...f.options, fetchImpl: async url => {
    calls.push(url);
    return url === f.rawUrls[1] ? new Response("Not found", { status: 404 }) : new Response(f.contentByUrl.get(url));
  } }), /HTTP 404/);
  assert.deepEqual(new Set(calls), new Set(f.rawUrls));
  assert.equal(calls.length, 2);
  assert.equal(existsSync(join(f.options.out, "manifest.json")), false);
});

test("restoration refuses to replace the whole-catalog archive", async t => {
  const f = fixture(t);
  const original = JSON.stringify({ records: [{ repo: "unrelated/catalog-entry" }] });
  f.write(".cache/project-content/manifest.json", original);
  await assert.rejects(restoreProjectSources({ ...f.options, out: join(f.root, ".cache/project-content"), fetchImpl: f.fetchImpl }), /Refusing to replace an unrelated source manifest/);
  assert.equal(readFileSync(join(f.root, ".cache/project-content/manifest.json"), "utf8"), original);
  assert.equal(f.calls.length, 0);
});

test("a document path inconsistent with its pinned URL is rejected before any fetch", async t => {
  const f = fixture(t);
  f.record.sources[1].path = "wrong.md";
  f.write(f.contentPath, f.record);
  await assert.rejects(restoreProjectSources({ ...f.options, fetchImpl: f.fetchImpl }), /exact GitHub commit and document path/);
  assert.equal(f.calls.length, 0);
  assert.equal(existsSync(join(f.options.out, "manifest.json")), false);
});
