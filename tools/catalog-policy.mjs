const README_FILES = [
  "README.md",
  "readme.md",
  "Readme.md",
  "README",
  "README.rst",
  "README.adoc",
  "README.txt",
];

export const POLICY_VERSION = "repository-readme-v3";

const EVIDENCE_PATTERNS = [
  ["jev-model-id", /\b(?:jev-latest|jev-\d+(?:\.\d+)?|typesafe\/jev(?:-\d+(?:\.\d+)?)?)\b/i],
  ["jev-api-key", /\bJEV_API_KEY\b/i],
  ["system-one-api", /\/v1\/systemone\b/i],
  ["typesafe-sdk", /@typesafe-ai\/|\btypesafe[-_](?:sdk|client)\b/i],
  ["typesafe-api-key", /\bTYPESAFE_API_KEY\b/i],
  ["typesafe-jev", /\btypesafe(?:\s+ai)?(?:['’]s)?[\s/:-]+jev\b/i],
  ["typesafe-system-one", /(?=[\s\S]*\btypesafe\b)(?=[\s\S]*\bsystem[\s-]*one\b)/i],
  ["typesafe-and-jev", /(?=[\s\S]*(?:typesafe\.ai\b|\btypesafe\s+ai(?:['’]s)?\b))(?=[\s\S]*\bjev\b)/i],
  ["jev-system-one", /(?:\bjev\b[\s\S]{0,160}\bsystem[\s-]*one\b|\bsystem[\s-]*one\b[\s\S]{0,160}\bjev\b)/i],
  ["jev-decision-context", /(?:\bjev\b[\s\S]{0,120}\b(?:decision|judg(?:e|ment)|noul|calibrat(?:ed|ion)|typed\s+(?:answer|decision|output)|probabilit(?:y|ies))\b|\b(?:decision|judg(?:e|ment)|noul|calibrat(?:ed|ion)|typed\s+(?:answer|decision|output)|probabilit(?:y|ies))\b[\s\S]{0,120}\bjev\b)/i],
];

const OPERATIONAL_CONTEXT = /\b(?:api|automation|benchmark|calls?|classif(?:y|ier|ication)|decision|evaluate|evaluation|harness|integration|judge|judgment|model|plugin|powered|requests?|sdk|using|uses?)\b/i;

export function evidenceIn(readme) {
  for (const [signal, pattern] of EVIDENCE_PATTERNS) {
    if (pattern.test(readme)) return signal;
  }
  const jevMentions = readme.match(/\bjev\b/gi)?.length || 0;
  if (jevMentions >= 2 && OPERATIONAL_CONTEXT.test(readme)) return "jev-operational";
  return null;
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/plain",
          "user-agent": "JevHunt catalog verifier",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 404) return null;
      if (response.ok) return response.text();
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error(`README download failed for ${url}: ${lastError?.message || "unknown error"}`);
}

async function readRepositoryReadme(repo) {
  for (const filename of README_FILES) {
    const url = `https://raw.githubusercontent.com/${repo}/HEAD/${filename}`;
    const readme = await fetchWithRetry(url);
    if (readme !== null) return { filename, readme };
  }
  return null;
}

function withVerification(project, signal, filename = null) {
  return {
    ...project,
    verification: signal,
    evidence: filename
      ? `https://github.com/${project.repo}/blob/HEAD/${filename}`
      : `https://github.com/${project.repo}#readme`,
  };
}

export async function auditProjects(projects, { concurrency = 12, onProgress } = {}) {
  const results = new Array(projects.length);
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < projects.length) {
      const index = cursor++;
      const project = projects[index];
      const owner = project.repo.split("/")[0].toLowerCase();

      if (owner === "typesafe-ai") {
        results[index] = { project: withVerification(project, "official-owner"), accepted: true };
      } else {
        const result = await readRepositoryReadme(project.repo);
        if (!result) {
          results[index] = { project, accepted: false, reason: "README not found" };
        } else {
          const signal = evidenceIn(result.readme);
          results[index] = signal
            ? { project: withVerification(project, `readme:${signal}`, result.filename), accepted: true }
            : { project, accepted: false, reason: "README has no qualifying Jev or System One evidence" };
        }
      }

      completed++;
      if (onProgress && (completed % 50 === 0 || completed === projects.length)) {
        onProgress(completed, projects.length);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, projects.length) }, worker));

  return {
    verified: results.filter(result => result.accepted).map(result => result.project),
    rejected: results.filter(result => !result.accepted).map(result => ({
      name: result.project.name,
      repo: result.project.repo,
      reason: result.reason,
    })),
  };
}
