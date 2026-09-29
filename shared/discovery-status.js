const iso = value => {
  const date = typeof value === "number" ? value * 1000 : Date.parse(value || "");
  return Number.isFinite(date) && date > 0 ? new Date(date).toISOString() : null;
};

/** Source success and completed search coverage are separate from scheduler health. */
export function discoverySummary(sources = [], configuredQueries = [], now = Date.now()) {
  const queries = configuredQueries.map((query, index) => {
    const id = `github-search-${index}`, source = sources.find(item => item.id === id);
    const queryChanged = source?.query !== query;
    const lastCompleteAt = queryChanged ? null : iso(source?.lastCompleteAt);
    const lastSuccessAt = queryChanged ? null : iso(source?.lastSuccessAt);
    const windowsRemaining = queryChanged ? null : (source?.windows || []).length;
    const partial = !queryChanged && source?.partial === true;
    const status = source?.status === "failed" ? "degraded"
      : queryChanged ? "pending"
      : partial ? "partial"
      : windowsRemaining ? "in-progress"
      : !lastCompleteAt ? "pending"
      : now - Date.parse(lastCompleteAt) >= 24 * 3600_000 ? "stale" : "current";
    return { id, query, status, queryChanged, partial, lastCompleteAt, lastSuccessAt,
      lastPageAt: queryChanged ? null : iso(source?.lastPageAt), windowsRemaining,
      pagesScanned: queryChanged ? 0 : Number(source?.pagesScanned || 0), error: source?.error || null };
  });
  const completedQueries = queries.filter(query => query.lastCompleteAt).length;
  const discoveryStatus = queries.some(query => query.status === "degraded") ? "degraded"
    : queries.some(query => query.status === "stale") ? "stale"
    : queries.some(query => query.status === "partial") ? "partial"
    : !queries.length || queries.some(query => ["pending", "in-progress"].includes(query.status)) ? "in-progress" : "current";
  return { discoveryStatus, exhaustive: false, configuredQueries: queries.length, completedQueries,
    failedQueries: queries.filter(query => query.status === "degraded").length,
    partialQueries: queries.filter(query => query.partial).length, queries,
    coverageNote: "Completed searches cover the configured public repository queries, not every Jev project. GitHub search limits, partial results and rate limits can leave gaps." };
}
