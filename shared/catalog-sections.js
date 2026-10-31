import { TASK_LIST, taskById, taskName, taskBlurb } from "./catalog-tasks.js";
import CATEGORIES from "../catalog/categories.json" with { type: "json" };
import { projectTileHtml } from "./catalog-launches.js";
import { esc, projectPath } from "./render.js";

const number = lang => new Intl.NumberFormat(lang || "en");

export function taskCardsHtml({ limit = TASK_LIST.length, localeKey = "en", basePath = "" } = {}) {
  const lang = basePath ? "" : ' hreflang="en"';
  return TASK_LIST.slice(0, limit).map(task => `<a class="task-card" href="${basePath}/tasks/${esc(task.id)}/"${lang}><span class="task-card__name">${esc(taskName(task, localeKey))}</span><span class="task-card__blurb">${esc(taskBlurb(task, localeKey))}</span><span class="task-card__arrow" aria-hidden="true">→</span></a>`).join("");
}

const HINT_TASKS = ["browser-automation", "rag-retrieval", "classification", "local-models", "agent-routing"];

export function searchHintsHtml(localeKey = "en", basePath = "") {
  const lang = basePath ? "" : ' hreflang="en"';
  return HINT_TASKS.map(id => {
    const task = taskById(id);
    return task ? `<a href="${basePath}/tasks/${esc(id)}/"${lang}>${esc(taskName(task, localeKey))}</a>` : "";
  }).filter(Boolean).join("");
}

export function featuredCardsHtml(projects, messages = {}, { basePath = "", locale = "en" } = {}) {
  const stars = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  return projects.map(project => {
    const count = Number(project.stars) || 0;
    const label = (messages["apps.starsLabel"] || "{count} GitHub stars").replace("{count}", () => new Intl.NumberFormat(locale).format(count));
    return `<a class="pick" href="${projectPath(project.repo, basePath)}">${projectTileHtml(project, locale)}<span class="pick__body"><span class="pick__top"><span class="pick__name">${esc(project.name)}</span><span class="pick__stars" aria-label="${esc(label)}"><span aria-hidden="true">★</span> ${esc(stars.format(count))}</span></span><span class="pick__desc">${esc(project.desc || messages["apps.noDescription"] || "No project description available.")}</span></span></a>`;
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
