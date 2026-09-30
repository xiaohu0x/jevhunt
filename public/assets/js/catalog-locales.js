// Static summaries are separate from the shared index so a page downloads only
// its own language. Live D1 data always wins over a build-time overlay.
export function localizeStaticProjects(projects, overlay, locale, live = false) {
  if (live || overlay?.locale !== locale || !overlay.summaries) return projects;
  return projects.map(project => {
    const content = overlay.summaries[String(project.repo || "").toLowerCase()];
    const id = Number(project.id);
    if (!content || !Number.isSafeInteger(id) || id <= 0 || content.repositoryId !== id || typeof content.summary !== "string") return project;
    return { ...project, desc: content.summary };
  });
}

export function staticCatalogIndexUrl(meta) {
  return "./catalog-all.js?v=" + encodeURIComponent(meta?.staticIndexHash || meta?.catalogHash || "snapshot");
}
