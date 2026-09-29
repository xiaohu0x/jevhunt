import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./helpers/d1.mjs";
import { discoverySummary } from "../shared/discovery-status.js";
import { onRequestGet as statusData } from "../functions/api/catalog/status.js";
import { onRequestGet as statusPage } from "../functions/status/index.js";
import sourceConfig from "../catalog/sources.json" with { type: "json" };

const now = Date.parse("2026-09-29T12:00:00Z"), recent = Math.floor(now / 1000) - 60;
const current = (id = "github-search-0", query = "jev") => ({ id, query, status: "ok", windows: [],
  lastCompleteAt: recent, lastPageAt: recent, lastSuccessAt: new Date(recent * 1000).toISOString(), partial: false });

test("discovery status cannot be made healthy by supplementary community source success", () => {
  const source = { ...current(), status: "failed", error: "GitHub API is waiting for its rate limit to reset" };
  const result = discoverySummary([source, { id: "community", status: "ok", lastSuccessAt: new Date(now).toISOString() }], ["jev"], now);
  assert.equal(result.discoveryStatus, "degraded"); assert.equal(result.failedQueries, 1);
  assert.equal(result.queries[0].query, "jev"); assert.ok(result.queries[0].lastCompleteAt);
  assert.equal(result.exhaustive, false); assert.match(result.coverageNote, /not every Jev project/);
});

test("query changes invalidate old completion dates and expose the expected current query", () => {
  const result = discoverySummary([current()], ["new query fork:false"], now);
  assert.equal(result.discoveryStatus, "in-progress"); assert.equal(result.completedQueries, 0);
  assert.equal(result.queries[0].query, "new query fork:false"); assert.equal(result.queries[0].queryChanged, true);
  assert.equal(result.queries[0].lastCompleteAt, null); assert.equal(result.queries[0].lastSuccessAt, null);
  assert.equal(result.queries[0].windowsRemaining, null);
});

test("ongoing, partial and stale discovery passes remain distinct from current configured searches", () => {
  assert.equal(discoverySummary([{ ...current(), windows: [{}] }], ["jev"], now).discoveryStatus, "in-progress");
  assert.equal(discoverySummary([{ ...current(), partial: true }], ["jev"], now).discoveryStatus, "partial");
  assert.equal(discoverySummary([{ ...current(), lastCompleteAt: recent - 86400 }], ["jev"], now).discoveryStatus, "stale");
  const completed = discoverySummary([current()], ["jev"], now);
  assert.equal(completed.discoveryStatus, "current"); assert.equal(completed.exhaustive, false);
});

test("status JSON and HTML surface failed primary searches and real repository-check coverage", async t => {
  const DB = database(); t.after(() => DB.db.close());
  const epoch = Math.floor(Date.now() / 1000);
  const add = (repo, checkedAt) => DB.db.prepare("INSERT INTO catalog_entries(repo,payload,preview,name,category,relationship,checked_at,next_check_at) VALUES(?, '{}', '{}', 'Project', 'apps', 'jev-app', ?, ?)").run(repo, checkedAt, epoch);
  add("sample/fresh", epoch - 30); add("sample/stale", epoch - 4 * 86400); add("sample/withdrawn", 1);
  DB.db.prepare("INSERT INTO catalog_withdrawals VALUES('sample/withdrawn',1,'editor')").run();
  DB.db.prepare("UPDATE catalog_control SET last_scheduled_at=?,published_at=?").run(epoch, epoch);
  for (const [index, query] of sourceConfig.githubQueries.entries()) {
    DB.db.prepare("INSERT INTO catalog_sources(id,state,status,last_success_at,error) VALUES(?,?,'failed',?,'Rate limited')")
      .run(`github-search-${index}`, JSON.stringify({ query, windows: [{ from: "2008-01-01", to: "2026-09-29", page: 1 }], lastCompleteAt: null }), epoch);
  }
  DB.db.prepare("INSERT INTO catalog_sources(id,status,last_success_at) VALUES('community','ok',?)").run(epoch);
  const context = { env: { DB }, request: new Request("https://jevhunt.com/status/"), next() { throw new Error("Expected live status"); } };
  const data = await (await statusData(context)).json();
  assert.equal(data.discoveryStatus, "degraded"); assert.equal(data.discovery.failedQueries, 9);
  assert.equal(data.discovery.completedQueries, 0); assert.equal(data.discovery.exhaustive, false);
  assert.equal(data.evidence.total, 2); assert.equal(data.evidence.checked24h, 1); assert.equal(data.evidence.checked72h, 1);
  assert.equal(data.evidence.oldest_checked_at, epoch - 4 * 86400);
  const html = await (await statusPage(context)).text();
  assert.match(html, /The scheduled worker is running/);
  assert.match(html, /GitHub search discovery: degraded/);
  assert.match(html, /not every Jev project/);
  assert.match(html, /Not completed for this query/);
  assert.match(html, /1 of 2 active repositories checked in the last 24 hours/);
  assert.match(html, /Supplementary community sources/);
});
