/**
 * "Featured" is the default reading order of the directory: projects with
 * documented evidence, a real description and enough traction to be worth a
 * visitor's time. It is a sort, not a filter — every active project remains
 * reachable through search, categories and "all projects".
 */
export const FEATURED_CONDITIONS = [
  "stars >= 50",
  "category <> 'lists'",
  "json_extract(payload,'$.archived') = 0",
  "json_extract(payload,'$.evidenceLevel') IN ('official','documented')",
  "length(COALESCE(json_extract(payload,'$.content.summary'), json_extract(payload,'$.desc'),'')) >= 80",
];

export const FEATURED_WHERE = FEATURED_CONDITIONS.join(" AND ");

/**
 * Evidence first, then recent activity, then traction. Lists and low-signal
 * repositories are pushed down rather than removed, so "all projects" stays
 * honest while the first screen stops showing generic awesome lists.
 */
export const FEATURED_ORDER_SQL = `CASE json_extract(payload,'$.evidenceLevel') WHEN 'official' THEN 3 WHEN 'documented' THEN 2 WHEN 'code-reference' THEN 1 ELSE 0 END DESC,
  CASE WHEN COALESCE(json_extract(payload,'$.pushed'),'') >= date('now','-90 days') THEN 1 ELSE 0 END DESC,
  CASE WHEN category = 'lists' THEN 1 ELSE 0 END ASC,
  stars DESC,
  created DESC,
  name COLLATE NOCASE`;

export function isFeatured(project = {}) {
  const stars = Number(project.stars) || 0;
  return stars >= 50
    && project.cat !== "lists"
    && project.archived !== true
    && ["official", "documented"].includes(project.evidenceLevel)
    && String(project.desc || "").trim().length >= 80;
}

const evidenceRank = project => ({ official: 3, documented: 2, "code-reference": 1 }[project.evidenceLevel] || 0);
const recentRank = project => {
  const pushed = Date.parse(project.pushed || "");
  return Number.isFinite(pushed) && Date.now() - pushed < 90 * 86400000 ? 1 : 0;
};

export function compareFeatured(a, b) {
  return evidenceRank(b) - evidenceRank(a)
    || recentRank(b) - recentRank(a)
    || (a.cat === "lists" ? 1 : 0) - (b.cat === "lists" ? 1 : 0)
    || (Number(b.stars) || 0) - (Number(a.stars) || 0)
    || String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base" });
}

/** A card-level trust signal: evidence plus a usable description. */
export function isVerified(project = {}) {
  return ["official", "documented"].includes(project.evidenceLevel)
    && String(project.desc || "").trim().length >= 60
    && project.archived !== true
    && project.freshness !== "stale";
}
