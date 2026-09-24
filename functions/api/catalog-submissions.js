import { json } from "../_lib/auth.js";
/** Approved public project fields only; never include submitter identity. */
export async function onRequestGet({ request, env }) {
  const cursor = new URL(request.url).searchParams.get("cursor") || "";
  const { results } = await env.DB.prepare(
    `SELECT id, name, url, description, category, evidence_url, relationship, reviewed_at
     FROM submissions WHERE status = 'approved' AND id > ? ORDER BY id LIMIT 201`
  ).bind(cursor).all();
  const projects = results.slice(0, 200);
  const withdrawn = await env.DB.prepare(`SELECT repo FROM catalog_withdrawals ORDER BY repo`).all();
  return json({ projects, excluded: withdrawn.results.map(row => row.repo), nextCursor: results.length > 200 ? projects.at(-1).id : null });
}
