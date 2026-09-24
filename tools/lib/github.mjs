import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function githubToken() {
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  try { return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
export async function mapLimit(values, limit, fn) {
  const result = new Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) { const i = cursor++; result[i] = await fn(values[i], i); }
  }));
  return result;
}
export class GitHub {
  constructor({ token = githubToken(), cachePath = ".cache/github.json", fetcher = fetch } = {}) {
    this.token = token; this.cachePath = cachePath; this.fetcher = fetcher; this.calls = 0;
    try { this.cache = JSON.parse(readFileSync(cachePath, "utf8")); } catch { this.cache = {}; }
  }
  save() {
    mkdirSync(dirname(this.cachePath), { recursive: true });
    writeFileSync(this.cachePath + ".tmp", JSON.stringify(this.cache));
    renameSync(this.cachePath + ".tmp", this.cachePath);
  }
  async request(url, { method = "GET", body, raw = false, immutable = false } = {}) {
    const key = url;
    if (immutable && this.cache[key]?.body !== undefined) return this.cache[key].body;
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const headers = { accept: raw ? "text/plain" : "application/vnd.github+json", "user-agent": "JevHunt/0.3" };
        if (new URL(url).hostname === "api.github.com" && this.token) headers.authorization = `Bearer ${this.token}`;
        if (method === "GET" && this.cache[key]?.etag) headers["if-none-match"] = this.cache[key].etag;
        if (body) headers["content-type"] = "application/json";
        this.calls++;
        const response = await this.fetcher(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25_000) });
        if (response.status === 304) return this.cache[key].body;
        if (response.status === 404) return null;
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}: ${new URL(url).pathname}`);
          if (response.status === 401 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") !== "0")) throw Object.assign(error, { permanent: true });
          const retry = Math.min(60_000, Math.max(1000 * 2 ** attempt, Number(response.headers.get("retry-after") || 0) * 1000));
          last = error;
          if (attempt < 2) await pause(retry);
          continue;
        }
        const text = await response.text();
        if (text.length > (raw ? 500_000 : 20_000_000)) throw Object.assign(new Error("Response too large"), { permanent: true });
        const data = raw ? text : JSON.parse(text);
        if (method === "GET") this.cache[key] = { etag: response.headers.get("etag"), body: data };
        return data;
      } catch (error) { if (error.permanent) throw error; last = error; if (attempt < 2) await pause(1000 * 2 ** attempt); }
    }
    throw last;
  }
  api(path, options) { return this.request("https://api.github.com" + path, options); }
  raw(repo, commit, path) {
    return this.request(`https://raw.githubusercontent.com/${repo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`, { raw: true, immutable: /^[a-f0-9]{40}$/i.test(commit) });
  }
  async metadata(repos) {
    if (!this.token) throw new Error("GitHub authentication required. Set GITHUB_TOKEN or authenticate gh.");
    const output = new Map();
    for (let start = 0; start < repos.length; start += 35) {
      if (start % 350 === 0) console.log(`  metadata ${start}/${repos.length}`);
      const batch = repos.slice(start, start + 35);
      const fields = batch.map((repo, index) => {
        const [owner, name] = repo.split("/");
        return `r${index}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { databaseId nameWithOwner description url isPrivate isArchived isFork stargazerCount createdAt pushedAt primaryLanguage { name } licenseInfo { spdxId } defaultBranchRef { name target { oid } } }`;
      }).join("\n");
      try {
        const response = await this.api("/graphql", { method: "POST", body: { query: `query { ${fields} }` } });
        for (let i = 0; i < batch.length; i++) {
          const item = response.data?.["r" + i];
          const errors = (response.errors || []).filter(e => !e.path || e.path[0] === "r" + i);
          output.set(batch[i].toLowerCase(), item || { unavailable: true, reason: errors.some(e => e.type !== "NOT_FOUND") ? "fetch-error" : "not-found" });
        }
      } catch { for (const repo of batch) output.set(repo.toLowerCase(), { unavailable: true, reason: "fetch-error" }); }
    }
    return output;
  }
  async search(query, { maxPages = 60 } = {}) {
    let requests = 0, truncated = false;
    const found = new Map();
    const today = new Date().toISOString().slice(0, 10);
    const collect = async (from, to) => {
      if (requests >= maxPages) { truncated = true; return; }
      const q = `${query} created:${from}..${to}`;
      const page = async n => {
        // Search has its own, much smaller quota.
        if (requests) await pause(2100);
        requests++;
        return this.api(`/search/repositories?q=${encodeURIComponent(q)}&per_page=100&page=${n}`);
      };
      const first = await page(1);
      if (!first) throw new Error("GitHub search unavailable");
      if (first.incomplete_results) truncated = true;
      if (first.total_count > 1000 && from !== to) {
        const left = Date.parse(from), right = Date.parse(to);
        const mid = new Date(left + Math.floor((right - left) / 172800000) * 86400000).toISOString().slice(0, 10);
        const after = new Date(Date.parse(mid) + 86400000).toISOString().slice(0, 10);
        await collect(from, mid); await collect(after, to); return;
      }
      if (first.total_count > 1000) truncated = true;
      for (const repo of first.items) found.set(repo.id, repo);
      for (let p = 2; p <= Math.min(10, Math.ceil(first.total_count / 100)); p++) {
        if (requests >= maxPages) { truncated = true; break; }
        const data = await page(p);
        if (data.incomplete_results) truncated = true;
        for (const repo of data.items) found.set(repo.id, repo);
      }
    };
    await collect("2008-01-01", today);
    return { items: [...found.values()], requests, truncated };
  }
}
