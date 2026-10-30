import { CATEGORIES } from "./catalog-sections.js";
import { TASK_LIST } from "./catalog-tasks.js";
import { renderCard } from "./catalog-view.js";
import { esc, projectPath, ORIGIN } from "./render.js";

const RELATION_LABELS = { "jev-app": "Jev application", integration: "Integration", sdk: "SDK / client", "local-alternative": "Local alternative", research: "Research", resource: "Resource / directory", unclassified: "Relationship under review" };
const num = value => new Intl.NumberFormat("en-US").format(Number(value) || 0);

const breadcrumbs = items => ({ "@type": "BreadcrumbList", itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: ORIGIN + item.path })) });

export function categoriesIndexView({ projectCount, categoryCounts, samples }) {
  const ids = CATEGORIES.map(category => category.id).filter(id => Object.hasOwn(categoryCounts, id));
  const blocks = CATEGORIES.filter(category => Object.hasOwn(categoryCounts, category.id)).map(category => {
    const count = categoryCounts[category.id] || 0;
    const picks = samples[category.id] || [];
    return `<article class="category-block"><div class="category-block__head"><h2><a href="/categories/${esc(category.id)}/">${esc(category.name)}</a></h2><span class="category-block__count">${num(count)} projects</span></div><p>${esc(category.description)}</p><ul>${picks.slice(0, 3).map(project => `<li><a href="${projectPath(project.repo)}">${esc(project.name)}</a><span>${esc(RELATION_LABELS[project.relationship] || RELATION_LABELS.unclassified)} · ${num(project.stars)} ★</span></li>`).join("")}</ul><a class="category-block__all" href="/categories/${esc(category.id)}/">View all ${num(count)} →</a></article>`;
  }).join("");
  const description = `Browse ${num(projectCount)} Jev projects by category: official SDKs, integrations, agent tooling, browser use, applications, games, demos, research and directories.`;
  return {
    title: "Jev project categories",
    description,
    path: "/categories/",
    body: `<header class="legal__header"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">JevHunt</a> / Categories</nav><h1>Browse Jev projects by category</h1><p class="legal__summary">${esc(description)}</p><p><a href="/tasks/">Start with a task instead →</a></p></header><div class="category-index">${blocks}</div><section class="category-tasks" aria-labelledby="categoryTasks"><div class="home-section-head"><h2 id="categoryTasks">Or start with a task</h2><a class="home-section-link" href="/tasks/">All tasks →</a></div><p class="home-section__lead">Tasks group projects by what they do, not what they are.</p><div class="task-grid">${taskCards()}</div></section>`,
    schema: { "@context": "https://schema.org", "@graph": [
      { "@type": "CollectionPage", "@id": ORIGIN + "/categories/#categories", url: ORIGIN + "/categories/", name: "Jev project categories", description, inLanguage: "en",
        mainEntity: { "@type": "ItemList", numberOfItems: ids.length, itemListElement: ids.map((id, index) => ({ "@type": "ListItem", position: index + 1, url: `${ORIGIN}/categories/${id}/` })) } },
      breadcrumbs([{ name: "JevHunt", path: "/" }, { name: "Categories", path: "/categories/" }]),
    ] },
  };
}

const taskCards = () => TASK_LIST.map(task => `<a class="task-card" href="/tasks/${esc(task.id)}/" lang="en"><span class="task-card__name">${esc(task.name)}</span><span class="task-card__blurb">${esc(task.blurb)}</span><span class="task-card__arrow" aria-hidden="true">→</span></a>`).join("");

export function tasksIndexView({ projectCount }) {
  const description = "Browse Jev projects by task: browser automation, computer use, agent routing, classification, reranking, RAG, evaluation, guardrails, coding agents and more.";
  const cards = TASK_LIST.map(task => `<a class="task-card task-card--wide" href="/tasks/${esc(task.id)}/"><span class="task-card__name">${esc(task.name)}</span><span class="task-card__blurb">${esc(task.description)}</span><span class="task-card__arrow" aria-hidden="true">→</span></a>`).join("");
  return {
    title: "Jev projects by task",
    description,
    path: "/tasks/",
    body: `<header class="legal__header"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">JevHunt</a> / Tasks</nav><h1>Start with a task</h1><p class="legal__summary">${esc(description)}</p><p>${num(projectCount)} projects, grouped by what they do. <a href="/categories/">Browse by category →</a></p></header><div class="task-index">${cards}</div>`,
    schema: { "@context": "https://schema.org", "@graph": [
      { "@type": "CollectionPage", "@id": ORIGIN + "/tasks/#tasks", url: ORIGIN + "/tasks/", name: "Jev projects by task", description, inLanguage: "en",
        mainEntity: { "@type": "ItemList", numberOfItems: TASK_LIST.length, itemListElement: TASK_LIST.map((task, index) => ({ "@type": "ListItem", position: index + 1, url: `${ORIGIN}/tasks/${task.id}/` })) } },
      breadcrumbs([{ name: "JevHunt", path: "/" }, { name: "Tasks", path: "/tasks/" }]),
    ] },
  };
}

export function taskPageView({ task, projects, total, number, pages, messages = {} }) {
  const base = `/tasks/${task.id}/`;
  const path = number === 1 ? base : `${base}${number}/`;
  const pageLabel = number > 1 ? ` — page ${number}` : "";
  const nav = pages > 1 ? `<nav class="catalog-pages" aria-label="Pagination">${number > 1 ? `<a rel="prev" href="${number === 2 ? base : base + (number - 1) + "/"}">← Previous</a>` : ""} <span>Page ${number} of ${pages}</span> ${number < pages ? `<a rel="next" href="${base}${number + 1}/">Next →</a>` : ""}</nav>` : "";
  const related = TASK_LIST.filter(item => item.id !== task.id).slice(0, 6);
  const relatedCards = related.map(item => `<a class="task-card" href="/tasks/${esc(item.id)}/"><span class="task-card__name">${esc(item.name)}</span><span class="task-card__blurb">${esc(item.blurb)}</span></a>`).join("");
  return {
    title: `${task.name} projects built on Jev`,
    description: `${task.description} ${num(total)} source-backed Jev projects for ${task.name.toLowerCase()}.`,
    path,
    body: `<header class="legal__header"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">JevHunt</a> / <a href="/tasks/">Tasks</a> / ${esc(task.name)}</nav><h1>${esc(task.name)}${pageLabel}</h1><p class="legal__summary">${esc(task.description)}</p><p><strong>${num(total)}</strong> active projects match this task, ordered by traction. ${number > 1 ? "" : '<a href="/tasks/">Browse other tasks →</a>'}</p></header>${nav}<div class="app-grid">${projects.map(project => renderCard(project, messages)).join("")}</div>${nav}<section class="related" aria-labelledby="relatedTasks"><h2 id="relatedTasks">Related tasks</h2><div class="task-grid">${relatedCards}</div></section>`,
    schema: { "@context": "https://schema.org", "@graph": [
      { "@type": "CollectionPage", "@id": ORIGIN + base + "#task", url: ORIGIN + path, name: `${task.name} — Jev projects`, description: task.description, inLanguage: "en" },
      { "@type": "ItemList", inLanguage: "en", numberOfItems: projects.length, itemListElement: projects.map((project, index) => ({ "@type": "ListItem", position: (number - 1) * 24 + index + 1, name: project.name, url: ORIGIN + projectPath(project.repo) })) },
      breadcrumbs([{ name: "JevHunt", path: "/" }, { name: "Tasks", path: "/tasks/" }, { name: task.name, path }]),
    ] },
  };
}
