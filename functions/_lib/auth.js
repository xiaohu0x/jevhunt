/* ==========================================================================
   JevHunt — auth helpers (Cloudflare Pages Functions)
   Sessions are stored in D1 as SHA-256 hashes; the raw token only ever
   lives in an HttpOnly cookie.
   ========================================================================== */

export const SESSION_COOKIE = "jh_session";
export const STATE_COOKIE = "jh_oauth_state";
export const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days (seconds)

/* ----------------------------- primitives ------------------------------- */

export function json(data, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin && request.headers.get("Sec-Fetch-Site") !== "cross-site";
}

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256hex(input) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const now = () => Math.floor(Date.now() / 1000);

/* ----------------------------- cookies ---------------------------------- */

export function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  try { return match ? decodeURIComponent(match[1]) : null; } catch { return null; }
}

export function serializeCookie(name, value, opts = {}) {
  const {
    maxAge, path = "/", httpOnly = true, secure = true, sameSite = "Lax",
  } = opts;
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

/** Secure cookies only over https so local `wrangler pages dev` works. */
const isHttps = (request) => new URL(request.url).protocol === "https:";

/* ----------------------------- sessions --------------------------------- */

export async function createSession(env, request, userId) {
  const token = randomToken(32);
  const id = await sha256hex(token);
  const t = now();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    id, userId, t, t + SESSION_TTL,
    (request.headers.get("User-Agent") || "").slice(0, 255),
    request.headers.get("CF-Connecting-IP") || ""
  ).run();
  return token;
}

export function sessionCookie(request, token, maxAge = SESSION_TTL) {
  return serializeCookie(SESSION_COOKIE, token, {
    maxAge, secure: isHttps(request), sameSite: "Lax",
  });
}

export function clearSessionCookie(request) {
  return serializeCookie(SESSION_COOKIE, "", {
    maxAge: 0, secure: isHttps(request), sameSite: "Lax",
  });
}

/** Fixed 30-day lifetime, matching the cookie. Logging in creates a new session. */
export async function getSession(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;

  const id = await sha256hex(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.name, u.picture, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`
  ).bind(id).first();

  if (!row) return null;

  const t = now();
  if (row.expires_at <= t) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
    return null;
  }

  return {
    sessionId: id,
    user: {
      id: row.id, email: row.email, name: row.name,
      picture: row.picture, created_at: row.created_at,
    },
  };
}

export async function destroySession(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`)
    .bind(await sha256hex(token)).run();
}

/* ----------------------------- oauth state ------------------------------ */

export async function issueState(env, next = "/") {
  const state = randomToken(16);
  const t = now();
  await env.DB.prepare(
    `INSERT INTO oauth_states (state, next, created_at, expires_at) VALUES (?, ?, ?, ?)`
  ).bind(state, next, t, t + 600).run();
  return state;
}

/** Single-use: consumes the state if valid, returns its row, else null. */
export async function consumeState(env, state) {
  if (!state) return null;
  const row = await env.DB.prepare(
    `DELETE FROM oauth_states WHERE state = ? RETURNING expires_at, next`
  ).bind(state).first();
  return row && row.expires_at > now() ? row : null;
}

/** Only allow same-origin absolute paths (block //evil.com and schemes). */
export function safeNext(value) {
  if (typeof value !== "string" || !value.startsWith("/") || /[\\\x00-\x20\x7f]/.test(value)) return "/";
  try {
    const base = "https://jevhunt.invalid";
    const url = new URL(value, base);
    return url.origin === base ? url.pathname + url.search + url.hash : "/";
  } catch { return "/"; }
}

/** Housekeeping — called opportunistically, cheap and indexed. */
export async function sweep(env) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(t),
    env.DB.prepare(`DELETE FROM oauth_states WHERE expires_at < ?`).bind(t),
  ]);
}
