import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHub } from './lib/github.mjs';
import { canSync, reserveSync, syncDaily, SYNC_LIMITS } from './lib/daily-sync.mjs';
import { POLICY_VERSION } from '../shared/catalog-policy.js';

test('daily source cap includes concurrent calls and retries', async () => {
  let requests = 0;
  const github = new GitHub({ token: null, cachePath: '/nonexistent/cache', maxRequests: 3, fetcher: async () => { requests++; return new Response('', { status: 404 }); } });
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, n) => github.api('/repos/test/' + n)));
  assert.equal(requests, 3);
  assert.equal(results.filter(r => r.status === 'rejected').length, 7);
  let attempts = 0;
  const retry = new GitHub({ token: null, cachePath: '/nonexistent/cache', maxRequests: 1, fetcher: async () => { attempts++; throw new Error('offline'); } });
  await assert.rejects(retry.api('/retry'), /limit/);
  assert.equal(attempts, 1);
});

test('elapsed deadline makes no outbound request', async () => {
  const github = new GitHub({ token: null, deadline: 0, fetcher: () => { throw new Error('must not fetch'); } });
  await assert.rejects(github.api('/repos/test/example'), /limit/);
  assert.equal(github.calls, 0);
});

test('failed attempts consume the UTC daily slot and next day is allowed', () => {
  const now = Date.parse('2026-11-05T10:17:00Z');
  const state = reserveSync({}, now);
  assert.equal(canSync(state, now + 3600000), false);
  assert.throws(() => reserveSync(state, now), /already ran/);
  assert.equal(canSync(state, Date.parse('2026-11-06T10:16:00Z')), true);
  assert.equal(canSync({ lastAttemptAt: 'invalid' }, now), false);
});

const project = i => ({ id: i + 1, repo: 'test/repo-' + i, name: 'repo-' + i, stars: i, cat: 'apps', commit: 'a'.repeat(40), freshness: 'current', evidencePolicy: POLICY_VERSION, evidenceDetail: { level: 'documented', relationship: 'jev-app', url: 'https://github.com/test/repo-' + i }, desc: 'A documented Jev project' });
const config = { githubQueries: [], officialRepos: [] };
const overrides = { excluded: [], projects: [], codePaths: {} };
test('partial sync retains all unvisited projects and rotates checks', async () => {
  const previous = { meta: { syncedAt: '2026-10-01' }, apps: Array.from({ length: 45 }, (_, n) => project(n)) };
  let calls = 0;
  const github = { calls: 0, deadline: Infinity, metadata: async ([repo]) => {
    calls++;
    const p = previous.apps.find(p => p.repo === repo);
    return new Map([[repo, { databaseId: p.id, nameWithOwner: repo, description: p.desc, stargazerCount: 42, defaultBranchRef: { target: { oid: p.commit } } }]]);
  } };
  const result = await syncDaily({ previous, state: {}, config, overrides, github });
  assert.equal(calls, SYNC_LIMITS.projects);
  assert.equal(result.catalog.apps.length, previous.apps.length);
  assert.equal(result.catalog.apps.filter(p => p.metadataCheckedAt).length, 20);
  const untouched = result.catalog.apps.filter(p => !p.metadataCheckedAt);
  for (const p of untouched) assert.deepEqual(p, previous.apps.find(old => old.id === p.id));
  const second = await syncDaily({ previous: result.catalog, state: result.state, config, overrides, github });
  assert.equal(second.catalog.apps.filter(p => p.metadataCheckedAt).length, 40);
});

test('source failure retains catalog entries and previous successful timestamp', async () => {
  const previous = { meta: { syncedAt: '2026-10-01' }, apps: [project(0)] };
  const github = { calls: 100, deadline: Infinity };
  const result = await syncDaily({ previous, state: {}, config, overrides, github });
  assert.deepEqual(result.catalog.apps, previous.apps);
  assert.equal(result.catalog.meta.syncedAt, previous.meta.syncedAt);
});
