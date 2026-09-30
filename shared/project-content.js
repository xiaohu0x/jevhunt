import { LOCALES } from "./locales.js";

export const PROJECT_CONTENT_VERSION = "source-content-v1";
export const CONTENT_SECTIONS = ["purpose", "jev", "usage", "limits"];
const relationships = new Set(["jev-app", "integration", "sdk", "local-alternative", "research", "resource", "unclassified"]);
const categories = new Set(["official", "sdks", "integrations", "agents", "browser", "apps", "games", "demos", "research", "lists"]);
const text = value => typeof value === "string" && value.trim().length > 0;
const plain = value => text(value) && !/<\/?(?:script|iframe|style|div|p|a|img)\b/i.test(value);

// Mechanical validation is deliberately separate from source and language review.
// A passing schema never creates a verified-facts or language-review assertion.
export function validateProjectContent(record, { requireAllLocales = true } = {}) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  check(record?.version === PROJECT_CONTENT_VERSION, "Unsupported content version");
  check(/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(record?.repo || ""), "Invalid repository identity");
  check(Number.isSafeInteger(record?.repositoryId) && record.repositoryId > 0, "Missing stable GitHub repository ID");
  check(relationships.has(record?.relationship), "Invalid relationship");
  check(categories.has(record?.category), "Invalid category");
  check(["reviewed", "source-limited"].includes(record?.status), "Content is not reviewed");
  check(/^\d{4}-\d{2}-\d{2}$/.test(record?.reviewedAt || ""), "Missing factual review date");
  if (record?.status === "source-limited") check(text(record?.limitation), "Source-limited content needs a specific explanation");
  const sources = Array.isArray(record?.sources) ? record.sources : [];
  check(sources.length > 0, "Missing first-party source record");
  const sourceIds = new Set();
  for (const source of sources) {
    check(text(source.id) && !sourceIds.has(source.id), "Duplicate or empty source ID"); sourceIds.add(source.id);
    let url;
    try { url = new URL(source.url); } catch { /* Report below. */ }
    check(url?.protocol === "https:" && url?.hostname === "github.com", "Source must be a first-party GitHub document");
    check(/^[a-f0-9]{40}$/.test(source.commit || "") && url?.pathname.includes("/blob/" + source.commit + "/"), "Source must be commit-pinned");
    check(/^[a-f0-9]{64}$/.test(source.sha256 || ""), "Missing source content hash");
    check(text(source.accessedAt) && Number.isFinite(Date.parse(source.accessedAt)), "Missing source access date");
  }
  const claims = Array.isArray(record?.claims) ? record.claims : [];
  const claimIds = new Set();
  check(claims.length > 0, "Missing claim ledger");
  for (const claim of claims) {
    check(text(claim.id) && !claimIds.has(claim.id), "Duplicate or empty claim ID"); claimIds.add(claim.id);
    check(plain(claim.text), "Claim text must be plain, nonempty text");
    check(["documented", "source-limitation"].includes(claim.kind), "Unsupported claim type; do not imply runtime testing");
    check(Array.isArray(claim.evidence) && claim.evidence.length > 0, "Claim has no supporting passage");
    for (const evidence of claim.evidence || []) {
      check(sourceIds.has(evidence.source), "Unknown claim source");
      check(Number.isInteger(evidence.start) && evidence.start > 0 && Number.isInteger(evidence.end) && evidence.end >= evidence.start, "Invalid evidence line range");
      check(text(evidence.quote), "Missing source quotation");
    }
  }
  const locales = record?.locales || {};
  if (requireAllLocales) check(Object.keys(LOCALES).every(key => Object.hasOwn(locales, key)), "Missing supported locale");
  for (const [locale, content] of Object.entries(locales)) {
    check(Object.hasOwn(LOCALES, locale), "Unsupported content locale: " + locale);
    for (const key of ["title", "h1", "description", "summary"]) check(plain(content?.[key]), `${locale}: missing or non-plain ${key}`);
    check(!/\|\s*JevHunt\s*$/i.test(content?.title || ""), `${locale}: the shared renderer owns the site suffix`);
    check(!/\{(?:name|topic|language|code|platform)\}/.test(JSON.stringify(content)), `${locale}: unresolved content placeholder`);
    const sections = Array.isArray(content?.sections) ? content.sections : [];
    check(CONTENT_SECTIONS.every(kind => sections.some(section => section.kind === kind)), `${locale}: incomplete decision-helping sections`);
    check(new Set(sections.map(section => section.kind)).size === sections.length, `${locale}: duplicate section`);
    for (const section of sections) {
      check(CONTENT_SECTIONS.includes(section.kind), `${locale}: unknown section kind`);
      check(plain(section.heading) && plain(section.text), `${locale}: empty section`);
      check(Array.isArray(section.claims) && section.claims.length > 0 && section.claims.every(id => claimIds.has(id)), `${locale}: section without known supporting claims`);
    }
    check(content?.review?.language === "model-reviewed", `${locale}: missing separate model language-review provenance`);
    check(content?.review?.semantic === "source-checked", `${locale}: missing semantic source review`);
    check(["observed", "inferred"].includes(content?.review?.searchIntent), `${locale}: missing honest search-intent status`);
  }
  return errors;
}

export function matchingProjectContent(project, record) {
  return !!record && record.version === PROJECT_CONTENT_VERSION && ["reviewed", "source-limited"].includes(record.status)
    && Array.isArray(record.sources) && record.sources.length > 0 && Array.isArray(record.claims)
    && text(record.locales?.en?.summary) && Number(project.id) === record.repositoryId && project.repo.toLowerCase() === record.repo.toLowerCase();
}

export function applyProjectContent(project, record) {
  if (!matchingProjectContent(project, record)) {
    if (!project.content) return project;
    const { content: inheritedContent, ...sourceProject } = project;
    return sourceProject;
  }
  const claimId = record.locales.en.sections.find(section => section.kind === "jev")?.claims[0];
  const claim = record.claims.find(claim => claim.id === claimId);
  const evidence = claim?.evidence[0];
  const source = record.sources.find(source => source.id === evidence?.source);
  const evidenceUrl = evidence ? contentCitation(record, evidence) : null;
  const level = project.evidenceLevel === "official" ? "official" : /\.(?:md|rst|txt|adoc)$/i.test(source?.path || "") ? "documented" : "code-reference";
  return { ...project, name: record.displayName || project.name, repositoryName: project.repo.split("/").at(-1), relationship: record.relationship, cat: record.category,
    ...(evidenceUrl ? { evidence: evidenceUrl, evidenceLevel: level, verification: level, evidenceCheckedAt: record.reviewedAt,
      evidenceDetail: { ...(project.evidenceDetail || {}), relationship: record.relationship, level, excerpt: evidence.quote, commit: source.commit, path: source.path, line: evidence.start, url: evidenceUrl } } : {}),
    content: { version: record.version, status: record.status, reviewedAt: record.reviewedAt,
      sourceCommit: record.sources[0]?.commit, summary: record.locales.en.summary,
      locales: Object.keys(record.locales), sourceChanged: !record.sources.some(source => source.commit === project.commit) } };
}

export function contentCitation(record, evidence) {
  const source = record.sources.find(source => source.id === evidence.source);
  return source ? source.url + `#L${evidence.start}-L${evidence.end}` : null;
}
