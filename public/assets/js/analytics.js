/* Measure discovery actions without collecting raw search text. */
(function () {
  "use strict";
  window.JH = window.JH || {};
  const events = new Set(["catalog_view", "no_results", "project_open", "recommendation_click", "outbound_click"]);
  const fields = new Set(["page", "result_count", "query_length", "category", "kind", "language", "sort", "project", "placement", "destination"]);
  window.JH.track = function (event, values = {}) {
    if (!events.has(event) || typeof window.gtag !== "function") return;
    const payload = { locale: document.documentElement.dataset.locale || document.documentElement.lang || "en" };
    for (const [key, value] of Object.entries(values)) {
      if (fields.has(key) && ["string", "number"].includes(typeof value)) payload[key] = typeof value === "string" ? value.slice(0, 160) : value;
    }
    window.gtag("event", event, payload);
  };
  document.addEventListener("click", event => {
    const anchor = event.target.closest?.("a[href]");
    if (!anchor) return;
    const url = new URL(anchor.href, location.href);
    const match = url.pathname.match(/\/projects\/([^/]+\/[^/]+)\/?$/);
    if (url.origin === location.origin && match && anchor.closest(".card")) {
      const section = anchor.closest(".related");
      window.JH.track(section ? "recommendation_click" : "project_open", {
        project: match[1], placement: section?.id || "directory",
      });
    } else if (url.origin !== location.origin && anchor.closest(".card, .legal__header, .project-detail")) {
      window.JH.track("outbound_click", { destination: url.hostname, placement: anchor.closest(".card") ? "card" : "project" });
    }
  });
})();
