import { getSession, json } from "../_lib/auth.js";
import { isAdmin } from "../_lib/admin.js";
import { isConfigured } from "../_lib/google.js";

/**
 * GET /api/me
 * Returns the signed-in user (or null) plus whether Google login is available.
 */
export async function onRequestGet({ request, env }) {
  let session = null;
  try {
    session = await getSession(request, env);
  } catch (err) {
    console.error("session lookup failed", err?.message || err);
    return json({ user: null, authEnabled: isConfigured(env) }, { status: 503 });
  }

  return json({
    user: session?.user ?? null,
    isAdmin: isAdmin(session?.user, env),
    authEnabled: isConfigured(env),
  });
}
