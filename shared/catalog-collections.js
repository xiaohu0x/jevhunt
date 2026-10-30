import COLLECTIONS from "../catalog/collections.json" with { type: "json" };
import { taskById, taskClause, projectTaskIds } from "./catalog-tasks.js";

export const COLLECTION_LIST = COLLECTIONS.map(collection => ({ ...collection }));
export const collectionById = id => COLLECTION_LIST.find(collection => collection.id === id) || null;

/** SQL predicate for a rule-based collection; values are always bound. */
export function collectionWhere(collection) {
  const filter = collection?.filter || {};
  if (filter.category) return { sql: "category = ?", values: [filter.category] };
  if (filter.relationship) return { sql: "relationship = ?", values: [filter.relationship] };
  if (filter.task) {
    const task = taskById(filter.task);
    if (!task) return { sql: "0", values: [] };
    return taskClause(task);
  }
  return { sql: "0", values: [] };
}

/** JS equivalent used by the static build. */
export function collectionMatches(collection, project) {
  const filter = collection?.filter || {};
  if (filter.category) return project.cat === filter.category;
  if (filter.relationship) return project.relationship === filter.relationship;
  if (filter.task) return projectTaskIds(project).includes(filter.task);
  return false;
}
