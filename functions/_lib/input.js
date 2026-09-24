export const CATEGORIES = ["official", "sdks", "integrations", "agents", "browser", "apps", "games", "demos", "research", "lists"];
export const RELATIONSHIPS = ["jev-app", "integration", "sdk", "local-alternative", "research", "resource"];

export async function readJson(request, maxBytes = 8192) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw Object.assign(new Error("json_required"), { status: 415 });
  if (Number(request.headers.get("content-length")) > maxBytes) throw Object.assign(new Error("body_too_large"), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error("invalid_json"), { status: 400 });
  let size = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw Object.assign(new Error("body_too_large"), { status: 413 }); }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw Object.assign(new Error("invalid_json"), { status: 400 }); }
}

export function textField(value, max, min = 0) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max
    && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ? value.trim() : null;
}

export function normalizeGitHubRepoUrl(value) {
  if (typeof value !== "string" || value.length > 500 || /[\\\x00-\x20]/.test(value.trim())) return null;
  try {
    const parsed = new URL(value.trim());
    const parts = parsed.pathname.split("/").filter(Boolean);
    const owner = parts[0] || "", repo = (parts[1] || "").replace(/\.git$/i, "");
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.port ||
        parsed.username || parsed.password || parsed.search || parsed.hash || parts.length !== 2 ||
        !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === "." || repo === "..") return null;
    return `https://github.com/${owner}/${repo}`;
  } catch { return null; }
}

export function evidenceUrl(value, repository) {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const url = new URL(value), repo = new URL(repository);
    if (url.origin !== "https://github.com" || url.username || url.password || url.search ||
        !url.pathname.toLowerCase().startsWith(repo.pathname.toLowerCase() + "/blob/")) return null;
    if (!/\/blob\/[a-f0-9]{40}\/.+/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
