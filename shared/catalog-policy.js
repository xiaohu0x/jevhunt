import { mapLimit } from "./concurrency.js";
export const POLICY_VERSION = "evidence-v5";
export const RELATIONSHIPS = ["jev-app", "integration", "sdk", "local-alternative", "research", "resource", "unclassified"];
const IDENTIFIER = /(?:jev-(?:latest|\d[\w.-]*)|typesafe(?:-ai)?\/jev|(?:api\.)?typesafe\.ai\/v1\/systemone|@typesafe-ai\/sdk|\btypesafe[-_]sdk\b|\bTYPESAFE_API_KEY\b|\bJEV_API_KEY\b)/i;
const NEGATIVE = /(?:does(?:n't| not)|do(?:n't| not)|never|without|not (?:using|use|powered by|built (?:on|with)))\s+.{0,35}(?:jev|typesafe)|(?:not affiliated|unaffiliated)|(?:related (?:tools|projects)|see also|awesome list|alternatives?:)/i;
const OPERATIONAL = /(?:uses?|using|powered|built (?:with|on)|integrat(?:es?|ion)|call(?:s|ing)?|client|SDK|api|router|rerank|decision|noul|classif|score|system[ -]one)/i;
const ALTERNATIVE = /(?:jev[- ](?:like|style|compatible).{0,50}(?:model|engine|replica)|(?:independent|local|open[- ]weight|self[- ]hosted).{0,100}(?:alternative|replica|reproduction|reconstruction|replacement)|(?:alternative|replacement|reproduction|replica) (?:to|of|for).{0,30}(?:jev|typesafe)|independent starter model)/i;

export function analyzeEvidence(readme = "", { category, description = "", name = "" } = {}) {
  const lines = readme.split("\n");
  let match = null, skipLevel = 0;
  const related = /(?:typesafe(?:\.ai)?|system[ -]one)/i.test(readme);
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i].trim();
    const heading = /^(#{1,6})\s+(.+)/.exec(original);
    if (heading) {
      if (skipLevel && heading[1].length <= skipLevel) skipLevel = 0;
      if (/used by|users|sponsors|acknowledg|related projects|see also|credits|powered by us/i.test(heading[2])) skipLevel = heading[1].length;
    }
    if (skipLevel || !original || NEGATIVE.test(original) || /^[-*]\s+\[[^\]]+\]\(https?:/.test(original)) continue;
    const line = original.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<[^>]*>/g, "").replace(/\]\([^)]+\)/g, "]").trim();
    if (!line) continue;
    const technical = IDENTIFIER.test(line);
    const statedUse = related && /\bjev\b/i.test(line) && OPERATIONAL.test(line) && line.length > 25;
    const score = technical ? 4 : statedUse ? 2 : 0;
    if (score && (!match || score > match.score)) match = { score, signal: technical ? "api-or-sdk-reference" : "documented-use", line: i + 1, excerpt: line.slice(0, 500) };
    if (technical) break;
  }
  if (!match) return null;
  const intro = (name + " " + description + " " + lines.slice(0, 85).join(" ")).replace(/\s+/g, " ");
  let relationship = "unclassified";
  if (ALTERNATIVE.test(intro)) relationship = "local-alternative";
  else if (category === "lists" || /\bawesome[- ]|\bdirectory\b|curated list/i.test(name + " " + description)) relationship = "resource";
  else if (category === "research" || /\bbenchmark\b|calibration audit|independent eval/i.test(description)) relationship = "research";
  else if (category === "sdks" || /\b(?:SDK|client library)\b/i.test(description)) relationship = "sdk";
  else if (category === "integrations" || /\b(?:optional|opt-in|plugin|extension|integration|adapter)\b/i.test(description + " " + match.excerpt)) relationship = "integration";
  else if (["apps", "games", "browser", "demos", "agents"].includes(category)) relationship = "jev-app";
  const { score, ...detail } = match;
  return { ...detail, relationship, level: "documented" };
}

export function evidenceIn(readme) { return analyzeEvidence(readme)?.signal || null; }

export function codeEvidence(source) {
  if (!IDENTIFIER.test(source)) return false;
  return /\.system_?one\s*\(|\.systemOne\s*\(|\/v1\/systemone|(?:typesafe-ai|typesafe)\/jev/.test(source);
}

export async function inspectRepository(project, github, { codePaths = [], inspectCode = false } = {}) {
  const { repo, commit } = project;
  let readme, filename;
  for (const file of ["README.md", "readme.md", "Readme.md", "README.rst", "README", "docs/README.md", ".github/README.md", "README.adoc", "README.txt"]) {
    let text;
    try { text = await github.raw(repo, commit, file); }
    catch (error) { if (error.message === "Response too large") break; throw error; }
    if (text !== null) { readme = text; filename = file; break; }
  }
  let evidence = analyzeEvidence(readme, { category: project.cat, description: project.desc, name: project.name });
  if (evidence) evidence = { ...evidence, path: filename, commit, url: `https://github.com/${repo}/blob/${commit}/${filename}#L${evidence.line}` };
  if (inspectCode || !evidence) {
    let paths = [...codePaths];
    if (!paths.length) {
      const tree = await github.api(`/repos/${repo}/git/trees/${commit}?recursive=1`, { immutable: true });
      paths = (tree?.tree || []).filter(file => file.type === "blob" && file.size < 150000 &&
        /(?:jev|typesafe|system.?one)/i.test(file.path) &&
        /\.(?:py|[cm]?js|[jt]sx?|go|rs|zig|java|kt|rb|php|swift|cs|cpp|h|sh)$/.test(file.path) &&
        !/(?:node_modules|vendor|fixtures|snapshots|tests?|__tests__|\.lock|dist)\//.test(file.path)).slice(0, 6).map(file => file.path);
    }
    for (const path of paths) {
      const source = await github.raw(repo, commit, path);
      if (source && codeEvidence(source)) {
        const line = source.split("\n").findIndex(text => IDENTIFIER.test(text)) + 1;
        const match = analyzeEvidence(source, { category: project.cat, description: project.desc, name: project.name });
        evidence = { ...(evidence || match || { relationship: "unclassified" }), level: "code-reference", signal: "source-api-reference", excerpt: source.split("\n").slice(Math.max(0, line - 1), line + 3).join("\n").slice(0, 500), path, commit, line, url: `https://github.com/${repo}/blob/${commit}/${path}#L${line}` };
        break;
      }
    }
  }
  return evidence || null;
}

// Compatibility helper for offline policy tests and external consumers.
export async function auditProjects(projects, { github, concurrency = 8 } = {}) {
  if (!github) throw new Error("auditProjects requires a GitHub client with pinned repository commits");
  const results = await mapLimit(projects, concurrency, async project => {
    try { return { project, evidence: await inspectRepository(project, github) }; }
    catch { return { project, error: "fetch-error" }; }
  });
  return {
    verified: results.filter(r => r.evidence).map(r => ({ ...r.project, verification: r.evidence.level, evidence: r.evidence.url })),
    rejected: results.filter(r => !r.evidence).map(r => ({ name: r.project.name, repo: r.project.repo, reason: r.error || "No qualifying first-party evidence" })),
  };
}
