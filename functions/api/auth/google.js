import { issueState, serializeCookie, safeNext, STATE_COOKIE } from "../../_lib/auth.js";
import { buildAuthUrl, isConfigured } from "../../_lib/google.js";

/**
 * GET /api/auth/google?next=/some/path
 * Starts the Google OAuth Authorization Code flow.
 */
export async function onRequestGet({ request, env }) {
  if (!isConfigured(env)) {
    return Response.json(
      { error: "google_oauth_not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const state = await issueState(env, next);
  const secure = url.protocol === "https:";

  return new Response(null, {
    status: 302,
    headers: {
      Location: buildAuthUrl(env, request, state),
      "Set-Cookie": serializeCookie(STATE_COOKIE, state, {
        maxAge: 600, secure, sameSite: "Lax",
      }),
      "Cache-Control": "no-store",
    },
  });
}
