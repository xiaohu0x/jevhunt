// Keep the complete catalog searchable while bounding pre-rendered detail files.
export const STATIC_PROJECT_LIMIT = 750;
export const PROJECT_SHARDS = 64;
export function projectShard(repo) {
  let hash = 2166136261;
  for (const char of repo.toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % PROJECT_SHARDS;
}
export function staticProjectPaths(projects, records) {
  const reviewed = new Set([...records.keys()].map(key => key.toLowerCase()));
  const ordered = [...projects].sort((a, b) => Number(reviewed.has(b.repo.toLowerCase())) - Number(reviewed.has(a.repo.toLowerCase())) || b.stars - a.stars || a.repo.localeCompare(b.repo));
  const selected = new Set(ordered.slice(0, STATIC_PROJECT_LIMIT).map(p => p.repo.toLowerCase()));
  return projects.map(p => {
    const repo = p.repo.toLowerCase();
    return { ...p, staticPage: selected.has(repo), detailPath: selected.has(repo) ? `/projects/${repo}/` : '/project/?repo=' + encodeURIComponent(repo), detailLocales: reviewed.has(repo) ? Object.keys(records.get(repo).locales) : ['en'] };
  });
}
