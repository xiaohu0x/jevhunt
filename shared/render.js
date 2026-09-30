import assetVersions from "./asset-versions.json" with { type: "json" };
import { LOCALES } from "./locales.js";
import { editorialNavigation } from "./editorial-routes.js";
export const ORIGIN = "https://jevhunt.com";
export const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const projectPath = (repo, prefix = "") => `${prefix}/projects/` + repo.toLowerCase().split("/").map(encodeURIComponent).join("/") + "/";
export const repoUrl = repo => "https://github.com/" + repo.split("/").map(encodeURIComponent).join("/");
export const jsonLd = value => JSON.stringify(value).replace(/</g, "\\u003c");


const asset = path => path + (assetVersions[path] ? "?v=" + assetVersions[path] : "");

export function page({ title, description, path, body, schema, noindex = false, script = "", localeLinks = true, localeKey = "en", localeInfo = null, messages = {}, localePrefix = "", styles = [], bodyClass = "", ogType = "website" }) {
  const t = (key, fallback) => messages[key] || fallback;
  const lang = localeInfo?.lang || "en";
  const link = value => localePrefix + value;
  const directory = localePrefix ? `${localePrefix}/#apps` : "/browse/";
  const projectSuffix = path.match(/\/projects\/(.+)$/)?.[1] || "";
  const footerLocales = localeLinks
    ? Object.entries(LOCALES).map(([key, locale]) => `<a href="${projectSuffix ? `${locale.path}projects/${projectSuffix}` : locale.path}" lang="${esc(locale.lang)}" hreflang="${esc(locale.hreflang)}"${key === localeKey ? " aria-current=\"page\"" : ""}>${esc(locale.label || locale.lang)}</a>`).join("")
    : "";
  const alternates = projectSuffix && !noindex ? Object.values(LOCALES).map(locale => `<link rel="alternate" hreflang="${esc(locale.hreflang)}" href="${ORIGIN}${locale.path}projects/${esc(projectSuffix)}"/>`).join("") + `<link rel="alternate" hreflang="x-default" href="${ORIGIN}/projects/${esc(projectSuffix)}"/>` : "";
  return `<!DOCTYPE html>
<html lang="${esc(lang)}" data-locale="${esc(localeKey)}" data-theme="light"><head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-7QNDGTH1T4"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-7QNDGTH1T4');
</script>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<script>try{document.documentElement.dataset.theme=localStorage.getItem('jh-theme')==='dark'?'dark':'light'}catch{}</script>
<title>${esc(title)} | JevHunt</title><meta name="description" content="${esc(description)}"/>
<link rel="canonical" href="${ORIGIN}${esc(path)}"/>
${alternates}
${noindex ? '<meta name="robots" content="noindex, nofollow"/>' : ''}
<meta property="og:title" content="${esc(title)} | JevHunt"/><meta property="og:description" content="${esc(description)}"/>
<meta property="og:type" content="${esc(ogType)}"/><meta property="og:url" content="${ORIGIN}${esc(path)}"/><meta property="og:image" content="${ORIGIN}/og.png?v=3"/>
<meta name="twitter:card" content="summary_large_image"/><meta name="twitter:title" content="${esc(title)} | JevHunt"/><meta name="twitter:description" content="${esc(description)}"/><link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml"/>
<link rel="stylesheet" href="${asset("/assets/css/fonts.css")}"/><link rel="stylesheet" href="${asset("/assets/css/style.css")}"/><link rel="stylesheet" href="${asset("/assets/css/directory.css")}"/>
${styles.map(path => `<link rel="stylesheet" href="${esc(asset(path))}"/>`).join("")}
${schema ? `<script type="application/ld+json">${jsonLd(schema)}</script>` : ''}
</head><body class="directory-detail${bodyClass ? " " + esc(bodyClass) : ""}">
<header class="legal-nav"><div class="nav__inner"><a class="brand" href="${link("/")}">JEV<span>HUNT</span></a><nav class="legal-nav__links" aria-label="${esc(t("nav.apps", "Main navigation"))}"><a href="${directory}">${esc(t("nav.apps", "Projects"))}</a>${editorialNavigation(localeKey).map(item => `<a href="${item.path}" lang="${esc(item.lang)}">${esc(item.label)}</a>`).join("")}<a href="/methodology/">${esc(t("apps.evidence", "Evidence"))}</a><a href="/status/">${esc(t("apps.status", "Updates"))}</a><a href="${link("/#submit")}">${esc(t("nav.submit", "Submit"))}</a></nav><button class="icon-btn" id="pageTheme" aria-label="${esc(t("a11y.theme", "Toggle theme"))}">◐</button></div></header>
<main class="legal"><div class="wrap">${body}</div></main>
<footer class="footer"><div class="wrap footer__base"><span>${esc(t("foot.blurb", "Independent Jev ecosystem directory"))}</span><a href="/privacy/">${esc(t("foot.privacy", "Privacy"))}</a><a href="/terms/">${esc(t("foot.terms", "Terms"))}</a><a href="/security/">${esc(t("foot.security", "Security"))}</a>${footerLocales}</div></footer>
<script src="${asset("/assets/js/analytics.js")}" defer></script><script src="${asset("/assets/js/page.js")}"></script>${script ? `<script type="module" src="${esc(asset(script))}"></script>` : ''}
</body></html>`;
}
