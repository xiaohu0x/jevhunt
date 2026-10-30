import { renderCard } from "./catalog-view.js";
import { esc, projectPath, repoUrl, ORIGIN, alternativesPath } from "./render.js";
import { CATEGORY_IDS, CATEGORY_NAMES } from "./catalog-data.js";
import { projectTaskIds, taskById } from "./catalog-tasks.js";

const RELATION_LABELS = { "jev-app": "Jev application", integration: "Integration", sdk: "SDK / client", "local-alternative": "Local alternative", research: "Research", resource: "Resource / directory", unclassified: "Relationship under review" };
const EVIDENCE_LABELS = { official: "Official", documented: "Documented", "code-reference": "Code reference", reviewed: "Editor reviewed", "legacy-unreviewed": "Needs review" };
const num = value => new Intl.NumberFormat("en-US").format(Number(value) || 0);

const taskNames = project => projectTaskIds(project).slice(0, 3).map(id => taskById(id)?.name).filter(Boolean).join(", ") || "—";

const ROWS = [
  ["Relationship to Jev", project => RELATION_LABELS[project.relationship] || RELATION_LABELS.unclassified],
  ["Evidence", project => EVIDENCE_LABELS[project.evidenceLevel] || EVIDENCE_LABELS["legacy-unreviewed"]],
  ["License", project => !project.license || /^(noassertion|other|none)$/i.test(project.license) ? "Not reported" : project.license],
  ["Language", project => project.language || "Not reported"],
  ["GitHub stars", project => num(project.stars)],
  ["Last code update", project => /^\d{4}-\d{2}-\d{2}$/.test(project.pushed || "") ? project.pushed : "Not reported"],
  ["Repository status", project => project.archived === true ? "Archived" : project.archived === false ? "Not archived" : "Not reported"],
  ["Check status", project => project.freshness === "current" ? "Up to date" : "Check pending"],
  ["Tasks", project => taskNames(project)],
];

export function compareTable(projects, { compact = false } = {}) {
  const columns = projects.map(project => `<th scope="col"><a href="${projectPath(project.repo)}">${esc(project.name)}</a><span class="compare-table__repo">${esc(project.repo)}</span></th>`).join("");
  const rows = ROWS.map(([label, value]) => `<tr><th scope="row">${esc(label)}</th>${projects.map(project => `<td>${esc(value(project))}</td>`).join("")}</tr>`).join("");
  const links = `<tr><th scope="row">Links</th>${projects.map(project => `<td><a href="${repoUrl(project.repo)}" target="_blank" rel="ugc nofollow noopener noreferrer">GitHub ↗</a>${project.evidence ? ` · <a href="${esc(project.evidence)}" target="_blank" rel="ugc nofollow noopener noreferrer">Evidence ↗</a>` : ""}</td>`).join("")}</tr>`;
  return `<div class="compare-scroll"><table class="compare-table${compact ? " compare-table--compact" : ""}"><thead><tr><th scope="col">Compared project</th>${columns}</tr></thead><tbody>${rows}${links}</tbody></table></div>`;
}

export function compareView({ projects }) {
  if (!Array.isArray(projects) || projects.length < 2) {
    return {
      title: "Compare Jev projects",
      description: "Compare two or three Jev projects by relationship, evidence, license, activity and tasks.",
      path: "/compare/",
      noindex: true,
      body: `<header class="legal__header"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">JevHunt</a> / Compare</nav><h1>Compare Jev projects</h1><p class="legal__summary">Pick two or three projects to compare relationship, evidence, license, activity and tasks side by side.</p><p>Add projects from a project page, or start from <a href="/browse/">the directory</a> or <a href="/tasks/">a task</a>.</p></header>`,
    };
  }
  const names = projects.map(project => project.name).join(" vs ");
  const description = `Compare ${names}: Jev relationship, evidence, license, language, activity and tasks side by side.`;
  return {
    title: `Compare ${names}`,
    description,
    path: "/compare/",
    noindex: true,
    body: `<header class="legal__header"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">JevHunt</a> / Compare</nav><h1>${esc(names)}</h1><p class="legal__summary">${esc(description)}</p><p>Comparison uses repository metadata and linked evidence. JevHunt has not run or benchmarked these projects.</p></header>${compareTable(projects)}<p class="compare-note">Need a different combination? <a href="/browse/">Browse the directory</a> and open a project to compare it with its alternatives.</p>`,
  };
}

