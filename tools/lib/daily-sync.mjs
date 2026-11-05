import { createHash } from 'node:crypto';
import { inspectRepository, POLICY_VERSION } from '../../shared/catalog-policy.js';
import { inferCategory, validRepo } from '../../shared/catalog-data.js';

export const SYNC_LIMITS = Object.freeze({ requests: 100, projects: 20, newProjects: 10, searches: 2, pending: 2000, intervalMs: 1000, durationMs: 240000 });
export function canSync(state, now = Date.now()) {
  return !state.lastAttemptAt || (Number.isFinite(Date.parse(state.lastAttemptAt)) && new Date(now).toISOString().slice(0, 10) > state.lastAttemptAt.slice(0, 10));
}
export function reserveSync(state, now = Date.now()) {
  if (!canSync(state, now)) throw new Error('A sync already ran today (UTC). The existing catalog is retained.');
  return { ...state, lastAttemptAt: new Date(now).toISOString() };
}

/** Bounded incremental refresh. Unvisited records survive every partial run. */
export async function syncDaily({ previous, state, config, overrides, github, now = Date.now() }) {
  const checkedAt = new Date(now).toISOString();
  const excluded = new Set([...(previous.meta.editorialBlocks || []), ...overrides.excluded].map(p => (typeof p === 'string' ? p : p.repo).toLowerCase()));
  const apps = new Map(previous.apps.filter(p => !excluded.has(p.repo.toLowerCase())).map(p => [p.repo.toLowerCase(), p]));
  const pending = new Map((state.pending || []).filter(p => validRepo(p.repo) && !excluded.has(p.repo.toLowerCase())).map(p => [p.repo.toLowerCase(), p]));
  const sources = [], errors = [];
  const add = p => {
    if (validRepo(p.repo) && !apps.has(p.repo.toLowerCase()) && !excluded.has(p.repo.toLowerCase()) && pending.size < SYNC_LIMITS.pending) pending.set(p.repo.toLowerCase(), p);
  };
  for (const p of overrides.projects) add(p);
  for (const repo of config.officialRepos) add({ repo, cat: 'official' });
  // Two small search pages, rotating through the configured queries. No full-history scan.
  let queryCursor = state.queryCursor || 0;
  for (let i = 0; i < Math.min(SYNC_LIMITS.searches, config.githubQueries.length); i++) {
    const query = config.githubQueries[queryCursor++ % config.githubQueries.length];
    try {
      const data = await github.api('/search/repositories?' + new URLSearchParams({ q: query + ' is:public', sort: 'updated', order: 'desc', per_page: '20' }));
      if (!Array.isArray(data?.items)) throw new Error('Invalid search response');
      for (const item of data.items) add({ repo: item.full_name, desc: item.description });
      sources.push({ id: 'github-search', query, status: 'partial', count: data.items.length, checkedAt });
    } catch (error) { sources.push({ id: 'github-search', query, status: 'failed', error: error.message }); if (error.budget) break; }
  }
  const fresh = [...pending.values()].filter(p => !apps.has(p.repo.toLowerCase())).slice(0, SYNC_LIMITS.newProjects);
  const existing = [...apps.values()].sort((a, b) => String(a.metadataCheckedAt || '').localeCompare(b.metadataCheckedAt || '') || a.repo.localeCompare(b.repo)).slice(0, SYNC_LIMITS.projects - fresh.length);
  const selected = [...fresh, ...existing];
  let checked = 0;
  for (const candidate of selected) {
    if (github.calls >= SYNC_LIMITS.requests || Date.now() >= github.deadline) break;
    const oldKey = candidate.repo.toLowerCase(), prior = apps.get(oldKey);
    try {
      const rows = await github.metadata([candidate.repo]);
      const meta = rows.get(oldKey);
      if (!meta || meta.unavailable || meta.isPrivate || !meta.defaultBranchRef?.target?.oid) throw new Error('Repository metadata unavailable; retained for a later check');
      const repo = meta.nameWithOwner, commit = meta.defaultBranchRef.target.oid;
      const project = { ...prior, id: meta.databaseId, name: repo.split('/')[1], repo, author: repo.split('/')[0],
        desc: String(meta.description || candidate.desc || '').replace(/\s+/g, ' ').trim().slice(0, 600),
        cat: prior?.cat || inferCategory({ ...candidate, repo }), language: meta.primaryLanguage?.name || null, stars: meta.stargazerCount,
        created: meta.createdAt?.slice(0, 10) || null, added: prior?.added || checkedAt.slice(0, 10), pushed: meta.pushedAt?.slice(0, 10) || null,
        archived: !!meta.isArchived, fork: !!meta.isFork, license: meta.licenseInfo?.spdxId === 'NOASSERTION' ? null : meta.licenseInfo?.spdxId || null,
        commit, provenance: prior?.provenance || ['github-search'], metadataCheckedAt: checkedAt };
      let detail = prior?.evidencePolicy === POLICY_VERSION && prior.commit === commit ? prior.evidenceDetail : null;
      if (!detail) detail = await inspectRepository(project, github, { codePaths: overrides.codePaths[repo.toLowerCase()] || [], inspectCode: !!overrides.codePaths[repo.toLowerCase()] });
      if (config.officialRepos.some(r => r.toLowerCase() === repo.toLowerCase())) detail = { level: 'official', relationship: repo.endsWith('/skills') ? 'resource' : 'sdk', url: `https://github.com/${repo}/tree/${commit}`, commit };
      if (!detail) throw new Error('No current qualifying evidence; retained for review');
      if (excluded.has(repo.toLowerCase())) { apps.delete(oldKey); pending.delete(oldKey); continue; }
      // Stable identity also handles renamed repositories without duplicate listings.
      for (const [key, value] of apps) if (value.id === project.id) apps.delete(key);
      apps.set(repo.toLowerCase(), { ...project, freshness: 'current', evidencePolicy: POLICY_VERSION, evidenceLevel: detail.level,
        relationship: detail.relationship, evidence: detail.url, evidenceDetail: detail, evidenceCheckedAt: checkedAt,
        ...(oldKey !== repo.toLowerCase() ? { previousRepo: candidate.repo } : {}) });
      pending.delete(oldKey);
      checked++;
    } catch (error) {
      errors.push({ repo: candidate.repo, reason: error.message });
      if (prior) apps.set(oldKey, { ...prior, freshness: 'stale', metadataCheckedAt: checkedAt });
      else { pending.delete(oldKey); pending.set(oldKey, candidate); }
      if (error.budget) break;
    }
  }
  const projects = [...apps.values()].sort((a, b) => a.repo.toLowerCase().localeCompare(b.repo.toLowerCase()));
  const catalogHash = createHash('sha256').update(JSON.stringify(projects)).digest('hex').slice(0, 20);
  const meta = { ...previous.meta, mode: 'snapshot', policy: POLICY_VERSION, catalogHash, projectCount: projects.length,
    totalStars: projects.reduce((n, p) => n + (p.stars || 0), 0), syncedAt: checked ? checkedAt : previous.meta.syncedAt,
    sources, exhaustive: false, sync: { checkedAt, checked, requests: github.calls, requestLimit: SYNC_LIMITS.requests, pending: pending.size, errors: errors.length } };
  return { catalog: { ...previous, meta, apps: projects }, state: { ...state, queryCursor, pending: [...pending.values()], ...(checked ? { lastSuccessAt: checkedAt } : {}) },
    audit: { syncedAt: meta.syncedAt, catalogHash, listedCount: projects.length, sources, errors, ...meta.sync } };
}
