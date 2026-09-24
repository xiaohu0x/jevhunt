import assert from "node:assert/strict";
import test from "node:test";
import { json, safeNext, getCookie, createSession, getSession, consumeState, issueState, now } from "../functions/_lib/auth.js";
import { onRequestPost as submit } from "../functions/api/submissions.js";
import { onRequestPost as logout } from "../functions/api/auth/logout.js";
import { onRequestGet as queue, onRequestPost as review } from "../functions/api/admin/submissions.js";
import { onRequestGet as published } from "../functions/api/catalog-submissions.js";
import { onRequestGet as callback } from "../functions/api/auth/callback.js";
import { onRequest as canonical } from "../functions/_middleware.js";

import { database } from "./helpers/d1.mjs";

async function setup(t) {
  const DB = database();
  t.after(() => DB.db.close());
  DB.db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)").run("user", "google-sub", "owner@example.com", "Owner", null, now(), now());
  const env = { DB, ADMIN_EMAILS: "owner@example.com" };
  const token = await createSession(env, new Request("https://jevhunt.com"), "user");
  const request = (path = "/api/submissions", body, extra = {}) => new Request("https://jevhunt.com" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Cookie: `jh_session=${token}`, Origin: "https://jevhunt.com", "Content-Type": "application/json", ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { env, request };
}
const payload = (i = 0) => ({ name: `Project ${i}`, url: `https://github.com/example/repo-${i}`, description: "A test", category: "apps", consent: true });

test("www requests redirect to the canonical HTTPS origin before login or rendering", async () => {
  const response = await canonical({ request: new Request("https://www.jevhunt.com/zh-cn/?q=router"), next() { throw new Error("Should redirect first"); } });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://jevhunt.com/zh-cn/?q=router");
  assert.equal(await (await canonical({ request: new Request("https://jevhunt.com/"), next: () => new Response("ok") })).text(), "ok");
});

test("redirect normalization rejects scheme, control and backslash authority tricks", () => {
  for (const value of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "https://evil.example", null, "/path\u007f"]) assert.equal(safeNext(value), "/", JSON.stringify(value));
  assert.equal(safeNext("/zh-cn/?q=router#apps"), "/zh-cn/?q=router#apps");
});
test("JSON preserves Headers and malformed cookies are ignored", () => {
  assert.equal(json({}, { headers: new Headers({ "Set-Cookie": "jh_session=; Max-Age=0" }) }).headers.get("set-cookie"), "jh_session=; Max-Age=0");
  assert.equal(getCookie(new Request("https://jevhunt.com", { headers: { Cookie: "jh_session=%" } }), "jh_session"), null);
});
test("session expiry is fixed; logout clears both the row and browser cookie", async t => {
  const { env, request } = await setup(t);
  const req = request("/api/auth/logout", {});
  assert.ok(await getSession(req, env));
  const before = env.DB.db.prepare("SELECT expires_at FROM sessions").get();
  await getSession(req, env);
  assert.deepEqual(env.DB.db.prepare("SELECT expires_at FROM sessions").get(), before);
  const response = await logout({ request: req, env });
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(await getSession(req, env), null);
});
test("OAuth state can only be consumed once", async t => {
  const { env } = await setup(t);
  const state = await issueState(env, "/zh-cn/");
  const results = await Promise.all([consumeState(env, state), consumeState(env, state)]);
  assert.equal(results.filter(Boolean).length, 1);
});
test("submission rejects invalid JSON shapes, fields, consent and origin without writing", async t => {
  const { env, request } = await setup(t);
  for (const body of [null, [], { ...payload(), name: 42 }, { ...payload(), category: "made-up" }, { ...payload(), consent: false }, { ...payload(), description: "x".repeat(1001) }]) {
    assert.equal((await submit({ request: request(undefined, body), env })).status, 400);
  }
  assert.equal((await submit({ request: request(undefined, { ...payload(), description: "x".repeat(9000) }), env })).status, 413);
  assert.equal((await submit({ request: request(undefined, payload(), { Origin: "https://evil.example" }), env })).status, 403);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) n FROM submissions").get().n, 0);
});
test("concurrent submissions enforce five per hour and reject case-insensitive duplicates", async t => {
  const { env, request } = await setup(t);
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => submit({ request: request(undefined, payload(i)), env })));
  assert.equal(responses.filter(r => r.status === 201).length, 5);
  assert.equal(responses.filter(r => r.status === 429).length, 7);
  const duplicate = await submit({ request: request(undefined, { ...payload(), url: "https://github.com/EXAMPLE/repo-0" }), env });
  assert.equal(duplicate.status, 409);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) n FROM submissions").get().n, 5);
});
test("moderation requires admin and pinned evidence; export excludes identities and rejected projects", async t => {
  const { env, request } = await setup(t);
  const created = await (await submit({ request: request(undefined, payload()), env })).json();
  const id = created.submission.id;
  const input = { id, expectedStatus: "pending", status: "approved", note: "Confirmed Jev invocation in source", relationship: "jev-app", category: "apps", evidenceUrl: "https://github.com/example/repo-0/blob/" + "a".repeat(40) + "/app.py" };
  assert.equal((await queue({ request: request("/api/admin/submissions"), env: { ...env, ADMIN_EMAILS: "" } })).status, 403);
  assert.equal((await review({ request: request("/api/admin/submissions", { ...input, evidenceUrl: input.evidenceUrl.replace("a".repeat(40), "main") }), env })).status, 400);
  assert.equal((await review({ request: request("/api/admin/submissions", input), env })).status, 200);
  assert.equal((await review({ request: request("/api/admin/submissions", input), env })).status, 409);
  const output = await (await published({ request: request("/api/catalog-submissions"), env })).json();
  assert.equal(output.projects.length, 1);
  assert.ok(!JSON.stringify(output).includes("owner@example.com"));
  assert.ok(!JSON.stringify(output).includes("Confirmed Jev"));
  assert.equal((await review({ request: request("/api/admin/submissions", { ...input, status: "rejected", expectedStatus: "approved", note: "Integration removed" }), env })).status, 200);
  const withdrawn = await (await published({ request: request("/api/catalog-submissions"), env })).json();
  assert.equal(withdrawn.projects.length, 0);
  assert.deepEqual(withdrawn.excluded, ["example/repo-0"]);
  assert.equal((await review({ request: request("/api/admin/submissions", { ...input, expectedStatus: "rejected" }), env })).status, 200);
  assert.deepEqual((await (await published({ request: request("/api/catalog-submissions"), env })).json()).excluded, []);
});