export function pickAlternatives(project, candidates, limit = 10) {
  const own = project.repo.toLowerCase();
  const relation = project.relationship || "unclassified";
  return candidates
    .filter(candidate => candidate.repo.toLowerCase() !== own)
    .map(candidate => ({ candidate, score: (candidate.relationship === relation ? 2 : 0) + (candidate.cat === project.cat ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || (Number(b.candidate.stars) || 0) - (Number(a.candidate.stars) || 0))
    .slice(0, limit)
    .map(entry => entry.candidate);
}

export function alternativesView({ project, alternatives, categoryName }) {
  const path = alternativesPath(project.repo);
  const name = project.name;
  const category = categoryName || CATEGORY_NAMES[CATEGORY_IDS.indexOf(project.cat)] || project.cat;
  const tableProjects = [project, ...alternatives.slice(0, 3)];
  const firstNames = alternatives.slice(0, 3).map(item => item.name);
  const faq = [
    [`What are the best alternatives to ${name}?`, `${firstNames.length ? firstNames.join(", ") : "No close alternatives yet"} are the closest matches in ${category}, ordered by Jev relationship and traction.`],
    ["How does JevHunt choose these alternatives?", `Alternatives share the ${category} category. We prefer documented Jev relationships, recent activity and higher traction. This is a comparison aid, not a benchmark.`],
    [`Is ${name} open source?`, project.license ? `${name} is published under ${project.license}. Check the repository for the full terms.` : `${name} does not report a license in its repository metadata; check the repository before reuse.`],
  ];
  const description = `Compare ${name} with ${alternatives.length} similar ${category.toLowerCase()} projects, including evidence, license, language, activity and tasks.`;
  const body = `<header class="legal__header"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">JevHunt</a> / <a href="/categories/${esc(project.cat)}/">${esc(category)}</a> / <a href="${projectPath(project.repo)}">${esc(name)}</a> / Alternatives</nav><h1>${esc(name)} alternatives</h1><p class="legal__summary">${esc(description)}</p><p><a class="btn btn--ghost" href="${projectPath(project.repo)}">← Back to ${esc(name)}</a> <a class="btn btn--ghost" href="/compare/?ids=${encodeURIComponent(tableProjects.slice(0, 3).map(item => item.repo).join(","))}">Compare these three →</a></p></header>${compareTable(tableProjects)}<section class="related" aria-labelledby="alternatives-heading"><h2 id="alternatives-heading">More ${esc(category.toLowerCase())} projects</h2><div class="app-grid">${alternatives.map(item => renderCard(item)).join("")}</div></section><section class="alternatives-faq" aria-labelledby="alternatives-faq-heading"><h2 id="alternatives-faq-heading">Questions about ${esc(name)}</h2>${faq.map(([question, answer]) => `<details><summary>${esc(question)}</summary><p>${esc(answer)}</p></details>`).join("")}</section><p><a href="/methodology/">How we review →</a></p>`;
  return {
    title: `${name} alternatives — ${category} for Jev`,
    description,
    path,
    body,
    schema: {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "CollectionPage", "@id": ORIGIN + path + "#alternatives", url: ORIGIN + path, name: `${name} alternatives`, description, inLanguage: "en" },
        { "@type": "ItemList", inLanguage: "en", numberOfItems: alternatives.length, itemListElement: alternatives.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, url: ORIGIN + projectPath(item.repo) })) },
        { "@type": "FAQPage", mainEntity: faq.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) },
        { "@type": "BreadcrumbList", itemListElement: [
          { "@type": "ListItem", position: 1, name: "JevHunt", item: ORIGIN + "/" },
          { "@type": "ListItem", position: 2, name: category, item: `${ORIGIN}/categories/${project.cat}/` },
          { "@type": "ListItem", position: 3, name, item: ORIGIN + projectPath(project.repo) },
          { "@type": "ListItem", position: 4, name: "Alternatives", item: ORIGIN + path },
        ] },
      ],
    },
  };
}
