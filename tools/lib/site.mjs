import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
export * from "../../shared/render.js";
export function loadData() {
  const sandbox = { window: { JH: {} } }; sandbox.JH = sandbox.window.JH;
  for (const name of ["i18n", "data"]) runInNewContext(readFileSync(`public/assets/js/${name}.js`, "utf8"), sandbox);
  const catalog = JSON.parse(readFileSync("public/catalog.json", "utf8"));
  return { ...sandbox.JH, apps: catalog.apps, catalogMeta: catalog.meta };
}
export const hash = value => createHash("sha256").update(value).digest("hex").slice(0, 20);
