import { readFileSync, writeFileSync } from "node:fs";
import { loadData, projectPath, hash } from "./lib/site.mjs";
const { apps, i18n } = loadData();
const info = JSON.parse(readFileSync("public/build-info.json", "utf8"));
const paths = ["/404.html", "/privacy/", "/terms/", "/security/",
  ...["data", "projects", "catalog-all", "main", "catalog-state", "page", "admin"].map(name => `/assets/js/${name}.js`),
  "/assets/css/style.css", "/assets/css/fonts.css", ...Object.keys(i18n.locales).map(key => `/assets/js/locales/${key}.js`)];
const assets = [...new Set(paths)].map(path => ({ path, hash: hash(readFileSync("public" + path + (path.endsWith("/") ? "index.html" : ""))) }));
const buildId = hash(JSON.stringify({ commit: info.commit, assets }));
writeFileSync("public/build-info.json", JSON.stringify({ ...info, buildId, assets }) + "\n");
console.log(`Build identity: ${buildId}; catalog ${info.catalogHash}.`);

writeFileSync("shared/asset-versions.json", JSON.stringify(Object.fromEntries(["/assets/css/fonts.css", "/assets/css/style.css", "/assets/js/page.js", "/assets/js/status.js", "/assets/js/admin.js"].map(path => [path, hash(readFileSync("public" + path)).slice(0, 10)])), null, 2) + "\n");
