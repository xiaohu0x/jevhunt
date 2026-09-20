#!/usr/bin/env node
/**
 * Stamps ?v=<content-hash> onto local CSS/JS references.
 *
 * Why: Cloudflare Pages serves /assets/* with a long max-age, so after a
 * deploy browsers keep running the previous bundle. Hashing the file contents
 * into the URL gives every revision a distinct cache key — long TTLs stay
 * safe. Deterministic: re-running with unchanged assets is a no-op.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");

const ASSETS = [
  "assets/css/fonts.css",
  "assets/css/style.css",
  "assets/js/data.js",
  "assets/js/main.js",
];

const PAGES = ["index.html", "404.html"];

const hash = (rel) =>
  createHash("sha256").update(readFileSync(join(pub, rel))).digest("hex").slice(0, 10);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stamped = ASSETS.map((rel) => [rel, hash(rel)]);

for (const page of PAGES) {
  const file = join(pub, page);
  let html = readFileSync(file, "utf8");
  for (const [rel, v] of stamped) {
    const re = new RegExp(`(["'/]${escape(rel)})(?:\\?v=[0-9a-f]+)?(["'])`, "g");
    html = html.replace(re, (_m, pre, post) => `${pre}?v=${v}${post}`);
  }
  writeFileSync(file, html);
}

console.log("stamped:");
for (const [rel, v] of stamped) console.log(`  ${rel}?v=${v}`);
