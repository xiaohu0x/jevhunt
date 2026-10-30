import { renderCard } from "./catalog-view.js";
import { TASK_LIST, taskById, taskName, taskBlurb } from "./catalog-tasks.js";
import CATEGORIES from "../catalog/categories.json" with { type: "json" };
import { esc, projectPath } from "./render.js";

const RELATION_LABELS = {
  "jev-app": "Jev application",
  integration: "Integration",
  sdk: "SDK / client",
  "local-alternative": "Local alternative",
  research: "Research",
  resource: "Resource / directory",
  unclassified: "Relationship under review",
};

const number = lang => new Intl.NumberFormat(lang || "en");

export function taskCardsHtml({ limit = TASK_LIST.length, localeKey = "en" } = {}) {
  return TASK_LIST.slice(0, limit).map(task => `<a class="task-card" href="/tasks/${esc(task.id)}/" hreflang="en"><span class="task-card__name">${esc(taskName(task, localeKey))}</span><span class="task-card__blurb">${esc(taskBlurb(task, localeKey))}</span><span class="task-card__arrow" aria-hidden="true">→</span></a>`).join("");
}

const HINT_TASKS = ["browser-automation", "rag-retrieval", "classification", "local-models", "agent-routing"];

export function searchHintsHtml(localeKey = "en") {
  return HINT_TASKS.map(id => {
    const task = taskById(id);
    return task ? `<a href="/tasks/${esc(id)}/" hreflang="en">${esc(taskName(task, localeKey))}</a>` : "";
  }).filter(Boolean).join("");
}

export function featuredCardsHtml(projects, messages = {}, { basePath = "", locale = "en" } = {}) {
  return projects.map(project => renderCard(project, messages, { basePath, locale })).join("");
}

export function newListHtml(projects, messages = {}, { basePath = "", locale = "en", lang = "en" } = {}) {
  const format = new Intl.DateTimeFormat(lang || "en", { dateStyle: "medium", timeZone: "UTC" });
  return projects.map(project => {
    const relationship = RELATION_LABELS[project.relationship] || RELATION_LABELS.unclassified;
    const label = messages[`relationship.${project.relationship}`] || relationship;
    const date = project.added || project.pushed || "";
    const pretty = /^\d{4}-\d{2}-\d{2}$/.test(date) ? format.format(new Date(date + "T12:00:00Z")) : "";
    return `<li class="new-item"><a class="new-item__name" href="${projectPath(project.repo, basePath)}">${esc(project.name)}</a><span class="new-item__meta">${esc(label)}${project.language ? ` · ${esc(project.language)}` : ""}</span>${pretty ? `<time class="new-item__date" datetime="${esc(date)}">${esc(pretty)}</time>` : ""}</li>`;
  }).join("");
}

export function categoryCardsHtml(counts = {}, messages = {}, { localePrefix = "", lang = "en" } = {}) {
  const format = number(lang);
  return CATEGORIES.filter(category => Object.hasOwn(counts, category.id)).map(category => {
    const name = messages[`category.${category.id}.name`] || category.name;
    const href = localePrefix ? `${localePrefix}/?category=${encodeURIComponent(category.id)}#apps` : `/categories/${category.id}/`;
    return `<a class="category-card" href="${esc(href)}"><span class="category-card__name">${esc(name)}</span><span class="category-card__count">${format.format(counts[category.id] || 0)}</span>${localePrefix ? "" : `<span class="category-card__blurb">${esc(category.blurb)}</span>`}</a>`;
  }).join("");
}

export { CATEGORIES };