test("moderation pagination does not skip pending rows after earlier entries are reviewed", async t => {
  const { env, request } = await setup(t);
  const insert = env.DB.db.prepare("INSERT INTO submissions (id, user_id, name, url, status, created_at) VALUES (?, 'user', 'Test', 'https://github.com/a/b', 'pending', ?)");
  for (let i = 0; i < 102; i++) insert.run(crypto.randomUUID(), now() + i);
  const first = await (await queue({ request: request("/api/admin/submissions"), env })).json();
  assert.equal(first.submissions.length, 100);
  for (const row of first.submissions.slice(0, 50)) env.DB.db.prepare("UPDATE submissions SET status='approved' WHERE id=?").run(row.id);
  const second = await (await queue({ request: request("/api/admin/submissions?cursor=" + encodeURIComponent(first.nextCursor)), env })).json();
  assert.equal(second.submissions.length, 2);
  assert.ok(second.submissions.every(row => !first.submissions.some(previous => previous.id === row.id)));
});

function mockGoogle(t, profile) {
  t.mock.method(globalThis, "fetch", async url => {
    if (String(url).includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "offline-google-test" });
    if (String(url).includes("openidconnect.googleapis.com/v1/userinfo")) return Response.json(profile);
    throw new Error("Unexpected network request in OAuth test");
  });
}
async function oauthRequest(env, next = "/browse/") {
  const state = await issueState(env, next);
  return new Request(`https://jevhunt.com/api/auth/callback?code=offline-code&state=${state}`, {
    headers: { Cookie: `jh_oauth_state=${state}` },
  });
}
test("OAuth rejects an unverified email without creating an account", async t => {
  const { env } = await setup(t);
  Object.assign(env, { GOOGLE_CLIENT_ID: "offline", GOOGLE_CLIENT_SECRET: "offline" });
  mockGoogle(t, { sub: "new-sub", email: "new@example.com", email_verified: false });
  const response = await callback({ request: await oauthRequest(env), env });
  assert.match(response.headers.get("location"), /auth_error=unverified_email/);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) n FROM users").get().n, 1);
  assert.doesNotMatch(response.headers.get("set-cookie"), /jh_session=/);
});
test("a matching email cannot rebind an existing Google identity", async t => {
  const { env } = await setup(t);
  Object.assign(env, { GOOGLE_CLIENT_ID: "offline", GOOGLE_CLIENT_SECRET: "offline" });
  mockGoogle(t, { sub: "different-google-sub", email: "owner@example.com", email_verified: true });
  const response = await callback({ request: await oauthRequest(env), env });
  assert.match(response.headers.get("location"), /auth_error=account_conflict/);
  assert.equal(env.DB.db.prepare("SELECT google_sub FROM users WHERE id = 'user'").get().google_sub, "google-sub");
});
test("verified Google login creates a hashed session and normalizes the stored next path", async t => {
  const { env } = await setup(t);
  Object.assign(env, { GOOGLE_CLIENT_ID: "offline", GOOGLE_CLIENT_SECRET: "offline" });
  mockGoogle(t, { sub: "new-google-sub", email: "new@example.com", email_verified: true, name: "New User" });
  const request = await oauthRequest(env, "/\\evil.example");
  const response = await callback({ request, env });
  assert.equal(response.headers.get("location"), "https://jevhunt.com/");
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  const cookie = cookies.find(value => value.startsWith("jh_session="));
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/);
  const session = await getSession(new Request("https://jevhunt.com", { headers: { Cookie: cookie.split(";")[0] } }), env);
  assert.equal(session.user.email, "new@example.com");
  assert.equal((await callback({ request, env })).headers.get("location"), "https://jevhunt.com/?auth_error=expired_state");
});
