/* ==========================================================================
   JevHunt — Google OAuth 2.0 (OpenID Connect)
   Authorization Code flow, server-side exchange.
   ========================================================================== */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export function redirectUri(request) {
  return `${new URL(request.url).origin}/api/auth/callback`;
}

export function isConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function buildAuthUrl(env, request, state) {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("access_type", "online");
  return url.toString();
}

/** Exchange the authorization code for tokens, then fetch the profile. */
export async function exchangeCodeForUser(env, request, code) {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(request),
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    throw new Error(`token_exchange_failed:${tokenRes.status}:${detail.slice(0, 200)}`);
  }

  const tokens = await tokenRes.json();
  if (!tokens.access_token) throw new Error("no_access_token");

  // The access token came straight from Google over TLS, so calling userinfo
  // is authoritative — no need to hand-verify the id_token signature.
  const infoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) throw new Error(`userinfo_failed:${infoRes.status}`);

  const profile = await infoRes.json();
  if (!profile.sub || !profile.email) throw new Error("incomplete_profile");

  return {
    sub: profile.sub,
    email: profile.email,
    emailVerified: profile.email_verified === true,
    name: profile.name || profile.email.split("@")[0],
    picture: profile.picture || null,
  };
}
