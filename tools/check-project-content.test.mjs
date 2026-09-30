import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { LOCALES } from "../shared/locales.js";
import { PROJECT_CONTENT_VERSION } from "../shared/project-content.js";

const checker = fileURLToPath(new URL("./check-project-content.mjs", import.meta.url));
const repo = "owner/example", commit = "a".repeat(40);
const manifestPath = ".cache/project-content/manifest.json";
const packetPath = ".cache/project-content/packets/example.json";
const sourcePath = ".cache/project-content/sources/readme.txt";
const contentPath = "content/projects/owner/example.json";
const reportPath = "reports/project-content-100/content-check.json";

function fixture(t, source = "Documented fixture behavior.\nA second source line.\n") {
  const root = mkdtempSync(join(tmpdir(), "jevhunt-content-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  const document = { path: "README.md", commit, url: `https://github.com/${repo}/blob/${commit}/README.md`,
    sha256: createHash("sha256").update(source).digest("hex"), accessedAt: "2026-09-30T00:00:00Z", file: sourcePath };
  const claims = ["purpose", "jev", "usage", "limits"].map(id => ({ id, kind: "documented", text: `Fixture ${id}.`,
    evidence: [{ source: "readme", start: 1, end: 1, quote: "Documented fixture behavior." }] }));
  // Synthetic locale markers exercise the audit contract, not language quality.
  const scripts = { "zh-cn": "中文", "zh-tw": "中文", ja: "テスト", ko: "한국어", ru: "Проверка", hi: "परीक्षण" };
  const record = { version: PROJECT_CONTENT_VERSION, repo, repositoryId: 12345, relationship: "integration", category: "agents",
    status: "reviewed", reviewedAt: "2026-09-30", sources: [{ id: "readme", ...document }], claims,
    locales: Object.fromEntries(Object.keys(LOCALES).map(locale => [locale, {
      title: `Example ${locale} title`, h1: `Example ${locale} title`, description: `Example ${locale} description`, summary: `Example ${locale} summary`,
      sections: claims.map(claim => ({ kind: claim.id, heading: `${locale} ${claim.id}`, text: `${scripts[locale] || locale} fixture ${claim.id}`, claims: [claim.id] })),
      review: { language: "model-reviewed", semantic: "source-checked", searchIntent: "inferred" },
    }])) };
  const packet = { repo, commit, documents: [document] };
  write("content/project-selection.json", { projects: [{ repo, repositoryId: record.repositoryId }] });
  write(contentPath, record);
  write(sourcePath, source);
  write(packetPath, packet);
  write(manifestPath, { records: [{ repo, file: packetPath }] });
  const run = (...args) => {
    rmSync(join(root, reportPath), { force: true });
    const result = spawnSync(process.execPath, [checker, ...args], { cwd: root, encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined);
    const report = existsSync(join(root, reportPath)) ? JSON.parse(readFileSync(join(root, reportPath), "utf8")) : null;
    assert.ok(report, result.stderr || "Checker did not produce a report");
    return { ...result, report };
  };
  return { root, write, run, record, packet };
}

function failed(result, issue) {
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.ok(result.report.errors.some(error => error.issue === issue), JSON.stringify(result.report.errors));
}

test("strict audit verifies archived bytes and exact cited lines, including CRLF sources", t => {
  const f = fixture(t, "Documented fixture behavior.\r\nA second source line.\r\n");
  const result = f.run("--sources", manifestPath);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.report.sourceVerification, "passed");
  assert.equal(result.report.sourceCheck, "cached-commit-pinned-documents");
  assert.equal(result.report.expectedSources, 1);
  assert.equal(result.report.checkedSources, 1);
  assert.equal(result.report.expectedQuotes, 4);
  assert.equal(result.report.exactQuotes, 4);
  assert.equal(result.report.rows[0].valid, true);
});

test("an empty supplied manifest fails instead of claiming cached source verification", t => {
  const f = fixture(t);
  f.write(manifestPath, { records: [] });
  const result = f.run("--sources", manifestPath);
  failed(result, "selected-source-packet-missing");
  assert.equal(result.report.sourceVerification, "failed");
  assert.equal(result.report.sourceCheck, "cached-source-verification-failed");
  assert.equal(result.report.checkedSources, 0);
  assert.equal(result.report.exactQuotes, 0);
  assert.equal(result.report.rows[0].valid, false);
});

test("missing source archives require an explicit ledger-only invocation", t => {
  const f = fixture(t);
  rmSync(join(f.root, manifestPath));
  failed(f.run(), "source-manifest-unavailable");
  const ledger = f.run("--ledger-only");
  assert.equal(ledger.status, 0, ledger.stderr || ledger.stdout);
  assert.equal(ledger.report.sourceVerification, "not-performed");
  assert.match(ledger.report.sourceCheck, /claim-ledger-only; source archive not checked/);
  assert.equal(ledger.report.sourceManifest, null);
  assert.equal(ledger.report.expectedSources, 1);
  assert.equal(ledger.report.checkedSources, 0);
  assert.equal(ledger.report.exactQuotes, 0);
});

test("ledger-only cannot hide failures in an explicitly supplied source manifest", t => {
  const f = fixture(t);
  f.write(manifestPath, { records: [] });
  failed(f.run("--ledger-only", "--sources", manifestPath), "conflicting-source-modes");
});

test("ledger-only still rejects invalid content and cannot claim source checks", t => {
  const f = fixture(t);
  delete f.record.locales.ja;
  f.write(contentPath, f.record);
  const result = f.run("--ledger-only");
  failed(result, "Missing supported locale");
  assert.equal(result.report.sourceVerification, "not-performed");
  assert.equal(result.report.checkedSources, 0);
});

for (const [name, mutate, issue] of [
  ["missing packet file", f => rmSync(join(f.root, packetPath)), "source-packet-unavailable"],
  ["malformed packet JSON", f => f.write(packetPath, "{"), "source-packet-unavailable"],
  ["packet for another repository", f => f.write(packetPath, { ...f.packet, repo: "owner/other" }), "source-packet-identity-mismatch"],
  ["missing packet document", f => f.write(packetPath, { ...f.packet, documents: [] }), "source-not-in-verified-packet"],
  ["missing cached document file", f => rmSync(join(f.root, sourcePath)), "source-file-unavailable"],
  ["document commit mismatch", f => { f.packet.documents[0].commit = "b".repeat(40); f.write(packetPath, f.packet); }, "source-not-in-verified-packet"],
  ["changed cached bytes", f => f.write(sourcePath, "Altered source.\n"), "source-hash-mismatch"],
]) {
  test(`strict audit rejects ${name}`, t => {
    const f = fixture(t);
    mutate(f);
    const result = f.run();
    failed(result, issue);
    assert.equal(result.report.sourceVerification, "failed");
    assert.equal(result.report.exactQuotes, 0);
    assert.equal(result.report.rows[0].valid, false);
  });
}

for (const [name, patch] of [
  ["text absent from the source", { quote: "Invented behavior." }],
  ["a substring presented as the complete cited line", { quote: "fixture behavior." }],
  ["the wrong source line", { start: 2, end: 2 }],
  ["an out-of-bounds line range", { end: 99 }],
]) {
  test(`strict quotation check rejects ${name}`, t => {
    const f = fixture(t);
    Object.assign(f.record.claims[0].evidence[0], patch);
    f.write(contentPath, f.record);
    const result = f.run();
    failed(result, "quotation-does-not-match-source-lines");
    assert.equal(result.report.checkedSources, 1);
    assert.equal(result.report.exactQuotes, 3);
    assert.equal(result.report.sourceVerification, "failed");
  });
}

test("partial authoring still requires every selected packet", t => {
  const f = fixture(t);
  rmSync(join(f.root, contentPath));
  f.write(manifestPath, { records: [] });
  failed(f.run("--partial"), "selected-source-packet-missing");
  f.write(manifestPath, { records: [{ repo, file: packetPath }] });
  f.write(packetPath, "null");
  failed(f.run("--partial"), "invalid-source-packet");
});

test("a partial run with no authored evidence does not report source verification", t => {
  const f = fixture(t);
  rmSync(join(f.root, contentPath));
  const result = f.run("--partial");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.report.written, 0);
  assert.equal(result.report.sourceVerification, "not-performed");
  assert.equal(result.report.checkedSources, 0);
  assert.equal(result.report.exactQuotes, 0);
});
