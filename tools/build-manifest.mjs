import { readFileSync, writeFileSync } from "node:fs";
import { loadData, projectPath, hash } from "./lib/site.mjs";
import { EDITORIAL_ROUTES } from "../shared/editorial-routes.js";
const { apps, i18n } = loadData();
const info = JSON.parse(readFileSync("public/build-info.json", "utf8"));
const paths = ["/404.html", "/privacy/", "/terms/", "/security/",
  ...["data", "projects", "catalog-all", "main", "catalog-state", "catalog-locales", "project-card", "page", "admin", "analytics"].map(name => `/assets/js/${name}.js`),
  "/assets/css/style.css", "/assets/css/fonts.css", "/assets/css/directory.css", "/assets/css/editorial.css", "/assets/js/faq.js", ...Object.keys(i18n.locales).map(key => `/assets/js/locales/${key}.js`), ...EDITORIAL_ROUTES.map(entry => entry.path)];
const assets = [...new Set(paths)].map(path => ({ path, hash: hash(readFileSync("public" + path + (path.endsWith("/") ? "index.html" : ""))) }));
const buildId = hash(JSON.stringify({ commit: info.commit, assets }));
writeFileSync("public/build-info.json", JSON.stringify({ ...info, buildId, assets }) + "\n");
console.log(`Build identity: ${buildId}; catalog ${info.catalogHash}.`);

writeFileSync("shared/asset-versions.json", JSON.stringify(Object.fromEntries(["/assets/css/fonts.css", "/assets/css/style.css", "/assets/css/directory.css", "/assets/css/editorial.css", "/assets/js/page.js", "/assets/js/status.js", "/assets/js/admin.js", "/assets/js/analytics.js"].map(path => [path, hash(readFileSync("public" + path)).slice(0, 10)])), null, 2) + "\n");
