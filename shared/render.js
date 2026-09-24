import assetVersions from "./asset-versions.json" with { type: "json" };
export const ORIGIN = "https://jevhunt.com";
export const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const projectPath = repo => "/projects/" + repo.toLowerCase().split("/").map(encodeURIComponent).join("/") + "/";
export const repoUrl = repo => "https://github.com/" + repo.split("/").map(encodeURIComponent).join("/");
export const jsonLd = value => JSON.stringify(value).replace(/</g, "\\u003c");


const asset = path => path + (assetVersions[path] ? "?v=" + assetVersions[path] : "");

export function page({ title, description, path, body, schema, noindex = false, script = "", localeLinks = true }) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)} | JevHunt</title><meta name="description" content="${esc(description.slice(0, 160))}"/>
<link rel="canonical" href="${ORIGIN}${esc(path)}"/>
${noindex ? '<meta name="robots" content="noindex, nofollow"/>' : ''}
<meta property="og:title" content="${esc(title)} | JevHunt"/><meta property="og:description" content="${esc(description.slice(0, 160))}"/>
<meta property="og:type" content="website"/><meta property="og:url" content="${ORIGIN}${esc(path)}"/><meta property="og:image" content="${ORIGIN}/og.png?v=3"/>
<meta name="twitter:card" content="summary_large_image"/><link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml"/>
<link rel="stylesheet" href="${asset("/assets/css/fonts.css")}"/><link rel="stylesheet" href="${asset("/assets/css/style.css")}"/>
${schema ? `<script type="application/ld+json">${jsonLd(schema)}</script>` : ''}
</head><body>
<header class="legal-nav"><div class="nav__inner"><a class="brand" href="/">JEV<span>HUNT</span></a><nav class="legal-nav__links" aria-label="Main navigation"><a href="/browse/">Projects</a><a href="/methodology/">Evidence</a><a href="/status/">Updates</a><a href="/#submit">Submit</a></nav><button class="icon-btn" id="pageTheme" aria-label="Toggle theme">◐</button></div></header>
<main class="legal"><div class="wrap">${body}</div></main>
<footer class="footer"><div class="wrap footer__base"><span>Independent Jev ecosystem directory</span><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/security/">Security</a>${localeLinks ? '<a href="/zh-cn/">简体中文</a><a href="/ja/">日本語</a>' : ''}</div></footer>
<script src="${asset("/assets/js/page.js")}"></script>${script ? `<script type="module" src="${esc(asset(script))}"></script>` : ''}
</body></html>`;
}
