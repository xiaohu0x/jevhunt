import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./helpers/d1.mjs";
import { tick } from "../workers/catalog-sync/engine.js";
import { parseRepositoryPage, parseCommitFeed, PublicGitHub, MAX_PUBLIC_RESPONSE_BYTES } from "../workers/catalog-sync/github-public.js";
import { catalogMeta } from "../shared/catalog-data.js";
import { POLICY_VERSION } from "../shared/catalog-policy.js";
import sourceConfig from "../catalog/sources.json" with { type: "json" };

const commit = "a".repeat(40);
const html = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: {
  codeViewLayoutRoute: { repo: { id: 101, ownerLogin: "sample", name: "jev-app", public: true, private: false, isFork: false, isArchived: false, createdAt: "2026-09-20T00:00:00Z" }, refInfo: { currentOid: commit } },
  sidebarAbout: { description: "A Jev application", stargazerCount: 12, repo: { license: { spdxId: "MIT" } } },
  csrf_tokens: { never_store_this: "not-catalog-data" },
} })}</script>`;

function ready(t) {
  const DB = database(); t.after(() => DB.db.close());
  const now = Math.floor(Date.now() / 1000);
  for (const source of [...sourceConfig.sources, ...sourceConfig.githubQueries.map((query, index) => ({ id: `github-search-${index}`, query }))]) {
    DB.db.prepare("INSERT INTO catalog_sources(id,state,next_due_at) VALUES(?,?,?)").run(source.id,
      JSON.stringify(source.query ? { query: source.query, windows: [], lastCompleteAt: now } : {}), now + 86400);
  }
  return { DB, VERIFY_BATCH_SIZE: "1" };
}

test("public GitHub metadata parser excludes unrelated page tokens", () => {
  const result = parseRepositoryPage(html);
  assert.equal(result.repo, "sample/jev-app"); assert.equal(result.commit, commit); assert.equal(result.stars, 12);
  assert.ok(!JSON.stringify(result).includes("not-catalog-data"));
  assert.throws(() => parseRepositoryPage(html.replace('"private":false', '"private":true')));
});
test("a scheduled batch publishes a checked repository directly into D1 without deployment credentials", async t => {
  const env = ready(t);
  env.DB.db.prepare("INSERT INTO catalog_candidates(repo,payload,due_at) VALUES(?,?,0)").run("sample/jev-app", JSON.stringify({ repo: "sample/jev-app", category: "apps", provenance: ["test"] }));
  t.mock.method(globalThis, "fetch", async url => {
    if (url === "https://github.com/sample/jev-app") return new Response(html);
    if (String(url).endsWith("/README.md")) return new Response("Set TYPESAFE_API_KEY to classify tickets with Jev.");
    throw new Error("Unexpected public request");
  });
  const result = await tick(env);
  assert.equal(result.status, "ok"); assert.equal(result.published, 1);
  const row = env.DB.db.prepare("SELECT payload FROM catalog_entries").get();
  const project = JSON.parse(row.payload);
  assert.equal(project.evidence, `https://github.com/sample/jev-app/blob/${commit}/README.md#L1`);
  assert.equal(project.evidenceLevel, "documented");
  const meta = await catalogMeta(env.DB);
  assert.equal(meta.projectCount, 1); assert.equal(meta.mode, "live-d1");
  assert.ok(meta.lastTickAt);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) n FROM catalog_candidates").get().n, 0);
});
test("source failure retains existing public data and schedules a retry", async t => {
  const env = ready(t);
  const project = { repo: "sample/jev-app", name: "jev-app", cat: "apps", relationship: "jev-app", stars: 10 };
  env.DB.db.prepare("INSERT INTO catalog_entries(repo,payload,preview,name,category,relationship,checked_at,next_check_at) VALUES(?,?,?,?,?,?,1,0)")
    .run(project.repo, JSON.stringify(project), JSON.stringify(project), project.name, "apps", "jev-app");
  t.mock.method(globalThis, "fetch", async () => new Response("limited", { status: 429 }));
  const result = await tick(env);
  assert.equal(result.status, "degraded");
  const row = env.DB.db.prepare("SELECT active,next_check_at,failures FROM catalog_entries").get();
  assert.equal(row.active, 1); assert.equal(row.failures, 1); assert.ok(row.next_check_at > Date.now() / 1000);
});
test("an active lease prevents overlapping cron or manual batches", async t => {
  const env = ready(t);
  env.DB.db.prepare("UPDATE catalog_control SET lease_until=?").run(Math.floor(Date.now() / 1000) + 100);
  assert.equal((await tick(env)).status, "busy");
});

