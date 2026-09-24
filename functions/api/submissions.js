import { getSession, json, now, sameOrigin } from "../_lib/auth.js";
import { CATEGORIES, normalizeGitHubRepoUrl, readJson, textField } from "../_lib/input.js";
export { normalizeGitHubRepoUrl } from "../_lib/input.js";
const MAX_PER_HOUR = 5;

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ submissions: [] });
  const rows = await env.DB.prepare(
    `SELECT id, name, url, description, category, status, created_at, reviewed_at, review_note
     FROM submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(session.user.id).all();
  return json({ submissions: rows.results ?? [] });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "invalid_origin" }, { status: 403 });
  const session = await getSession(request, env);
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  let body;
  try { body = await readJson(request); }
  catch (error) { return json({ error: error.message }, { status: error.status || 400 }); }
  const name = textField(body.name, 120, 2), url = normalizeGitHubRepoUrl(body.url);
  const description = textField(body.description ?? "", 1000);
  if (!name) return json({ error: "invalid_name" }, { status: 400 });
  if (!url) return json({ error: "invalid_url" }, { status: 400 });
  if (description === null) return json({ error: "invalid_description" }, { status: 400 });
  if (!CATEGORIES.includes(body.category)) return json({ error: "invalid_category" }, { status: 400 });
  if (body.consent !== true) return json({ error: "consent_required" }, { status: 400 });
  const t = now(), id = crypto.randomUUID();
  // The quota and duplicate checks share the INSERT's SQLite write transaction.
  const result = await env.DB.prepare(
    `INSERT INTO submissions (id, user_id, name, url, description, category, status, created_at, consent_at)
     SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, ?
     WHERE (SELECT COUNT(*) FROM submissions WHERE user_id = ? AND created_at > ?) < ?
       AND NOT EXISTS (SELECT 1 FROM submissions WHERE user_id = ? AND lower(url) = lower(?)
                       AND status IN ('pending', 'approved'))`
  ).bind(id, session.user.id, name, url, description, body.category, t, t,
    session.user.id, t - 3600, MAX_PER_HOUR, session.user.id, url).run();
  if (!result.meta.changes) {
    const duplicate = await env.DB.prepare(
      `SELECT id FROM submissions WHERE user_id = ? AND lower(url) = lower(?) AND status IN ('pending', 'approved')`
    ).bind(session.user.id, url).first();
    return duplicate ? json({ error: "duplicate_submission" }, { status: 409 })
      : json({ error: "rate_limited", limit: MAX_PER_HOUR }, { status: 429, headers: { "Retry-After": "3600" } });
  }
  return json({ ok: true, submission: { id, name, url, description, category: body.category, status: "pending", created_at: t } }, { status: 201 });
}
