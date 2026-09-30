// Restore immutable evidence from the committed content ledger, without generating
// content or treating repository text as instructions. Hashes remain authoritative.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { mapLimit } from "../shared/concurrency.js";
import { validateProjectContent } from "../shared/project-content.js";

const ARCHIVE_KIND = "reviewed-project-sources";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function writeAtomic(file, value) {
  const temporary = file + ".tmp-" + randomUUID();
  try { writeFileSync(temporary, value); renameSync(temporary, file); }
  finally { rmSync(temporary, { force: true }); }
}
const writeJson = (file, value) => writeAtomic(file, JSON.stringify(value, null, 2) + "\n");

function rawSourceUrl(source) {
  const url = new URL(source.url);
  const parts = url.pathname.slice(1).split("/").map(decodeURIComponent);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash
    || parts[2] !== "blob" || parts[3] !== source.commit || parts.length < 5
    || parts.slice(4).join("/") !== source.path) {
    throw new Error(`Source ${source.id} must identify its exact GitHub commit and document path`);
  }
  return "https://raw.githubusercontent.com/" + [parts[0], parts[1], source.commit, ...parts.slice(4)].map(encodeURIComponent).join("/");
}

async function downloadSource(url, { fetchImpl, waitImpl, timeoutMs }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let retryAfter = 0;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "JevHunt-reviewed-source-restoration/1.0" } });
      if (!response.ok) {
        const retryable = response.status === 403 || response.status === 429 || response.status >= 500;
        const header = response.headers.get("retry-after");
        retryAfter = header && Number.isFinite(Number(header)) ? Number(header) * 1000 : 0;
        throw Object.assign(new Error(`HTTP ${response.status}`), { retryable });
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 2_000_000) throw Object.assign(new Error("Source exceeds the 2 MB archive limit"), { retryable: false });
      return bytes;
    } catch (error) {
      if (attempt === 2 || error.retryable === false) throw new Error(`${url}: ${error.message}`);
      await waitImpl(Math.min(10000, Math.max(250 * 2 ** attempt, retryAfter)));
    }
  }
}

export async function restoreProjectSources({
  selectionFile = "content/project-selection.json", contentDirectory = "content/projects",
  out = ".cache/project-content-reviewed", concurrency = 6,
  fetchImpl = globalThis.fetch, waitImpl = pause, timeoutMs = 18000,
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) throw new Error("Concurrency must be an integer from 1 to 12");
  const root = resolve(out), manifestFile = join(root, "manifest.json");
  // A new reviewed archive must not replace the collector's whole-catalog archive.
  if (existsSync(manifestFile) && JSON.parse(readFileSync(manifestFile, "utf8"))?.kind !== ARCHIVE_KIND) {
    throw new Error(`Refusing to replace an unrelated source manifest: ${manifestFile}. Choose a separate --out directory.`);
  }
  const selectionBytes = readFileSync(selectionFile);
  const selection = JSON.parse(selectionBytes.toString("utf8"));
  if (!Array.isArray(selection.projects) || !selection.projects.length) throw new Error("Selection must contain at least one project");
  const seen = new Set(), sources = new Map();
  // Validate the complete ledger before making network requests or writing packets.
  const records = selection.projects.map(selected => {
    if (typeof selected.repo !== "string" || !/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(selected.repo)) throw new Error("Invalid selected repository");
    const key = selected.repo.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate selected repository: ${selected.repo}`);
    seen.add(key);
    const record = JSON.parse(readFileSync(join(contentDirectory, key + ".json"), "utf8"));
    const errors = validateProjectContent(record);
    if (record.repo?.toLowerCase() !== key || record.repositoryId !== selected.repositoryId) errors.push("Selected identity differs");
    if (errors.length) throw new Error(`${selected.repo}: ${errors.join("; ")}`);
    for (const source of record.sources) {
      const rawUrl = rawSourceUrl(source), previous = sources.get(source.url);
      if (previous && previous.sha256 !== source.sha256) throw new Error(`Conflicting recorded hashes for ${source.url}`);
      sources.set(source.url, { ...source, rawUrl });
    }
    return record;
  });
  for (const directory of ["sources", "packets"]) mkdirSync(join(root, directory), { recursive: true });
  const restoredAt = new Date().toISOString();
  let downloaded = 0, reused = 0;
  const results = await mapLimit([...sources.values()], concurrency, async source => {
    try {
      const file = join(root, "sources", hash(source.url) + ".txt");
      let bytes = existsSync(file) ? readFileSync(file) : null;
      if (bytes && hash(bytes) === source.sha256) reused++;
      else {
        bytes = await downloadSource(source.rawUrl, { fetchImpl, waitImpl, timeoutMs });
        const received = hash(bytes);
        if (received !== source.sha256) throw new Error(`${source.url}: SHA-256 mismatch; expected ${source.sha256}, received ${received}`);
        writeAtomic(file, bytes);
        downloaded++;
      }
      return { url: source.url, document: {
        path: source.path, commit: source.commit, url: source.url, rawUrl: source.rawUrl,
        sha256: source.sha256, accessedAt: source.accessedAt, restoredAt, file,
        bytes: bytes.length, lines: bytes.toString("utf8").split("\n").length, provenance: "restored-from-reviewed-ledger",
      } };
    } catch (error) { return { error }; }
  });
  // Wait for every in-flight request before failing; valid bytes remain resumable,
  // but no new manifest or packet can advertise an incomplete restoration.
  const failures = results.filter(result => result.error);
  if (failures.length) throw new Error(`Source restoration failed for ${failures.length} document(s):\n${failures.map(result => result.error.message).join("\n")}`);
  const documents = new Map(results.map(result => [result.url, result.document]));
  const manifestRecords = records.map(record => {
    const file = join(root, "packets", hash(record.repo.toLowerCase()).slice(0, 20) + ".json");
    writeJson(file, {
      repo: record.repo, repositoryId: record.repositoryId, status: "restored", restoredAt,
      documents: record.sources.map(source => ({ ...documents.get(source.url), accessedAt: source.accessedAt })),
    });
    return { repo: record.repo, status: "restored", file };
  });
  const manifest = { kind: ARCHIVE_KIND, version: 1, restoredAt, selectionFile: resolve(selectionFile),
    selectionSha256: hash(selectionBytes), counters: { projects: records.length, documents: documents.size, downloaded, reused }, records: manifestRecords };
  writeJson(manifestFile, manifest);
  return { ...manifest.counters, manifest: manifestFile };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      selection: { type: "string", default: "content/project-selection.json" },
      out: { type: "string", default: ".cache/project-content-reviewed" },
      concurrency: { type: "string", default: "6" },
    } });
    console.log(JSON.stringify(await restoreProjectSources({ selectionFile: values.selection, out: values.out, concurrency: Number(values.concurrency) })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