test("only the scheduled handler advances the scheduler heartbeat", async t => {
  const env = ready(t);
  await tick(env);
  assert.equal(env.DB.db.prepare("SELECT last_scheduled_at n FROM catalog_control").get().n, 0);
  await tick(env, "scheduled");
  assert.ok(env.DB.db.prepare("SELECT last_scheduled_at n FROM catalog_control").get().n > 0);
});

test("GitHub API backoff prevents further requests until its reset time", async () => {
  let requests = 0;
  const retryAt = Math.floor(Date.now() / 1000) + 3600;
  const client = new PublicGitHub(async () => { requests++; return new Response("limited", { status: 403, headers: { "x-ratelimit-reset": String(retryAt) } }); });
  await assert.rejects(client.api("/search/repositories?q=jev"));
  assert.equal(client.apiRetryAt, retryAt);
  await assert.rejects(client.api("/repos/example/jev"), /rate limit/);
  assert.equal(requests, 1);
  const resumed = new PublicGitHub(async () => { throw new Error("Must not request during cooldown"); }, retryAt);
  await assert.rejects(resumed.api("/repos/example/jev"), /rate limit/);
});

test("changed search queries restart from the first window instead of inheriting a numeric source ID cursor", async t => {
  const env = ready(t), calls = [];
  env.DB.db.prepare("UPDATE catalog_sources SET state=?,last_success_at=42 WHERE id='github-search-0'")
    .run(JSON.stringify({ query: "obsolete search", windows: [{ from: "2026-09-01", to: "2026-09-02", page: 8 }], lastCompleteAt: 42, lastPageAt: 44, partial: true, pagesScanned: 19 }));
  t.mock.method(globalThis, "fetch", async url => {
    calls.push(new URL(url));
    return Response.json({ total_count: 201, incomplete_results: false, items: [] });
  });
  assert.equal((await tick(env)).status, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("page"), "1");
  assert.ok(calls[0].searchParams.get("q").startsWith(sourceConfig.githubQueries[0] + " is:public created:2008-01-01.."));
  const state = JSON.parse(env.DB.db.prepare("SELECT state FROM catalog_sources WHERE id='github-search-0'").get().state);
  assert.equal(state.query, sourceConfig.githubQueries[0]);
  assert.equal(state.windows[0].page, 2);
  assert.equal(state.lastCompleteAt, null);
  assert.equal(state.partial, false);
  assert.equal(state.pagesScanned, 1);
});

test("legacy cursor reset is persisted even if the first new-query attempt is rate limited", async t => {
  const env = ready(t);
  env.DB.db.prepare("UPDATE catalog_sources SET state=?,last_success_at=42 WHERE id='github-search-0'")
    .run(JSON.stringify({ windows: [{ from: "2026-09-01", to: "2026-09-02", page: 9 }], lastCompleteAt: 42 }));
  t.mock.method(globalThis, "fetch", async () => new Response("limited", { status: 429 }));
  assert.equal((await tick(env)).status, "degraded");
  const row = env.DB.db.prepare("SELECT state,status,last_success_at FROM catalog_sources WHERE id='github-search-0'").get();
  const state = JSON.parse(row.state);
  assert.equal(state.query, sourceConfig.githubQueries[0]);
  assert.equal(state.windows[0].from, "2008-01-01");
  assert.equal(state.windows[0].page, 1);
  assert.equal(state.lastCompleteAt, null);
  assert.equal(row.last_success_at, 0);
  assert.equal(row.status, "failed");
});

