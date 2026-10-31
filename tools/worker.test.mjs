import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./helpers/d1.mjs";
import { tick, catalogSources } from "../workers/catalog-sync/engine.js";
import { parseRepositoryPage, parseCommitFeed, PublicGitHub, MAX_PUBLIC_RESPONSE_BYTES } from "../workers/catalog-sync/github-public.js";
import { catalogMeta } from "../shared/catalog-data.js";
import { POLICY_VERSION } from "../shared/catalog-policy.js";
import { LAUNCH_MIN_STARS } from "../shared/catalog-launches.js";
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
  for (const source of catalogSources()) {
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

test("GitHub API backoff waits for each quota's reset without blocking the other quota", async () => {
  let requests = 0;
  const retryAt = Math.floor(Date.now() / 1000) + 3600;
  const client = new PublicGitHub(async url => { requests++; return String(url).includes("/search/") ? new Response("limited", { status: 403, headers: { "x-ratelimit-reset": String(retryAt) } }) : Response.json({ ok: true }); });
  await assert.rejects(client.api("/search/repositories?q=jev"));
  assert.equal(client.retryAt.search, retryAt);
  await assert.rejects(client.api("/search/repositories?q=typesafe"), /rate limit/);
  assert.equal(requests, 1);
  assert.deepEqual(await client.api("/repos/example/jev"), { ok: true });
  assert.equal(client.retryAt.core, 0);
  const resumed = new PublicGitHub(async () => { throw new Error("Must not request during cooldown"); }, { core: retryAt });
  await assert.rejects(resumed.api("/repos/example/jev"), error => error.rateLimited && error.retryAt === retryAt);
});

test("a 403 for one repository does not stop the API unless GitHub says the quota is gone", async () => {
  const now = Math.floor(Date.now() / 1000);
  const blocked = new PublicGitHub(async () => new Response("blocked", { status: 403, headers: { "x-ratelimit-remaining": "41", "x-ratelimit-reset": String(now + 3000) } }));
  await assert.rejects(blocked.api("/repos/example/blocked"), error => !error.rateLimited && error.status === 403);
  assert.equal(blocked.retryAt.core, 0);
  const secondary = new PublicGitHub(async () => new Response("slow down", { status: 403, headers: { "x-ratelimit-remaining": "41", "retry-after": "120" } }));
  await assert.rejects(secondary.api("/repos/example/jev"), error => error.rateLimited);
  assert.ok(secondary.retryAt.core >= now + 120 && secondary.retryAt.core < now + 900);
  const unexplained = new PublicGitHub(async () => new Response("limited", { status: 429 }));
  await assert.rejects(unexplained.api("/search/repositories?q=jev"), error => error.rateLimited);
  assert.ok(unexplained.retryAt.search >= now + 900);
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

const epoch = () => Math.floor(Date.now() / 1000);
const dayAgo = days => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const README = "Set TYPESAFE_API_KEY to classify tickets with Jev.";
const pageIds = new Map();
const pageOf = repo => {
  const [owner, name] = repo.split("/"), id = pageIds.get(repo) ?? pageIds.set(repo, 1000 + pageIds.size).get(repo);
  return datedPage.replace('"ownerLogin":"sample"', `"ownerLogin":"${owner}"`).replace('"name":"jev-app"', `"name":"${name}"`).replace('"id":101', `"id":${id}`);
};
const queue = (DB, repo, payload = {}, { priority = 0, due_at = 0, attempts = 0 } = {}) => DB.db.prepare("INSERT INTO catalog_candidates(repo,payload,priority,due_at,attempts) VALUES(?,?,?,?,?)")
  .run(repo, JSON.stringify({ repo, provenance: ["test"], ...payload }), priority, due_at, attempts);
const candidate = (DB, repo) => DB.db.prepare("SELECT * FROM catalog_candidates WHERE repo=?").get(repo);
const entryRepos = DB => DB.db.prepare("SELECT repo FROM catalog_entries ORDER BY repo").all().map(row => row.repo);
const coolApi = (DB, field, until) => DB.db.prepare(`UPDATE catalog_control SET meta=json_set(meta,'$.${field}',?)`).run(until);
const sourceState = (DB, id) => JSON.parse(DB.db.prepare("SELECT state FROM catalog_sources WHERE id=?").get(id).state);
const makeDue = (DB, id) => DB.db.prepare("UPDATE catalog_sources SET next_due_at=0 WHERE id=?").run(id);

/** A stand-in for public GitHub: routes match by substring, then repository pages and evidence READMEs answer by default. */
function publicGitHub(t, routes = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => {
    const target = String(url); calls.push(target);
    for (const [pattern, reply] of Object.entries(routes)) if (target.includes(pattern)) return reply(target);
    if (/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(target)) return new Response(pageOf(new URL(target).pathname.slice(1)));
    if (target.startsWith("https://raw.githubusercontent.com/")) return target.endsWith("/README.md") ? new Response(README) : new Response("", { status: 404 });
    throw new Error("Unexpected public request: " + target);
  });
  return calls;
}
const searchResult = (...repos) => () => Response.json({ total_count: repos.length, incomplete_results: false,
  items: repos.map(repo => ({ full_name: repo, description: "A Jev application", language: "Python", stargazers_count: 3, pushed_at: `${dayAgo(0)}T00:00:00Z`, created_at: `${dayAgo(0)}T00:00:00Z` })) });
const limited = () => new Response("limited", { status: 429 });

test("a failed discovery source records its failure and the verification queue still gets its turn", async t => {
  const env = ready(t), now = epoch();
  makeDue(env.DB, "github-fresh-0");
  queue(env.DB, "sample/jev-app");
  publicGitHub(t, { "/search/repositories": limited });
  const result = await tick(env);
  assert.equal(result.status, "degraded"); assert.equal(result.published, 1);
  assert.deepEqual(entryRepos(env.DB), ["sample/jev-app"]);
  const source = env.DB.db.prepare("SELECT status,error,next_due_at FROM catalog_sources WHERE id='github-fresh-0'").get();
  assert.equal(source.status, "failed"); assert.ok(source.next_due_at > now);
});

test("a repository found by search can be published by the same tick", async t => {
  const env = ready(t);
  makeDue(env.DB, "github-fresh-0");
  publicGitHub(t, { "/search/repositories": searchResult("Fresh/jev-new") });
  const result = await tick(env);
  assert.equal(result.status, "ok"); assert.equal(result.published, 1);
  assert.match(result.message, /github-fresh-0: 1 candidates/);
  assert.match(result.message, /Checked 1/);
  assert.deepEqual(entryRepos(env.DB), ["fresh/jev-new"]);
  const project = JSON.parse(env.DB.db.prepare("SELECT payload FROM catalog_entries").get().payload);
  assert.ok(project.provenance.includes("github-search"));
});

test("running out of the core API quota does not stop search discovery", async t => {
  const env = ready(t);
  coolApi(env.DB, "githubApiRetryAt", epoch() + 3600);
  makeDue(env.DB, "github-fresh-0");
  const calls = publicGitHub(t, { "/search/repositories": searchResult("fresh/jev-new") });
  assert.equal((await tick(env)).status, "ok");
  assert.equal(calls.filter(url => url.includes("/search/")).length, 1);
  assert.deepEqual(entryRepos(env.DB), ["fresh/jev-new"]);
});

test("search sources wait out a search cooldown without being marked failed and retry right after it", async t => {
  const env = ready(t), now = epoch();
  coolApi(env.DB, "githubSearchRetryAt", now + 45);
  makeDue(env.DB, "github-fresh-0");
  queue(env.DB, "sample/jev-app");
  const calls = publicGitHub(t);
  const result = await tick(env);
  assert.equal(result.status, "ok"); assert.equal(result.published, 1);
  assert.ok(!calls.some(url => url.includes("/search/")));
  assert.equal(env.DB.db.prepare("SELECT status FROM catalog_sources WHERE id='github-fresh-0'").get().status, "pending");

  coolApi(env.DB, "githubSearchRetryAt", 0);
  const reset = epoch() + 40;
  t.mock.restoreAll();
  publicGitHub(t, { "/search/repositories": () => new Response("limited", { status: 403, headers: { "x-ratelimit-reset": String(reset), "x-ratelimit-remaining": "0" } }) });
  assert.equal((await tick(env)).status, "degraded");
  const source = env.DB.db.prepare("SELECT status,next_due_at FROM catalog_sources WHERE id='github-fresh-0'").get();
  assert.equal(source.status, "failed");
  assert.ok(source.next_due_at >= reset && source.next_due_at <= epoch() + 120, "a per-minute search limit must not cost an hour");
  const meta = JSON.parse(env.DB.db.prepare("SELECT meta FROM catalog_control").get().meta);
  assert.equal(meta.githubSearchRetryAt, reset);
  assert.ok(!(meta.githubApiRetryAt > epoch()), "the core quota is unaffected");
});

test("fresh scans start from the last finished pass, newest dates first, so an outage leaves no gap", async t => {
  const env = ready(t), ranges = [];
  env.DB.db.prepare("DELETE FROM catalog_sources WHERE id='github-fresh-0'").run();
  let total = 1500;
  const historical = sourceState(env.DB, "github-search-0");
  t.mock.method(globalThis, "fetch", async url => {
    ranges.push(new URL(url).searchParams.get("q").match(/created:(\S+)/)[1]);
    return Response.json({ total_count: total, incomplete_results: false, items: [] });
  });
  await tick(env);
  const today = dayAgo(0), start = dayAgo(35);
  assert.deepEqual(ranges, [`${start}..${today}`], "the first pass reaches back past the launch board's 30 days");
  let state = sourceState(env.DB, "github-fresh-0");
  assert.equal(state.windows.length, 2);
  assert.equal(state.windows[0].to, today, "the newest half is scanned first");
  assert.equal(state.windows[1].from, start);
  assert.equal(state.coveredTo, null);

  total = 10;
  makeDue(env.DB, "github-fresh-0"); await tick(env);
  assert.equal(sourceState(env.DB, "github-fresh-0").coveredTo, null, "a pass only counts once every window is done");
  makeDue(env.DB, "github-fresh-0"); await tick(env);
  state = sourceState(env.DB, "github-fresh-0");
  assert.equal(state.coveredTo, today); assert.equal(state.windows.length, 0); assert.ok(state.lastCompleteAt);
  const row = env.DB.db.prepare("SELECT next_due_at FROM catalog_sources WHERE id='github-fresh-0'").get();
  assert.ok(row.next_due_at > epoch() + 3000 && row.next_due_at <= epoch() + 3600, "fresh scans repeat hourly");

  ranges.length = 0;
  env.DB.db.prepare("UPDATE catalog_sources SET next_due_at=0,state=? WHERE id='github-fresh-0'").run(JSON.stringify({ ...state, coveredTo: dayAgo(5) }));
  await tick(env);
  assert.deepEqual(ranges, [`${dayAgo(6)}..${today}`], "after five days down the scan picks up where it stopped");
  assert.deepEqual(sourceState(env.DB, "github-search-0"), historical, "the historical cursor is untouched");
});

test("a changed query restarts its fresh scan instead of trusting the old coverage date", async t => {
  const env = ready(t), ranges = [];
  env.DB.db.prepare("UPDATE catalog_sources SET next_due_at=0,state=? WHERE id='github-fresh-0'").run(JSON.stringify({ query: "obsolete", coveredTo: dayAgo(1), windows: [] }));
  t.mock.method(globalThis, "fetch", async url => { ranges.push(new URL(url).searchParams.get("q").match(/created:(\S+)/)[1]); return Response.json({ total_count: 0, incomplete_results: false, items: [] }); });
  await tick(env);
  assert.deepEqual(ranges, [`${dayAgo(35)}..${dayAgo(0)}`]);
});

test("the historical scan slows down while the verification queue is long", async t => {
  const env = ready(t);
  env.DB.db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<5001)
    INSERT INTO catalog_candidates(repo,payload,priority,due_at) SELECT 'bulk/repo-'||i, json_object('repo','bulk/repo-'||i,'created','2020-01-01'), 0, 1 FROM n`);
  makeDue(env.DB, "github-search-0");
  publicGitHub(t, { "/search/repositories": () => Response.json({ total_count: 300, incomplete_results: false, items: [] }) });
  await tick(env);
  const next = () => env.DB.db.prepare("SELECT next_due_at FROM catalog_sources WHERE id='github-search-0'").get().next_due_at - epoch();
  assert.ok(next() > 3600, "a long queue gets time to drain");
  env.DB.db.exec("DELETE FROM catalog_candidates");
  makeDue(env.DB, "github-search-0");
  await tick(env);
  assert.ok(next() > 600 && next() <= 1200, "a short queue keeps the normal pace");
});

test("curated and newly created repositories are verified ahead of an older backlog", async t => {
  const env = ready(t);
  queue(env.DB, "old/backlog", { created: "2021-01-01" }, { due_at: 1 });
  queue(env.DB, "old/backlog-two", { created: "2022-01-01" }, { due_at: 2 });
  queue(env.DB, "fresh/older", { created: dayAgo(20) }, { due_at: 100 });
  queue(env.DB, "fresh/newest", { created: dayAgo(1) }, { due_at: 200 });
  queue(env.DB, "curated/approved", {}, { due_at: 300 });
  queue(env.DB, "fresh/rejected-recently", { created: dayAgo(0) }, { due_at: epoch() + 86400 });
  queue(env.DB, "known/updated", { created: dayAgo(0) }, { priority: 1, due_at: 1 });
  publicGitHub(t);
  const order = [];
  for (let i = 0; i < 6; i++) {
    const before = new Set(entryRepos(env.DB));
    await tick(env);
    order.push(...entryRepos(env.DB).filter(repo => !before.has(repo)));
  }
  assert.deepEqual(order, ["curated/approved", "fresh/newest", "fresh/older", "old/backlog", "old/backlog-two", "known/updated"]);
  assert.ok(candidate(env.DB, "fresh/rejected-recently"), "not due yet");
});

test("new repositories with enough stars for the launch board are verified ahead of newer unstarred ones", async t => {
  const env = ready(t);
  queue(env.DB, "fresh/unstarred", { created: dayAgo(0), stars: 0 }, { due_at: 1 });
  queue(env.DB, "fresh/just-under", { created: dayAgo(5), stars: LAUNCH_MIN_STARS - 1 }, { due_at: 2 });
  queue(env.DB, "old/starred", { created: "2021-01-01", stars: 900 }, { due_at: 3 });
  queue(env.DB, "fresh/at-floor", { created: dayAgo(6), stars: LAUNCH_MIN_STARS }, { due_at: 500 });
  queue(env.DB, "fresh/starred", { created: dayAgo(4), stars: 58 }, { due_at: 600 });
  queue(env.DB, "curated/approved", {}, { due_at: 700 });
  queue(env.DB, "fresh/starred-rejected-recently", { created: dayAgo(1), stars: 40 }, { due_at: epoch() + 86400 });
  publicGitHub(t);
  const order = [];
  for (let i = 0; i < 6; i++) {
    const before = new Set(entryRepos(env.DB));
    await tick(env);
    order.push(...entryRepos(env.DB).filter(repo => !before.has(repo)));
  }
  assert.deepEqual(order, ["curated/approved", "fresh/starred", "fresh/at-floor", "fresh/unstarred", "fresh/just-under", "old/starred"]);
  assert.ok(candidate(env.DB, "fresh/starred-rejected-recently"), "not due yet");
});

test("the star scan covers the launch board's whole window on every pass, ahead of the other scans", async t => {
  const env = ready(t), queries = [];
  for (const id of ["github-notable-0", "github-fresh-0", "github-search-0"]) env.DB.db.prepare("DELETE FROM catalog_sources WHERE id=?").run(id);
  t.mock.method(globalThis, "fetch", async url => {
    queries.push(new URL(url).searchParams.get("q"));
    return Response.json({ total_count: 0, incomplete_results: false, items: [] });
  });
  await tick(env);
  const window = `created:${dayAgo(35)}..${dayAgo(0)}`;
  assert.equal(queries.length, 1);
  assert.ok(queries[0].includes(`stars:>=${LAUNCH_MIN_STARS}`), queries[0]);
  assert.ok(queries[0].includes(window), queries[0]);
  const row = env.DB.db.prepare("SELECT next_due_at FROM catalog_sources WHERE id='github-notable-0'").get();
  assert.ok(row.next_due_at > epoch() + 3000 && row.next_due_at <= epoch() + 3600, "star scans repeat hourly");

  makeDue(env.DB, "github-notable-0"); await tick(env);
  assert.ok(queries[1].includes(window), "a project can reach the floor at any age, so the window never narrows");
});

test("a listed project that has earned enough stars for the launch board is checked again straight away", async t => {
  const env = ready(t), now = epoch();
  env.DB.db.prepare("DELETE FROM catalog_sources WHERE id='github-notable-0'").run();
  for (const repo of ["known/rising", "known/already-there", "known/just-checked", "known/backlogged"]) insertKnown(env.DB, repo, null);
  const entry = env.DB.db.prepare(`UPDATE catalog_entries SET stars=?,checked_at=?,next_check_at=${now + 86400},payload=json_set(payload,'$.pushed',?) WHERE repo=?`);
  entry.run(1, now - 7200, dayAgo(0), "known/rising");
  entry.run(20, now - 7200, dayAgo(0), "known/already-there");
  entry.run(1, now - 60, dayAgo(0), "known/just-checked");
  entry.run(1, now - 7200, dayAgo(0), "known/backlogged");
  queue(env.DB, "known/backlogged", { created: dayAgo(3), stars: 1 }, { priority: 1, due_at: 1 });
  queue(env.DB, "fresh/unstarred", { created: dayAgo(0), stars: 0 }, { due_at: 1 });
  const item = (repo, stars, age = 3) => ({ full_name: repo, description: "A Jev application", language: "Python", stargazers_count: stars, pushed_at: `${dayAgo(3)}T00:00:00Z`, created_at: `${dayAgo(age)}T00:00:00Z` });
  publicGitHub(t, { "/search/repositories": () => Response.json({ total_count: 4, incomplete_results: false,
    items: [item("known/rising", 12, 2), item("known/already-there", 20), item("known/just-checked", 12), item("known/backlogged", 12)] }) });
  const before = env.DB.db.prepare("SELECT checked_at FROM catalog_entries WHERE repo='known/rising'").get().checked_at;
  await tick(env);
  assert.equal(candidate(env.DB, "known/rising"), undefined, "verified and published in the tick that found it");
  assert.ok(env.DB.db.prepare("SELECT checked_at FROM catalog_entries WHERE repo='known/rising'").get().checked_at > before);
  assert.equal(env.DB.db.prepare("SELECT stars FROM catalog_entries WHERE repo='known/rising'").get().stars, 12);
  assert.equal(candidate(env.DB, "known/already-there"), undefined, "no new stars to publish");
  assert.equal(candidate(env.DB, "known/just-checked"), undefined, "checked within the hour");
  assert.equal(candidate(env.DB, "known/backlogged").priority, 0, "one already waiting in the slow lane moves up");
  assert.ok(candidate(env.DB, "fresh/unstarred"));
});

test("a known project still gets its re-check while a candidate backlog exists", async t => {
  const env = { ...ready(t), VERIFY_BATCH_SIZE: "3" };
  insertKnown(env.DB, "known/project", 900);
  for (const index of [1, 2, 3, 4]) queue(env.DB, `old/repo-${index}`, { created: "2021-01-01" }, { due_at: index });
  publicGitHub(t);
  const result = await tick(env);
  assert.equal(result.checked, 3);
  assert.deepEqual(entryRepos(env.DB), ["known/project", "old/repo-1", "old/repo-2"]);
  assert.ok(env.DB.db.prepare("SELECT next_check_at n FROM catalog_entries WHERE repo='known/project'").get().n > epoch());
});

test("source evidence comes from the public file list without using the metered API", async t => {
  const env = ready(t);
  coolApi(env.DB, "githubApiRetryAt", epoch() + 3600);
  queue(env.DB, "sample/jev-app");
  const calls = publicGitHub(t, {
    "/tree-list/": () => Response.json({ paths: ["README.md", "tests/fixtures/jev.ts", "src/jev.ts"] }),
    "/README.md": () => new Response("An extensible application."),
    "/src/jev.ts": () => new Response('const model = "jev-latest"; client.systemOne({ model });'),
  });
  const result = await tick(env);
  assert.equal(result.status, "ok"); assert.equal(result.published, 1);
  assert.equal(JSON.parse(env.DB.db.prepare("SELECT payload FROM catalog_entries").get().payload).evidenceLevel, "code-reference");
  assert.ok(!calls.some(url => url.includes("api.github.com")));
  assert.ok(calls.some(url => url === `https://github.com/sample/jev-app/tree-list/${commit}`), "the listing is pinned to the verified commit");
  assert.ok(!calls.some(url => url.includes("fixtures")));
});

test("a repository with no source evidence in its file list is rejected without using the API", async t => {
  const env = ready(t);
  queue(env.DB, "sample/jev-app");
  const calls = publicGitHub(t, { "/tree-list/": () => Response.json({ paths: ["README.md", "index.js"] }), "/README.md": () => new Response("Nothing to see.") });
  const result = await tick(env);
  assert.equal(result.status, "ok"); assert.equal(result.checked, 1); assert.equal(result.published, 0);
  assert.ok(!calls.some(url => url.includes("api.github.com")));
  const row = candidate(env.DB, "sample/jev-app");
  assert.equal(row.last_error, "No qualifying first-party usage evidence"); assert.ok(row.due_at > epoch() + 6 * 86400);
});

test("the public file list falls back to the API only when it is unavailable, and an oversized list means no source files", async () => {
  const listing = reply => new PublicGitHub(async () => reply()).filePaths("sample/jev-app", commit);
  assert.deepEqual(await listing(() => Response.json({ paths: ["a.js"] })), ["a.js"]);
  assert.equal(await listing(() => new Response("gone", { status: 404 })), null);
  assert.equal(await listing(() => new Response("broken", { status: 500 })), null);
  assert.equal(await listing(() => new Response("limited", { status: 429 })), null);
  assert.equal(await listing(() => new Response("<html>changed markup</html>")), null);
  assert.equal(await listing(() => Response.json({ tree: [] })), null);
  assert.deepEqual(await listing(() => new Response("x".repeat(MAX_PUBLIC_RESPONSE_BYTES + 1))), []);
  const spent = new PublicGitHub(async () => Response.json({ paths: [] })); spent.requests = 35;
  await assert.rejects(spent.filePaths("sample/jev-app", commit), error => error.budget);
});

test("a repository waiting on the cooling API costs no failure and does not hold up the queue", async t => {
  const env = { ...ready(t), VERIFY_BATCH_SIZE: "3" }, until = epoch() + 3600;
  coolApi(env.DB, "githubApiRetryAt", until);
  queue(env.DB, "needs/api", { created: dayAgo(0) }, { attempts: 2 });
  queue(env.DB, "other/ready", { created: dayAgo(1) });
  const needsApi = {
    "/needs/api/tree-list/": () => new Response("unavailable", { status: 503 }),
    "raw.githubusercontent.com/needs/api/": url => url.endsWith("/README.md") ? new Response("An extensible application.") : new Response("", { status: 404 }),
  };
  let calls = publicGitHub(t, needsApi);
  const result = await tick(env);
  assert.equal(result.status, "ok"); assert.equal(result.published, 1);
  assert.match(result.message, /waiting for API quota: 1/);
  assert.ok(!calls.some(url => url.includes("api.github.com")));
  assert.deepEqual(entryRepos(env.DB), ["other/ready"]);
  let row = candidate(env.DB, "needs/api");
  assert.equal(row.priority, 2); assert.equal(row.attempts, 2); assert.equal(row.due_at, until); assert.match(row.last_error, /rate limit/);

  t.mock.restoreAll(); calls = publicGitHub(t, needsApi);
  env.DB.db.prepare("UPDATE catalog_candidates SET due_at=0 WHERE repo='needs/api'").run();
  await tick(env);
  assert.ok(!calls.some(url => url.includes("needs/api")), "no pointless fetches while the quota is gone");

  coolApi(env.DB, "githubApiRetryAt", 0);
  queue(env.DB, "backlog/repo", { created: "2021-01-01" }, { due_at: 1 });
  t.mock.restoreAll(); calls = publicGitHub(t, {
    "/src/jev.ts": () => new Response('const model = "jev-latest"; client.systemOne({ model });'),
    "/repos/needs/api/git/trees/": () => Response.json({ tree: [{ type: "blob", path: "src/jev.ts", size: 200 }] }),
    ...needsApi,
  });
  const resumed = await tick(env);
  assert.equal(resumed.status, "ok");
  assert.equal(calls.filter(url => url.includes("/git/trees/")).length, 1);
  assert.deepEqual(entryRepos(env.DB), ["backlog/repo", "needs/api", "other/ready"]);
  assert.equal(candidate(env.DB, "needs/api"), undefined);
});

test("a rejected repository that waited on the API goes back to the normal queue", async t => {
  const env = ready(t);
  queue(env.DB, "needs/api", { created: dayAgo(0) }, { priority: 2 });
  publicGitHub(t, {
    "/tree-list/": () => Response.json({ paths: ["index.js"] }),
    "/README.md": () => new Response("An extensible application."),
  });
  assert.equal((await tick(env)).status, "ok");
  const row = candidate(env.DB, "needs/api");
  assert.equal(row.priority, 0); assert.equal(row.last_error, "No qualifying first-party usage evidence");
});

test("a listed project keeps its public freshness and failure count while the API cools down", async t => {
  const env = ready(t), until = epoch() + 3600;
  coolApi(env.DB, "githubApiRetryAt", until);
  insertKnown(env.DB, "sample/jev-app", 101, { commit: "b".repeat(40), freshness: "current" });
  publicGitHub(t, { "/tree-list/": () => new Response("unavailable", { status: 503 }), "/README.md": () => new Response("An extensible application.") });
  const result = await tick(env);
  assert.equal(result.status, "ok"); assert.equal(result.changed, 0);
  const row = env.DB.db.prepare("SELECT active,failures,next_check_at,payload FROM catalog_entries").get();
  assert.equal(row.active, 1); assert.equal(row.failures, 0); assert.equal(row.next_check_at, until);
  assert.equal(JSON.parse(row.payload).freshness, "current");
});

test("an empty repository is rejected for now instead of retried as a failure", async t => {
  const env = ready(t);
  queue(env.DB, "empty/repo");
  const calls = publicGitHub(t, {
    "https://github.com/empty/repo": url => { if (url.endsWith(".atom")) throw new Error("must not read the feed of an empty repository"); return new Response("<html><h3>This repository is empty.</h3></html>"); },
  });
  const result = await tick(env);
  assert.equal(result.status, "ok"); assert.equal(result.checked, 1); assert.equal(result.published, 0);
  const row = candidate(env.DB, "empty/repo");
  assert.equal(row.attempts, 1); assert.equal(row.last_error, "Repository has no commits yet"); assert.ok(row.due_at > epoch() + 6 * 86400);
  assert.equal(calls.length, 1);
});

test("a README quoting the empty-repository message does not hide a real repository", async t => {
  const env = ready(t);
  queue(env.DB, "sample/jev-app");
  publicGitHub(t, { "https://github.com/sample/jev-app": () => new Response(pageOf("sample/jev-app") + "<p>This repository is empty.</p>") });
  assert.equal((await tick(env)).published, 1);
});

test("candidate retries back off with their own attempts instead of every thirty minutes forever", async t => {
  const env = ready(t);
  queue(env.DB, "gone/repo", { created: "2021-01-01" }, { attempts: 180 });
  publicGitHub(t, { "https://github.com/gone/repo": () => new Response("gone", { status: 404 }) });
  assert.equal((await tick(env)).status, "degraded");
  const row = candidate(env.DB, "gone/repo");
  assert.equal(row.attempts, 181); assert.ok(row.due_at >= epoch() + 28000, "retries settle at the longest backoff");
  const first = { ...ready(t) };
  queue(first.DB, "new/gone");
  t.mock.restoreAll(); publicGitHub(t, { "https://github.com/new/gone": () => new Response("gone", { status: 404 }) });
  await tick(first);
  assert.ok(candidate(first.DB, "new/gone").due_at <= epoch() + 1800, "a first failure retries soon");
});

test("a listed project is not deactivated on its first unavailable check because of an old candidate attempt count", async t => {
  const env = ready(t);
  insertKnown(env.DB, "sample/jev-app", 101);
  queue(env.DB, "sample/jev-app", { created: "2021-01-01" }, { priority: 1, attempts: 9 });
  publicGitHub(t, { "https://github.com/sample/jev-app": () => new Response("gone", { status: 404 }) });
  await tick(env);
  assert.equal(env.DB.db.prepare("SELECT active FROM catalog_entries").get().active, 1);
});

test("running out of the per-tick request budget leaves the remaining repositories untouched", async t => {
  const env = { ...ready(t), VERIFY_BATCH_SIZE: "5" };
  for (const index of [1, 2, 3, 4]) queue(env.DB, `slow/repo-${index}`, { created: dayAgo(index) });
  publicGitHub(t, { "/tree-list/": () => new Response("", { status: 404 }), "/git/trees/": () => new Response("", { status: 404 }), "raw.githubusercontent.com": () => new Response("", { status: 404 }) });
  const result = await tick(env);
  assert.equal(result.status, "ok");
  assert.equal(candidate(env.DB, "slow/repo-1").attempts, 1);
  assert.equal(candidate(env.DB, "slow/repo-2").attempts, 1);
  for (const index of [3, 4]) {
    const row = candidate(env.DB, `slow/repo-${index}`);
    assert.equal(row.attempts, 0); assert.equal(row.due_at, 0); assert.equal(row.last_error, null);
  }
});

test("the catalog revision moves at most every fifteen minutes and a pending change is not lost", async t => {
  const env = ready(t);
  const control = () => { const row = env.DB.db.prepare("SELECT revision,published_at,meta FROM catalog_control").get(); return { ...row, pending: JSON.parse(row.meta).revisionPending }; };
  const initial = control().revision;
  queue(env.DB, "first/repo");
  publicGitHub(t);
  await tick(env);
  const first = control();
  assert.notEqual(first.revision, initial, "a change after a quiet period publishes straight away");
  assert.ok(first.published_at > 0); assert.ok(!first.pending);

  queue(env.DB, "second/repo");
  await tick(env);
  assert.equal(control().revision, first.revision, "a change inside the window waits");
  assert.ok(control().pending);
  assert.deepEqual(entryRepos(env.DB), ["first/repo", "second/repo"], "the row itself is written straight away");

  await tick(env);
  assert.equal(control().revision, first.revision);
  env.DB.db.prepare("UPDATE catalog_control SET published_at=published_at-900").run();
  await tick(env);
  assert.notEqual(control().revision, first.revision, "the pending change publishes even if this tick changed nothing");
  assert.ok(!control().pending);
  const settled = control().revision;
  env.DB.db.prepare("UPDATE catalog_control SET published_at=published_at-900").run();
  await tick(env);
  assert.equal(control().revision, settled, "nothing pending, nothing published");
});

test("a re-seen candidate keeps its place unless the repository has a newer push", async t => {
  const env = ready(t), later = epoch() + 86400;
  queue(env.DB, "fresh/jev-new", { pushed: dayAgo(3), created: dayAgo(3) }, { due_at: later, attempts: 1 });
  makeDue(env.DB, "github-fresh-0");
  publicGitHub(t, { "/search/repositories": () => Response.json({ total_count: 1, incomplete_results: false,
    items: [{ full_name: "fresh/jev-new", stargazers_count: 1, pushed_at: `${dayAgo(4)}T00:00:00Z`, created_at: `${dayAgo(3)}T00:00:00Z` }] }) });
  await tick(env);
  assert.equal(candidate(env.DB, "fresh/jev-new").due_at, later);
  t.mock.restoreAll();
  makeDue(env.DB, "github-fresh-0");
  publicGitHub(t, { "/search/repositories": searchResult("fresh/jev-new") });
  await tick(env);
  assert.deepEqual(entryRepos(env.DB), ["fresh/jev-new"]);
});
