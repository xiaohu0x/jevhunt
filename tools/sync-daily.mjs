import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { GitHub } from './lib/github.mjs';
import { reserveSync, syncDaily, SYNC_LIMITS } from './lib/daily-sync.mjs';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, data) => { writeFileSync(path + '.tmp', JSON.stringify(data, null, 2) + '\n'); renameSync(path + '.tmp', path); };
const statePath = 'catalog/sync-state.json';
const saved = existsSync(statePath) ? read(statePath) : {};
const reserved = process.argv.includes('--run-reserved');
const state = reserved ? saved : { ...reserveSync(saved), runId: process.env.GITHUB_RUN_ID || null };
if (reserved && (!process.env.GITHUB_RUN_ID || state.runId !== process.env.GITHUB_RUN_ID || state.lastAttemptAt?.slice(0, 10) !== new Date().toISOString().slice(0, 10))) throw new Error('No daily reservation for this workflow run');
if (process.argv.includes('--reserve')) { write(statePath, state); process.exit(0); }

const github = new GitHub({ maxRequests: SYNC_LIMITS.requests, minIntervalMs: SYNC_LIMITS.intervalMs, deadline: Date.now() + SYNC_LIMITS.durationMs });
if (!github.token) throw new Error('Sign in with gh or set GITHUB_TOKEN before syncing.');
// Persist attempts too: retries and failed runs must not reset the daily budget.
write(statePath, state);
try {
  const result = await syncDaily({ previous: read('public/catalog.json'), state, config: read('catalog/sources.json'), overrides: read('catalog/overrides.json'), github });
  mkdirSync('.cache', { recursive: true });
  write('.cache/proposed-catalog.json', result.catalog);
  write('public/catalog.json', result.catalog);
  write('public/catalog-audit.json', result.audit);
  write(statePath, result.state);
  console.log(JSON.stringify(result.audit, (key, value) => ['sources', 'errors'].includes(key) ? undefined : value));
} finally { github.save(); }
