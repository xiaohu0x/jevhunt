import { activeClause, CATEGORY_IDS, CATEGORY_NAMES, cleanText } from "./catalog-data.js";
import { LOCALES } from "./locales.js";

const KINDS = ["jev-app", "integration", "sdk", "local-alternative", "research", "resource", "unclassified"];
const tieBreak = "stars DESC, name COLLATE NOCASE, repo";
const dateOrder = (field, direction) => `(${field} IS NULL OR ${field} = '') ASC, ${field} ${direction}, ${tieBreak}`;
const SORT_SQL = {
  "stars-desc": "stars DESC, created DESC, name COLLATE NOCASE, repo",
  "stars-asc": "stars ASC, created DESC, name COLLATE NOCASE, repo",
  "created-desc": dateOrder("created", "DESC"),
  "created-asc": dateOrder("created", "ASC"),
  "updated-desc": dateOrder("json_extract(payload, '$.pushed')", "DESC"),
  "added-desc": dateOrder("json_extract(payload, '$.added')", "DESC"),
  "name-asc": "name COLLATE NOCASE, stars DESC, repo",
};
const QUERY_FIELDS = ["page", "per_page", "q", "category", "kind", "language", "activity", "sort", "locale"];
const integer = (value, fallback, maximum) => /^\d+$/.test(value || "")
  ? Math.min(maximum, Math.max(1, Number(value))) : fallback;
const allowed = (value, choices, fallback = "all") => choices.includes(value) ? value : fallback;

export function readCatalogQuery(params) {
  const all = params.get("all") === "1";
  return {
    mode: all ? "all" : QUERY_FIELDS.some(field => params.has(field)) ? "page" : "preview",
    full: params.get("full") === "1",
    page: integer(params.get("page"), 1, Number.MAX_SAFE_INTEGER),
    pageSize: integer(params.get("per_page"), 20, 100),
    q: cleanText(params.get("q"), 300).toLowerCase(),
    category: allowed(params.get("category"), CATEGORY_IDS),
    kind: allowed(params.get("kind"), KINDS),
    language: cleanText(params.get("language"), 50) || "all",
    activity: allowed(params.get("activity"), ["active", "archived"]),
    sort: allowed(params.get("sort"), Object.keys(SORT_SQL), "stars-desc"),
    locale: Object.hasOwn(LOCALES, params.get("locale")) ? params.get("locale") : "en",
  };
}

export function catalogCacheRequest(url, query, revision) {
  const key = new URL(url.origin + url.pathname);
  key.searchParams.set("mode", query.mode);
  key.searchParams.set("full", query.full ? "1" : "0");
  if (query.mode === "page") {
    for (const field of ["page", "pageSize", "q", "category", "kind", "language", "activity", "sort", "locale"]) {
      key.searchParams.set(field, String(query[field]));
    }
  }
  key.searchParams.set("version", revision || "initializing");
  return new Request(key);
}

function filters(query, messages) {
  const clauses = [activeClause], values = [];
  for (const [field, value] of [["category", query.category], ["relationship", query.kind]]) {
    if (value !== "all") { clauses.push(`${field} = ?`); values.push(value); }
  }
  if (query.language !== "all") {
    clauses.push("COALESCE(language, 'unknown') = ?"); values.push(query.language);
  }
  if (query.activity !== "all") {
    clauses.push("json_extract(payload, '$.archived') = ?"); values.push(query.activity === "archived" ? 1 : 0);
  }
  if (query.q) {
    // LIKE wildcards are user text, not query operators. All text remains bound.
    const pattern = "%" + query.q.replace(/[\\%_]/g, "\\$&") + "%";
    const categoryMatches = CATEGORY_IDS.filter((id, i) =>
      [id, CATEGORY_NAMES[i], messages[`category.${id}.name`]].filter(Boolean).join(" ").toLowerCase().includes(query.q));
    const text = "name || ' ' || repo || ' ' || COALESCE(json_extract(payload, '$.desc'), '') || ' ' || COALESCE(language, '')";
    const categoryClause = categoryMatches.length ? ` OR category IN (${categoryMatches.map(() => "?").join(",")})` : "";
    clauses.push(`((${text}) LIKE ? ESCAPE '\\'${categoryClause})`);
    values.push(pattern, ...categoryMatches);
  }
  return { where: clauses.join(" AND "), values };
}

export async function readCatalogPage(DB, query, messages = {}) {
  const { where, values } = filters(query, messages);
  const count = await DB.prepare(`SELECT COUNT(*) AS total FROM catalog_entries WHERE ${where}`).bind(...values).first();
  const total = Number(count?.total || 0), pageSize = query.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page, totalPages), offset = (page - 1) * pageSize;
  const result = await DB.prepare(`SELECT ${query.full ? "payload" : "preview"} AS data FROM catalog_entries WHERE ${where} ORDER BY ${SORT_SQL[query.sort]} LIMIT ? OFFSET ?`)
    .bind(...values, pageSize, offset).all();
  return { apps: result.results.map(row => JSON.parse(row.data)), pagination: { page, pageSize, total, totalPages, start: total ? offset + 1 : 0, end: Math.min(total, offset + pageSize) } };
}
