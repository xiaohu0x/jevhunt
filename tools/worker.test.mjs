import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./helpers/d1.mjs";
import { tick } from "../workers/catalog-sync/engine.js";
import { parseRepositoryPage } from "../workers/catalog-sync/github-public.js";
import { catalogMeta } from "../shared/catalog-data.js";

const commit = "a".repeat(40);
const html = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: {
  codeViewLayoutRoute: { repo: { id: 101, ownerLogin: "sample", name: "jev-app", public: true, private: false, isFork: false, isArchived: false, createdAt: "2026-09-20T00:00:00Z" }, refInfo: { currentOid: commit } },
  sidebarAbout: { description: "A Jev application", stargazerCount: 12, repo: { license: { spdxId: "MIT" } } },
  csrf_tokens: { never_store_this: "not-catalog-data" },
} })}</script>`;

function ready(t) {
  const DB = database(); t.after(() => DB.db.close());
  const now = Math.floor(Date.now() / 1000);
  for (const id of ["awesome-jev", "typesafe-field-guide", "github-search-0", "github-search-1", "github-search-2", "github-search-3"]) {
    DB.db.prepare("INSERT INTO catalog_sources(id,next_due_at) VALUES(?,?)").run(id, now + 86400);
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
