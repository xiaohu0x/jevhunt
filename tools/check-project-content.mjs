import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { validateProjectContent, PROJECT_CONTENT_VERSION } from "../shared/project-content.js";
import { LOCALES } from "../shared/locales.js";

const { values } = parseArgs({ options: { partial: { type: "boolean", default: false },
  selection: { type: "string", default: "content/project-selection.json" },
  sources: { type: "string" },
  "ledger-only": { type: "boolean", default: false },
  out: { type: "string", default: "reports/project-content-100" } } });
const selection = JSON.parse(readFileSync(values.selection, "utf8"));
const ledgerOnly = values["ledger-only"];
const manifestFile = values.sources || ".cache/project-content/manifest.json";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const errors = [], warnings = [], rows = [];
let exactQuotes = 0, checkedSources = 0, expectedQuotes = 0, expectedSources = 0, sourceFailures = 0;
function sourceError(issue, details = {}) {
  sourceFailures++;
  errors.push({ ...details, issue });
}
function readArchiveJson(file, issue, details = {}) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { sourceError(issue, { ...details, file, detail: error.message }); return undefined; }
}
const packets = new Map();
if (ledgerOnly && values.sources !== undefined) {
  sourceError("conflicting-source-modes", { detail: "--ledger-only cannot be combined with --sources; a supplied archive must be verified." });
} else if (!ledgerOnly) {
  const sourceManifest = readArchiveJson(manifestFile, "source-manifest-unavailable");
  if (sourceManifest !== undefined && !Array.isArray(sourceManifest?.records)) sourceError("invalid-source-manifest", { file: manifestFile });
  for (const entry of Array.isArray(sourceManifest?.records) ? sourceManifest.records : []) {
    if (typeof entry?.repo !== "string" || !entry.repo || typeof entry.file !== "string" || !entry.file) {
      sourceError("invalid-source-manifest-entry", { file: manifestFile }); continue;
    }
    const key = entry.repo.toLowerCase();
    if (packets.has(key)) sourceError("duplicate-source-manifest-entry", { repo: entry.repo });
    packets.set(key, entry.file);
  }
}
function selectedPacket(repo) {
  if (ledgerOnly) return null;
  const file = packets.get(repo.toLowerCase());
  if (!file) { sourceError("selected-source-packet-missing", { repo, manifest: manifestFile }); return null; }
  const packet = readArchiveJson(file, "source-packet-unavailable", { repo });
  if (packet === undefined) return null;
  if (!packet || typeof packet !== "object" || !Array.isArray(packet.documents)) {
    sourceError("invalid-source-packet", { repo, file }); return null;
  }
  if (typeof packet.repo !== "string" || packet.repo.toLowerCase() !== repo.toLowerCase()) {
    sourceError("source-packet-identity-mismatch", { repo, file }); return null;
  }
  return packet;
}
for (const selected of selection.projects) {
  const errorStart = errors.length;
  // Partial authoring may omit a content record, never its selected source packet.
  const packet = selectedPacket(selected.repo);
  const file = join("content/projects", selected.repo.toLowerCase() + ".json");
  if (!existsSync(file)) { if (!values.partial) errors.push({ repo: selected.repo, issue: "missing-record" }); continue; }
  const record = JSON.parse(readFileSync(file, "utf8"));
  const problems = validateProjectContent(record);
  if (record.repositoryId !== selected.repositoryId || record.repo.toLowerCase() !== selected.repo.toLowerCase()) problems.push("Selected identity differs");
  errors.push(...problems.map(issue => ({ repo: selected.repo, issue })));
  const sourceText = new Map();
  for (const source of record.sources || []) {
    expectedSources++;
    if (ledgerOnly) continue;
    if (!packet) continue;
    const document = packet.documents.find(document => document?.url === source.url && document.sha256 === source.sha256
      && document.commit === source.commit && document.path === source.path);
    if (!document) { sourceError("source-not-in-verified-packet", { repo: record.repo, source: source.id }); continue; }
    let bytes;
    try {
      if (typeof document.file !== "string" || !document.file) throw new Error("Missing archived document path");
      bytes = readFileSync(document.file);
    } catch (error) { sourceError("source-file-unavailable", { repo: record.repo, source: source.id, file: document.file, detail: error.message }); continue; }
    if (hash(bytes) !== source.sha256) { sourceError("source-hash-mismatch", { repo: record.repo, source: source.id }); continue; }
    sourceText.set(source.id, bytes.toString("utf8").replace(/\r\n/g, "\n").split("\n")); checkedSources++;
  }
  for (const claim of record.claims || []) for (const evidence of claim.evidence || []) {
    expectedQuotes++;
    if (ledgerOnly) continue;
    const lines = sourceText.get(evidence.source);
    if (!lines) { sourceError("quotation-source-unverified", { repo: record.repo, claim: claim.id, source: evidence.source }); continue; }
    const validRange = Number.isInteger(evidence.start) && evidence.start > 0 && Number.isInteger(evidence.end)
      && evidence.end >= evidence.start && evidence.end <= lines.length;
    const span = validRange ? lines.slice(evidence.start - 1, evidence.end).join("\n") : null;
    if (!validRange || typeof evidence.quote !== "string" || span !== evidence.quote.replace(/\r\n/g, "\n")) {
      sourceError("quotation-does-not-match-source-lines", { repo: record.repo, claim: claim.id, source: evidence.source, start: evidence.start, end: evidence.end });
    } else exactQuotes++;
  }
  for (const [locale, copy] of Object.entries(record.locales || {})) {
    if (locale !== "en" && copy.description === record.locales.en?.description) errors.push({ repo: record.repo, locale, issue: "English-description-fallback" });
    for (const section of copy.sections || []) {
      if (locale !== "en" && section.text === record.locales.en?.sections.find(item => item.kind === section.kind)?.text) errors.push({ repo: record.repo, locale, issue: "English-body-fallback", section: section.kind });
    }
    const body = copy.sections?.map(section => section.text).join(" ") || "";
    const script = { "zh-cn": /\p{Script=Han}/u, "zh-tw": /\p{Script=Han}/u, ja: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, ko: /\p{Script=Hangul}/u, ru: /\p{Script=Cyrillic}/u, hi: /\p{Script=Devanagari}/u }[locale];
    if (script && !script.test(body)) errors.push({ repo: record.repo, locale, issue: "missing-target-script" });
    if (copy.title?.startsWith(record.repo)) warnings.push({ repo: record.repo, locale, issue: "owner-prefix-needs-review" });
  }
  rows.push({ repo: record.repo, relationship: record.relationship, category: record.category, status: record.status, locales: Object.keys(record.locales || {}).length, valid: errors.length === errorStart });
}
const expected = new Set(selection.projects.map(project => project.repo.toLowerCase()));
function inventory(path) { return existsSync(path) ? readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? inventory(join(path, entry.name)) : entry.name.endsWith(".json") ? [join(path, entry.name)] : []) : []; }
for (const file of inventory("content/projects")) { const record = JSON.parse(readFileSync(file, "utf8")); if (!expected.has(record.repo.toLowerCase())) errors.push({ repo: record.repo, issue: "outside-selected-batch" }); }
const sourceVerification = ledgerOnly ? "not-performed" : sourceFailures ? "failed" : checkedSources && exactQuotes ? "passed" : "not-performed";
const report = { version: PROJECT_CONTENT_VERSION, checkedAt: new Date().toISOString(), selected: selection.projects.length, written: rows.length,
  expectedLocalePages: selection.projects.length * Object.keys(LOCALES).length, writtenLocalePages: rows.reduce((sum, row) => sum + row.locales, 0),
  sourceCheck: ledgerOnly ? "claim-ledger-only; source archive not checked (--ledger-only)"
    : sourceFailures ? "cached-source-verification-failed"
      : sourceVerification === "passed" ? "cached-commit-pinned-documents" : "cached-source-archive; no source evidence checked",
  sourceVerification, sourceManifest: ledgerOnly ? null : resolve(manifestFile), expectedSources, checkedSources, expectedQuotes, exactQuotes, errors, warnings, rows };
mkdirSync(values.out, { recursive: true });
writeFileSync(join(values.out, "content-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ selected: report.selected, written: report.written, localePages: report.writtenLocalePages, sourceVerification, checkedSources, exactQuotes, errors: errors.length, warnings: warnings.length, report: resolve(values.out, "content-check.json") }));
if (errors.length) process.exitCode = 1;