test("unchanged queries resume their own cursor and a fresh pass clears earlier partial results", async t => {
  const env = ready(t), pages = [];
  env.DB.db.prepare("UPDATE catalog_sources SET next_due_at=0,state=? WHERE id='github-search-0'")
    .run(JSON.stringify({ query: sourceConfig.githubQueries[0], windows: [{ from: "2026-09-01", to: "2026-09-02", page: 2 }], pagesScanned: 1, partial: true }));
  t.mock.method(globalThis, "fetch", async url => { pages.push(new URL(url).searchParams.get("page")); return Response.json({ total_count: 200, incomplete_results: false, items: [] }); });
  await tick(env);
  let state = JSON.parse(env.DB.db.prepare("SELECT state FROM catalog_sources WHERE id='github-search-0'").get().state);
  assert.equal(state.windows.length, 0); assert.equal(state.partial, true); assert.ok(state.lastCompleteAt);
  env.DB.db.prepare("UPDATE catalog_sources SET next_due_at=0 WHERE id='github-search-0'").run();
  await tick(env);
  state = JSON.parse(env.DB.db.prepare("SELECT state FROM catalog_sources WHERE id='github-search-0'").get().state);
  assert.deepEqual(pages, ["2", "1"]); assert.equal(state.partial, false); assert.equal(state.pagesScanned, 1);
});

const feed = (sha = commit, updated = "2026-09-28T03:04:05Z") => `<feed><updated>2026-09-29T00:00:00Z</updated><entry><id>tag:github.com,2008:Grit::Commit/${sha}</id><updated>${updated}</updated></entry></feed>`;
const datedPage = html.replace('"createdAt":"2026-09-20T00:00:00Z"', '"createdAt":"2026-09-20T00:00:00Z","pushedAt":"2026-09-27T02:03:04Z"');

test("repository activity uses upstream page or matching commit dates, never the feed timestamp", async () => {
  assert.equal(parseRepositoryPage(datedPage).pushed, "2026-09-27");
  assert.equal(parseCommitFeed(feed(), commit).pushed, "2026-09-28");
  assert.equal(parseCommitFeed(feed("b".repeat(40)), commit), null);
  assert.equal(parseCommitFeed(feed(commit, "invalid"), commit).pushed, undefined);
  const client = new PublicGitHub(async url => new Response(String(url).endsWith(".atom") ? feed() : html));
  const metadata = await client.metadata({ repo: "sample/jev-app" }, { pushed: "2020-01-01" });
  assert.equal(metadata.pushed, "2026-09-28"); assert.equal(metadata.commit, commit);
  const fallback = new PublicGitHub(async url => new Response(String(url).endsWith(".atom") ? feed() : "changed markup"));
  assert.equal((await fallback.metadata({ repo: "sample/jev-app" }, { pushed: "2020-01-01" })).pushed, "2026-09-28");
  const unavailable = new PublicGitHub(async url => String(url).endsWith(".atom") ? new Response("down", { status: 503 }) : new Response(html));
  const retained = await unavailable.metadata({ repo: "sample/jev-app" }, null);
  assert.equal(retained.pushed, undefined); assert.equal(retained.commit, commit); assert.ok(retained.activityWarning);
});

test("repository HTML can exceed the old 1.5 MB limit but every response keeps a 6 MB cap", async () => {
  const client = new PublicGitHub(async () => new Response(datedPage + " ".repeat(1_600_000)));
  assert.equal((await client.metadata({ repo: "sample/jev-app" }, null)).repo, "sample/jev-app");
  const large = new PublicGitHub(async () => new Response("x".repeat(MAX_PUBLIC_RESPONSE_BYTES + 1)));
  await assert.rejects(large.request("https://github.com/sample/large", { raw: true, limit: 100_000_000 }), /Response too large/);
});

