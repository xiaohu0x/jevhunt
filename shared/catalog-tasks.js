import TASKS from "../catalog/tasks.json" with { type: "json" };
import TASK_COPY from "../catalog/task-copy.json" with { type: "json" };

/**
 * Task ("what do you want to build?") taxonomy.
 *
 * A task is a discovery entry point, not a category: one project can belong to
 * several tasks. Matching is deliberately conservative — phrases are matched on
 * word boundaries so "rag" does not hit "storage" — and the taxonomy is
 * data-only so editors can add a task without touching SQL.
 */
export const TASK_LIST = [...TASKS].sort((a, b) => (a.priority || 99) - (b.priority || 99) || a.name.localeCompare(b.name));
export const TASK_IDS = TASK_LIST.map(task => task.id);
export const taskById = id => TASK_LIST.find(task => task.id === id) || null;

/** Localized task name/blurb, falling back to the English taxonomy. */
export function taskName(task, localeKey = "en") {
  if (!task) return "";
  return TASK_COPY[localeKey]?.[task.id]?.name || task.name;
}

export function taskBlurb(task, localeKey = "en") {
  if (!task) return "";
  return TASK_COPY[localeKey]?.[task.id]?.blurb || task.blurb;
}

const normalize = value => String(value ?? "")
  .toLowerCase()
  .replace(/[-_/.:]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export const TASK_TEXT_SQL = `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(name || ' ' || repo || ' ' || COALESCE(json_extract(payload,'$.desc'),'') || ' ' || COALESCE(json_extract(payload,'$.content.summary'),'') || ' ' || COALESCE(language,''), '-', ' '), '_', ' '), '/', ' '), '.', ' '), ':', ' '))`;

export function taskKeywords(task) {
  return [...new Set((task?.keywords || []).map(normalize).filter(Boolean))];
}

/** SQL predicate for a task; values are bound, never interpolated. */
export function taskClause(task) {
  const keywords = taskKeywords(task);
  if (!keywords.length) return { sql: "0", values: [] };
  return {
    sql: "(" + keywords.map(() => `(' ' || ${TASK_TEXT_SQL} || ' ') LIKE ? ESCAPE '\\'`).join(" OR ") + ")",
    values: keywords.map(keyword => `% ${keyword} %`),
  };
}

export function projectTaskIds(project = {}) {
  const text = " " + normalize([project.name, project.repo, project.desc, project.content?.summary, project.language].filter(Boolean).join(" ")) + " ";
  return TASK_LIST.filter(task => taskKeywords(task).some(keyword => text.includes(` ${keyword} `))).map(task => task.id);
}

export function taskMatches(task, project) {
  return projectTaskIds(project).includes(task.id);
}

/** Human-readable task label for a card or project page. */
export function taskLabel(id, messages = {}) {
  const task = taskById(id);
  if (!task) return id;
  return messages[`task.${task.id}.name`] || task.name;
}
