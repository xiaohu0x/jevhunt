/* Shared by the static build, Pages Functions and browser pagination. */
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const relations = { "jev-app": "Jev application", integration: "Integration", sdk: "SDK / client", "local-alternative": "Local alternative", research: "Research", resource: "Resource / directory", unclassified: "Relationship under review" };
const evidence = { official: "Official", documented: "Documented", "code-reference": "Code reference", reviewed: "Editor reviewed", "legacy-unreviewed": "Needs review" };
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function renderProjectCard(project, { messages = {}, basePath = "", locale = "en" } = {}) {
  const text = (key, fallback) => messages[key] || fallback;
  const repo = project.repo || "";
  const path = `${basePath}/projects/${repo.toLowerCase().split("/").map(encodeURIComponent).join("/")}/`;
  const github = `https://github.com/${repo.split("/").map(encodeURIComponent).join("/")}`;
  const relationship = Object.hasOwn(relations, project.relationship) ? project.relationship : "unclassified";
  const level = Object.hasOwn(evidence, project.evidenceLevel) ? project.evidenceLevel : "legacy-unreviewed";
  const name = project.name || repo.split("/").at(-1);
  const stars = new Intl.NumberFormat(locale).format(Number(project.stars) || 0);
  const tags = [
    `<span class="badge badge--catalog" data-kind="${relationship}">${escape(text("relationship." + relationship, relations[relationship]))}</span>`,
    project.language ? `<span class="tag tag--language">${escape(project.language)}</span>` : "",
    validDate(project.pushed) ? `<time class="tag tag--updated" datetime="${project.pushed}">${escape(text("apps.updated", "updated {date}").replace("{date}", project.pushed))}</time>` : `<span class="tag tag--updated">${escape(text("apps.unknownUpdate", "update date unknown"))}</span>`,
    project.archived ? `<span class="tag">${escape(text("apps.archived", "Archived"))}</span>` : "",
    project.fork ? `<span class="tag">${escape(text("apps.fork", "Fork"))}</span>` : "",
    project.freshness && project.freshness !== "current" ? `<span class="tag">${escape(text("apps.stale", "Check pending"))}</span>` : "",
  ].filter(Boolean).join("");
  return `<article class="card"><div class="card__top"><span class="card__avatar" data-kind="${relationship}" aria-hidden="true">${escape(Array.from(name)[0]?.toLocaleUpperCase(locale) || "J")}</span><div class="card__identity"><h2 class="card__heading"><a class="card__name" href="${path}">${escape(name)}</a></h2><div class="card__author">${escape(repo)}</div></div><span class="card__stat" aria-label="${escape(text("apps.starsLabel", "{count} GitHub stars").replace("{count}", stars))}"><span aria-hidden="true">★</span> ${stars}</span></div>
<a class="card__descLink" href="${path}"><p class="card__desc">${escape(project.desc || text("apps.noDescription", "No project description available."))}</p></a><div class="card__tags">${tags}</div>
<div class="card__foot"><span class="card__links"><a class="card__details" href="${path}">${escape(text("apps.details", "Details"))} <span aria-hidden="true">→</span></a><a class="card__go" href="${github}" target="_blank" rel="ugc nofollow noopener noreferrer">GitHub <span aria-hidden="true">↗</span></a>${project.evidence ? `<a class="card__site" href="${escape(project.evidence)}" title="${escape(text("evidence." + level, evidence[level]))}" target="_blank" rel="ugc nofollow noopener noreferrer">${escape(text("apps.evidence", "Evidence"))} <span aria-hidden="true">↗</span></a>` : ""}</span></div></article>`;
}
