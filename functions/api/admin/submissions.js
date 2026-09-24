import { json, now, sameOrigin } from "../../_lib/auth.js";
import { adminSession } from "../../_lib/admin.js";
import { CATEGORIES, RELATIONSHIPS, evidenceUrl, readJson, textField } from "../../_lib/input.js";

export async function onRequestGet({ request, env }) {
  if (!await adminSession(request, env)) return json({ error: "forbidden" }, { status: 403 });
  const params = new URL(request.url).searchParams, status = params.get("status") || "pending";
  if (!["pending", "approved", "rejected"].includes(status)) return json({ error: "invalid_status" }, { status: 400 });
  const cursor = params.get("cursor") || "";
  if (cursor && !/^\d{1,12}:[a-f0-9-]{36}$/.test(cursor)) return json({ error: "invalid_cursor" }, { status: 400 });
  const [timestamp, id] = cursor ? cursor.split(":") : ["0", ""];
  const { results } = await env.DB.prepare(
    `SELECT id, name, url, description, category, status, created_at, reviewed_at, review_note, evidence_url, relationship
     FROM submissions WHERE status = ? AND (created_at > ? OR (created_at = ? AND id > ?))
     ORDER BY created_at, id LIMIT 101`
  ).bind(status, Number(timestamp), Number(timestamp), id).all();
  const submissions = results.slice(0, 100), last = submissions.at(-1);
  return json({ submissions, nextCursor: results.length > 100 ? `${last.created_at}:${last.id}` : null });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "invalid_origin" }, { status: 403 });
  const session = await adminSession(request, env);
  if (!session) return json({ error: "forbidden" }, { status: 403 });
  let body;
  try { body = await readJson(request); }
  catch (error) { return json({ error: error.message }, { status: error.status || 400 }); }
  if (!textField(body.id, 36, 36) || !["approved", "rejected", "pending"].includes(body.status) ||
      !["approved", "rejected", "pending"].includes(body.expectedStatus)) return json({ error: "invalid_review" }, { status: 400 });
  const note = textField(body.note, 1000, 5);
  if (!note) return json({ error: "review_note_required" }, { status: 400 });
  const row = await env.DB.prepare(`SELECT url, category FROM submissions WHERE id = ?`).bind(body.id).first();
  if (!row) return json({ error: "not_found" }, { status: 404 });
  const category = body.category || row.category, evidence = evidenceUrl(body.evidenceUrl, row.url);
  if (category === "official" && !row.url.toLowerCase().startsWith("https://github.com/typesafe-ai/")) return json({ error: "official_owner_required" }, { status: 400 });
  if (!CATEGORIES.includes(category) || (body.status === "approved" &&
      (!evidence || !RELATIONSHIPS.includes(body.relationship)))) return json({ error: "evidence_and_classification_required" }, { status: 400 });
  const result = await env.DB.prepare(
    `UPDATE submissions SET status = ?, category = ?, reviewed_at = ?, reviewed_by = ?, review_note = ?,
       evidence_url = ?, relationship = ? WHERE id = ? AND status = ?`
  ).bind(body.status, category, now(), session.user.id, note, evidence, body.relationship || null, body.id, body.expectedStatus).run();
  // Database triggers atomically queue approvals and retain withdrawals.
  if (!result.meta.changes) return json({ error: "review_conflict" }, { status: 409 });
  return json({ ok: true });
}
