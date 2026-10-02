import { activeClause, CATEGORY_IDS, CATEGORY_NAMES, cleanText } from "./catalog-data.js";
import { LOCALES } from "./locales.js";
import { localizeCatalogProjects } from "./project-content-store.js";

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
const searchTerms = value => {
  const q = String(value || "").normalize("NFKC");
  // Keep punctuation-heavy input literal so escaped LIKE characters and paths
  // retain their existing exact-match behavior. Hyphens, slashes and spaces
  // remain useful word boundaries for repository names and natural queries.
  if (/[\\%_']/u.test(q)) return q ? [q] : [];
  return [...q.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)].map(match => match[0]).filter(Boolean);
};
const normalizedWords = expression => `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${expression}, '-', ' '), '_', ' '), '/', ' '), '.', ' '), ':', ' '))`;

export function readCatalogQuery(params) {
  const all = params.get("all") === "1";
  const q = cleanText(params.get("q"), 300).toLowerCase();
  return {
    mode: all ? "all" : QUERY_FIELDS.some(field => params.has(field)) ? "page" : "preview",
    full: params.get("full") === "1",
    page: integer(params.get("page"), 1, Number.MAX_SAFE_INTEGER),
    pageSize: integer(params.get("per_page"), 20, 100),
    q,
    terms: searchTerms(q),
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
  key.searchParams.set("locale", query.locale);
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
    const terms = query.terms?.length ? query.terms : [query.q];
    const pattern = value => "%" + value.replace(/[\\%_]/g, "\\$&") + "%";
    const categoryMatches = CATEGORY_IDS.filter((id, i) =>
      terms.every(term => [id, CATEGORY_NAMES[i], messages[`category.${id}.name`]].filter(Boolean).join(" ").toLowerCase().includes(term)));
    const text = "name || ' ' || repo || ' ' || COALESCE(json_extract(payload, '$.desc'), '') || ' ' || COALESCE(json_extract(payload, '$.content.summary'), '') || ' ' || COALESCE((SELECT l.search_text FROM project_content_locales l JOIN project_content c ON c.repo=l.repo AND c.content_hash=l.content_hash WHERE l.repo=catalog_entries.repo AND c.github_id=catalog_entries.github_id AND l.locale=?), '') || ' ' || COALESCE(language, '')";
    const literal = /[\\%_']/u.test(query.q);
    const searchable = literal ? `LOWER(${text})` : `(' ' || ${normalizedWords(text)} || ' ')`;
    const tokenClauses = terms.map(() => `${searchable} LIKE ? ESCAPE '\\'`).join(" AND ");
    const categoryClause = categoryMatches.length ? ` OR category IN (${categoryMatches.map(() => "?").join(",")})` : "";
    clauses.push(`((${tokenClauses})${categoryClause})`);
    for (const term of terms) values.push(query.locale, literal ? pattern(term) : `% ${term} %`);
    values.push(...categoryMatches);
  }
  return { where: clauses.join(" AND "), values };
}

function searchOrder(query) {
  if (!query.q || !query.terms?.length) return { sql: SORT_SQL[query.sort], values: [] };
  const source = "LOWER(name || ' ' || repo)";
  const literal = /[\\%_']/u.test(query.q);
  const searchable = literal ? source : `(' ' || ${normalizedWords("name || ' ' || repo")} || ' ')`;
  const allNameTerms = query.terms.map(() => `${searchable} LIKE ? ESCAPE '\\'`).join(" AND ");
  const anyNameTerm = query.terms.map(() => `${searchable} LIKE ? ESCAPE '\\'`).join(" OR ");
  const patterns = query.terms.map(term => literal ? "%" + term.replace(/[\\%_]/g, "\\$&") + "%" : `% ${term} %`);
  return {
    sql: `CASE WHEN (${allNameTerms}) THEN 0 WHEN (${anyNameTerm}) THEN 1 ELSE 2 END, ${SORT_SQL[query.sort]}`,
    values: [...patterns, ...patterns],
  };
}

export async function readCatalogPage(DB, query, messages = {}) {
  const { where, values } = filters(query, messages);
  const order = searchOrder(query);
  const count = await DB.prepare(`SELECT COUNT(*) AS total FROM catalog_entries WHERE ${where}`).bind(...values).first();
  const total = Number(count?.total || 0), pageSize = query.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page, totalPages), offset = (page - 1) * pageSize;
  const result = await DB.prepare(`SELECT ${query.full ? "payload" : "preview"} AS data FROM catalog_entries WHERE ${where} ORDER BY ${order.sql} LIMIT ? OFFSET ?`)
    .bind(...values, ...order.values, pageSize, offset).all();
  const projects = result.results.map(row => JSON.parse(row.data));
  const apps = query.full ? projects : await localizeCatalogProjects(DB, projects, query.locale);
  return { apps, pagination: { page, pageSize, total, totalPages, start: total ? offset + 1 : 0, end: Math.min(total, offset + pageSize) } };
}
