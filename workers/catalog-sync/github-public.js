import { cleanText, validRepo } from "../../shared/catalog-data.js";

async function limitedText(response, limit) {
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error("Response too large"); }
    chunks.push(value);
  }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

export function parseRepositoryPage(html) {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!match[1].includes("react-app.embeddedData")) continue;
    const payload = JSON.parse(match[2]).payload;
    const repo = payload?.codeViewLayoutRoute?.repo;
    const ref = payload?.codeViewRepoRoute?.refInfo || payload?.codeViewLayoutRoute?.refInfo;
    const about = payload?.sidebarAbout;
    if (!repo || !ref?.currentOid || repo.private || !repo.public) continue;
    const fullName = `${repo.ownerLogin}/${repo.name}`;
    if (!validRepo(fullName) || !/^[a-f0-9]{40}$/.test(ref.currentOid)) continue;
    const stars = Number(about?.stargazerCount);
    const language = html.match(/href="\/[^"]+\/search\?l=[^"]+"[^>]*>[\s\S]*?<span[^>]*class="[^"]*text-bold[^\"]*"[^>]*>([^<]+)<\/span>/)?.[1]?.trim();
    return {
      id: repo.id, repo: fullName, name: repo.name, author: repo.ownerLogin,
      commit: ref.currentOid, archived: repo.isArchived === true, fork: repo.isFork === true,
      created: repo.createdAt?.slice(0, 10) || null,
      desc: cleanText(about?.description),
      ...(Number.isFinite(stars) ? { stars } : {}),
      ...(language ? { language } : {}),
      license: about?.repo?.license?.spdxId || null,
      metadataSource: "github-public-page",
    };
  }
  throw new Error("GitHub page metadata not recognized");
}

export class PublicGitHub {
  constructor(fetcher = (url, options) => fetch(url, options), apiRetryAt = 0) { this.fetcher = fetcher; this.requests = 0; this.apiRetryAt = apiRetryAt; }
  async request(url, { raw = false, html = false, limit = 1_500_000 } = {}) {
    if (++this.requests > 35) throw new Error("Batch request budget reached");
    const response = await this.fetcher(url, {
      headers: { accept: html ? "text/html" : raw ? "text/plain" : "application/vnd.github+json", "user-agent": "JevHunt public catalog (+https://jevhunt.com/methodology/)" },
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) {
      const retryAt = Number(response.headers.get("x-ratelimit-reset")) || (Number(response.headers.get("retry-after")) ? Math.floor(Date.now() / 1000) + Number(response.headers.get("retry-after")) : 0);
      await response.body?.cancel();
      throw Object.assign(new Error(`Source returned HTTP ${response.status}: ${new URL(url).pathname}`), { retryAt, status: response.status });
    }
    const text = await limitedText(response, limit);
    return raw || html ? text : JSON.parse(text);
  }
  raw(repo, commit, path) {
    return this.request(`https://raw.githubusercontent.com/${repo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`, { raw: true, limit: 500_000 });
  }
  async exists(repo, commit, path) {
    if (++this.requests > 35) throw new Error("Batch request budget reached");
    const response = await this.fetcher(`https://raw.githubusercontent.com/${repo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "HEAD", headers: { "user-agent": "JevHunt catalog verifier" }, signal: AbortSignal.timeout(12000),
    });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`Approved source returned HTTP ${response.status}`);
    return true;
  }
  async api(path) {
    const now = Math.floor(Date.now() / 1000);
    if (this.apiRetryAt > now) throw Object.assign(new Error("GitHub API is waiting for its rate limit to reset"), { status: 429, retryAt: this.apiRetryAt });
    try { return await this.request("https://api.github.com" + path, { limit: 2_000_000 }); }
    catch (error) {
      if ([403, 429].includes(error.status)) this.apiRetryAt = Math.max(now + 900, error.retryAt || 0);
      throw Object.assign(error, { retryAt: this.apiRetryAt || error.retryAt });
    }
  }
  async metadata(candidate, prior) {
    let page;
    try {
      page = await this.request("https://github.com/" + candidate.repo, { html: true });
      if (page === null) return null;
      return parseRepositoryPage(page);
    } catch (error) {
      if ([403, 429].includes(error.status)) throw error;
      // The public commit feed is a versioned fallback if GitHub changes its
      // page layout. Metadata retains its stated upstream date in this case.
      const atom = await this.request(`https://github.com/${candidate.repo}/commits/HEAD.atom`, { raw: true, limit: 100_000 });
      if (!atom) return null;
      const commit = atom.match(/Grit::Commit\/([a-f0-9]{40})/)?.[1];
      if (!commit) throw error;
      return { ...(prior || {}), repo: candidate.repo, commit,
        metadataSource: "retained-metadata-with-current-commit", metadataWarning: error.message };
    }
  }
}
