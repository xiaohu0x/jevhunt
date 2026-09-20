import { getSession, json, now } from "../_lib/auth.js";

const MAX_PER_HOUR = 5;
const FIELDS = { name: 120, url: 500, description: 1000, category: 60 };

const clean = (v, max) => String(v ?? "").trim().slice(0, max);

export function normalizeGitHubRepoUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? "").trim());
  } catch {
    return null;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  const owner = parts[0] ?? "";
  const repo = (parts[1] ?? "").replace(/\.git$/i, "");
  const validOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner);
  const validRepo = repo.length <= 100 && /^[A-Za-z0-9._-]+$/.test(repo) && repo !== "." && repo !== "..";

  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" ||
      parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
      parts.length !== 2 || !validOwner || !validRepo) return null;

  return `https://github.com/${owner}/${repo}`;
}

/**
 * GET /api/submissions
 * The signed-in user's own submissions. Returns an empty list when anonymous.
 */
export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ submissions: [] });

  const rows = await env.DB.prepare(
    `SELECT id, name, url, description, category, status, created_at
       FROM submissions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20`
  ).bind(session.user.id).all();

  return json({ submissions: rows.results ?? [] });
}

/**
 * POST /api/submissions
 * Creates a pending submission. Requires a session.
 */
export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "unauthorized" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const name = clean(body.name, FIELDS.name);
  const url = normalizeGitHubRepoUrl(clean(body.url, FIELDS.url));
  const description = clean(body.description, FIELDS.description);
  const category = clean(body.category, FIELDS.category);

  if (name.length < 2) return json({ error: "invalid_name" }, { status: 400 });
  if (!url) return json({ error: "invalid_url" }, { status: 400 });

  const t = now();

  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM submissions WHERE user_id = ? AND created_at > ?`
  ).bind(session.user.id, t - 3600).first();

  if ((recent?.n ?? 0) >= MAX_PER_HOUR) {
    return json({ error: "rate_limited", limit: MAX_PER_HOUR }, { status: 429 });
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO submissions (id, user_id, name, url, description, category, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(id, session.user.id, name, url, description, category, t).run();

  return json(
    {
      ok: true,
      submission: { id, name, url, description, category, status: "pending", created_at: t },
    },
    { status: 201 }
  );
}
