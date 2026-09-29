import { esc } from "./render.js";

// Crawlable first response; the browser enhances these links in place.
export function renderCatalogPagination(url, pagination, messages = {}) {
  const { page, totalPages, start, end, total } = pagination;
  if (!total) return "";
  const text = (key, fallback) => messages[key] || fallback;
  const link = (target, label, rel = "") => {
    const next = new URL(url);
    next.searchParams.delete("all"); next.searchParams.delete("full"); next.searchParams.delete("per_page");
    if (target === 1) next.searchParams.delete("page"); else next.searchParams.set("page", String(target));
    next.hash = "apps";
    return `<a href="${esc(next.pathname + next.search + next.hash)}" data-page="${target}"${rel ? ` rel="${rel}"` : ""}${target === page ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
  };
  const numbers = [...new Set([1, page - 1, page, page + 1, totalPages])].filter(n => n > 0 && n <= totalPages).sort((a, b) => a - b);
  const label = text("apps.page", "Page {page} of {pages}").replace("{page}", page).replace("{pages}", totalPages);
  const links = numbers.map((n, i) => `${i && n - numbers[i - 1] > 1 ? '<span class="catalog-pages__gap" aria-hidden="true">…</span>' : ""}${link(n, n)}`).join("");
  return `<span class="catalog-pages__summary">${esc(label)} <span class="catalog-pages__range">${start}–${end} / ${total}</span></span><span class="catalog-pages__links">${page > 1 ? link(page - 1, text("apps.previous", "Previous"), "prev") : ""}${links}${page < totalPages ? link(page + 1, text("apps.next", "Next"), "next") : ""}</span>`;
}
