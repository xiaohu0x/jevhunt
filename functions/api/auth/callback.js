import {
  consumeState, createSession, getCookie, now,
  safeNext, serializeCookie, sessionCookie, sweep, STATE_COOKIE,
} from "../../_lib/auth.js";
import { exchangeCodeForUser, isConfigured } from "../../_lib/google.js";

/** GET /api/auth/callback — Google redirects here with ?code & ?state */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = url.origin;

  const fail = (reason, status = 302) => {
    const target = new URL("/", origin);
    target.searchParams.set("auth_error", reason);
    return new Response(null, {
      status,
      headers: {
        Location: target.toString(),
        "Set-Cookie": serializeCookie(STATE_COOKIE, "", { maxAge: 0, secure: url.protocol === "https:" }),
        "Cache-Control": "no-store",
      },
    });
  };

  if (!isConfigured(env)) return fail("not_configured");
  if (url.searchParams.get("error")) return fail("cancelled");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = getCookie(request, STATE_COOKIE);

  // CSRF: the state must round-trip through both the query and our cookie.
  if (!code || !state || !cookieState || state !== cookieState) return fail("bad_state");

  const consumed = await consumeState(env, state);
  if (!consumed) return fail("expired_state");

  let profile;
  try {
    profile = await exchangeCodeForUser(env, request, code);
  } catch (err) {
    console.error("oauth exchange failed", err?.message || err);
    return fail("exchange_failed");
  }

  if (!profile.emailVerified) return fail("unverified_email");
  const t = now();
  // A Google subject is the identity. Never rebind an existing account by email.
  const emailOwner = await env.DB.prepare(`SELECT google_sub FROM users WHERE lower(email) = ?`)
    .bind(profile.email).first();
  if (emailOwner && emailOwner.google_sub !== profile.sub) return fail("account_conflict");
  let user;
  try {
    user = await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name,
         picture = excluded.picture, last_login_at = excluded.last_login_at
       RETURNING id`
    ).bind(crypto.randomUUID(), profile.sub, profile.email, profile.name, profile.picture, t, t).first();
  } catch (error) {
    console.error("oauth user update failed");
    return fail("account_conflict");
  }

  const token = await createSession(env, request, user.id);
  await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND expires_at < ?`)
    .bind(user.id, t).run();
  await sweep(env);

  const headers = new Headers({
    Location: new URL(safeNext(consumed.next), origin).toString(),
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", sessionCookie(request, token));
  headers.append("Set-Cookie", serializeCookie(STATE_COOKIE, "", {
    maxAge: 0, secure: url.protocol === "https:", sameSite: "Lax",
  }));

  return new Response(null, { status: 302, headers });
}
