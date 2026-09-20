import { clearSessionCookie, destroySession, json } from "../../_lib/auth.js";

/** POST /api/auth/logout — destroys the session and clears the cookie. */
export async function onRequestPost({ request, env }) {
  await destroySession(request, env);

  const headers = new Headers({ "cache-control": "no-store" });
  headers.append("Set-Cookie", clearSessionCookie(request));
  return json({ ok: true }, { headers });
}

export async function onRequestGet() {
  return json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
}
