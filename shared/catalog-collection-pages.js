import { renderCard } from "./catalog-view.js";
import { esc, ORIGIN, projectPath } from "./render.js";
import { COLLECTION_LIST, collectionById } from "./catalog-collections.js";

const num = value => new Intl.NumberFormat("en-US").format(Number(value) || 0);
const rel = ["browser-agents"];

export function collectionsIndexView({ projectCount, counts = {} }) {
  const description = `Curated Jev collections: official resources, SDKs, browser agents, local alternatives, research, coding agents and ${projectCount ? num(projectCount) + " projects" : "more"}.`;
  const cards = COLLECTION_LIST.map(collection => `<a class="collection-card" href="/collections/${esc(collection.id)}/"><span class="collection-card__name">${esc(collection.name)}</span><span class="collection-card__blurb">${esc(collection.blurb)}</span><span class="collection-card__count">${num(counts[collection.id] || 0)} projects</span></a>`).join("");
  return {
    title: "Curated Jev project collections",
    description,
    path: "/collections/",
    body: `<header class="legal__header"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">JevHunt</a> / Collections</nav><h1>Curated Jev collections</h1><p class="legal__summary">${esc(description)}</p><p>Collections are rule-based views over the same evidence-checked catalog. <a href="/tasks/">Browse by task</a> or <a href="/categories/">by category</a>.</p></header><div class="collection-grid">${cards}</div>`,
    schema: { "@context": "https://schema.org", "@graph": [
      { "@type": "CollectionPage", "@id": ORIGIN + "/collections/#collections", url: ORIGIN + "/collections/", name: "Curated Jev project collections", description, inLanguage: "en",
        mainEntity: { "@type": "ItemList", numberOfItems: COLLECTION_LIST.length, itemListElement: COLLECTION_LIST.map((collection, index) => ({ "@type": "ListItem", position: index + 1, url: `${ORIGIN}/collections/${collection.id}/` })) } },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "JevHunt", item: ORIGIN + "/" },
        { "@type": "ListItem", position: 2, name: "Collections", item: ORIGIN + "/collections/" },
      ] },
    ] },
  };
}

export function collectionPageView({ collection, projects, total, number, pages }) {
  const base = `/collections/${collection.id}/`;
  const path = number === 1 ? base : `${base}${number}/`;
  const pageLabel = number > 1 ? ` — page ${number}` : "";
  const nav = pages > 1 ? `<nav class="catalog-pages" aria-label="Pagination">${number > 1 ? `<a rel="prev" href="${number === 2 ? base : base + (number - 1) + "/"}">← Previous</a>` : ""} <span>Page ${number} of ${pages}</span> ${number < pages ? `<a rel="next" href="${base}${number + 1}/">Next →</a>` : ""}</nav>` : "";
  const related = COLLECTION_LIST.filter(item => item.id !== collection.id).slice(0, 4);
  return {
    title: `${collection.name} — Jev projects`,
    description: collection.description,
    path,
    body: `<header class="legal__header"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">JevHunt</a> / <a href="/collections/">Collections</a> / ${esc(collection.name)}</nav><h1>${esc(collection.name)}${pageLabel}</h1><p class="legal__summary">${esc(collection.description)}</p><p><strong>${num(total)}</strong> active projects in this collection. <a href="/collections/">All collections →</a></p></header>${nav}<div class="app-grid">${projects.map(project => renderCard(project)).join("")}</div>${nav}<section class="related" aria-labelledby="related-collections"><h2 id="related-collections">Other collections</h2><div class="collection-grid collection-grid--compact">${related.map(item => `<a class="collection-card" href="/collections/${esc(item.id)}/"><span class="collection-card__name">${esc(item.name)}</span><span class="collection-card__blurb">${esc(item.blurb)}</span></a>`).join("")}</div></section>`,
    schema: { "@context": "https://schema.org", "@graph": [
      { "@type": "CollectionPage", "@id": ORIGIN + base + "#collection", url: ORIGIN + path, name: `${collection.name} — Jev projects`, description: collection.description, inLanguage: "en" },
      { "@type": "ItemList", inLanguage: "en", numberOfItems: projects.length, itemListElement: projects.map((project, index) => ({ "@type": "ListItem", position: (number - 1) * 24 + index + 1, name: project.name, url: ORIGIN + projectPath(project.repo) })) },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "JevHunt", item: ORIGIN + "/" },
        { "@type": "ListItem", position: 2, name: "Collections", item: ORIGIN + "/collections/" },
        { "@type": "ListItem", position: 3, name: collection.name, item: ORIGIN + path },
      ] },
    ] },
  };
}