function insertKnown(DB, repo, id, extra = {}) {
  const p = { id, repo, name: repo.split("/")[1], desc: "Known project", cat: "games", relationship: "jev-app", stars: 10,
    added: "2026-09-10", pushed: "2026-09-11", provenance: ["historical-source"], commit, evidencePolicy: POLICY_VERSION,
    evidenceDetail: { level: "documented", relationship: "jev-app", url: `https://github.com/${repo}/blob/${commit}/README.md` }, ...extra };
  DB.db.prepare("INSERT INTO catalog_entries(repo,github_id,payload,preview,name,category,relationship,stars,checked_at,next_check_at) VALUES(?,?,?,?,?,?,?,?,1,0)")
    .run(repo, id, JSON.stringify(p), JSON.stringify(p), p.name, p.cat, p.relationship, p.stars);
  return p;
}

test("stable GitHub IDs merge renamed repositories and existing canonical entries without losing provenance", async t => {
  const env = ready(t);
  insertKnown(env.DB, "previous/team-project", 101);
  insertKnown(env.DB, "sample/jev-app", null, { provenance: ["new-search"], added: "2026-09-20" });
  env.DB.db.prepare("INSERT INTO catalog_aliases VALUES('oldest/project','previous/team-project',1)").run();
  env.DB.db.prepare("INSERT INTO catalog_candidates(repo,payload,due_at) VALUES(?,?,0)")
    .run("sample/jev-app", JSON.stringify({ repo: "sample/jev-app", provenance: ["github-search"], pushed: "2026-09-12" }));
  t.mock.method(globalThis, "fetch", async () => new Response(datedPage));
  const result = await tick(env);
  assert.equal(result.status, "ok"); assert.equal(result.published, 1);
  const rows = env.DB.db.prepare("SELECT repo,github_id,payload FROM catalog_entries").all();
  assert.equal(rows.length, 1); assert.equal(rows[0].repo, "sample/jev-app"); assert.equal(rows[0].github_id, 101);
  const p = JSON.parse(rows[0].payload);
  assert.equal(p.added, "2026-09-10"); assert.equal(p.pushed, "2026-09-27"); assert.equal(p.cat, "games");
  assert.deepEqual(p.provenance.sort(), ["github-search", "historical-source", "new-search"]);
  const aliases = env.DB.db.prepare("SELECT old_repo,new_repo FROM catalog_aliases ORDER BY old_repo").all();
  assert.deepEqual(aliases.map(row => [row.old_repo, row.new_repo]), [["oldest/project", "sample/jev-app"], ["previous/team-project", "sample/jev-app"]]);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM catalog_candidates").get().n, 0);
  env.DB.db.prepare("INSERT INTO catalog_withdrawals VALUES('oldest/project',1,'editor')").run();
  assert.equal(await catalogMeta(env.DB), null, "withdrawing an older alias still hides the merged canonical listing");
});

test("withdrawn stable identities and their aliases cannot be republished under a new repository name", async t => {
  for (const withdrawnRepo of ["previous/team-project", "oldest/project"]) {
    const env = ready(t);
    insertKnown(env.DB, "previous/team-project", 101);
    env.DB.db.prepare("INSERT INTO catalog_aliases VALUES('oldest/project','previous/team-project',1)").run();
    env.DB.db.prepare("INSERT INTO catalog_withdrawals VALUES(?,1,'editor')").run(withdrawnRepo);
    env.DB.db.prepare("INSERT INTO catalog_candidates(repo,payload,due_at) VALUES(?,?,0)")
      .run("sample/jev-app", JSON.stringify({ repo: "sample/jev-app" }));
    t.mock.method(globalThis, "fetch", async () => new Response(datedPage));
    const result = await tick(env);
    assert.equal(result.status, "ok"); assert.equal(result.published, 0);
    assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM catalog_entries WHERE repo='sample/jev-app'").get().n, 0);
    assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM catalog_withdrawals WHERE repo=?").get(withdrawnRepo).n, 1);
    assert.equal(env.DB.db.prepare("SELECT github_id FROM catalog_entries WHERE repo='previous/team-project'").get().github_id, 101);
  }
});
