export const SORTS = ["stars-desc", "stars-asc", "created-desc", "created-asc", "updated-desc", "added-desc", "name-asc"];
export const KINDS = ["jev-app", "integration", "sdk", "local-alternative", "research", "resource", "unclassified"];

export function readCatalogState(url, categories = []) {
  const params = new URL(url).searchParams;
  const filter = params.get("category") || "all";
  const sort = params.get("sort") || "stars-desc";
  const kind = params.get("kind") || "all";
  const activity = params.get("activity") || "all";
  const page = Math.min(1000, Math.max(1, parseInt(params.get("page"), 10) || 1));
  return {
    query: (params.get("q") || "").slice(0, 300),
    filter: categories.includes(filter) ? filter : "all",
    sort: SORTS.includes(sort) ? sort : "stars-desc",
    kind: KINDS.includes(kind) ? kind : "all",
    language: (params.get("language") || "all").slice(0, 50),
    activity: ["active", "archived"].includes(activity) ? activity : "all",
    visible: page * 20,
  };
}

export function catalogUrl(url, state) {
  const output = new URL(url);
  for (const [key, value, fallback] of [
    ["q", state.query.trim(), ""], ["category", state.filter, "all"], ["sort", state.sort, "stars-desc"],
    ["kind", state.kind, "all"], ["language", state.language, "all"], ["activity", state.activity, "all"],
    ["page", Math.ceil(state.visible / 20), 1],
  ]) {
    if (value === fallback) output.searchParams.delete(key);
    else output.searchParams.set(key, String(value));
  }
  return output.pathname + output.search + output.hash;
}

export function matchesProject(project, state, label = id => id) {
  const query = state.query.trim().toLowerCase();
  return (state.filter === "all" || project.cat === state.filter)
    && (state.kind === "all" || project.relationship === state.kind)
    && (state.language === "all" || (project.language || "unknown") === state.language)
    && (state.activity === "all" || (state.activity === "archived" ? project.archived === true : project.archived === false))
    && (!query || [project.name, project.repo, project.desc, project.language, label(project.cat)].filter(Boolean).join(" ").toLowerCase().includes(query));
}

export const projectPath = repo => "/projects/" + repo.toLowerCase().split("/").map(encodeURIComponent).join("/") + "/";
