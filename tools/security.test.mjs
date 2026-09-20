import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeNext } from "../functions/_lib/auth.js";
import { normalizeGitHubRepoUrl } from "../functions/api/submissions.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(resolve(root, file), "utf8");
const index = read("public/index.html");
const main = read("public/assets/js/main.js");
const i18n = read("public/assets/js/i18n.js");
const projects = read("public/assets/js/projects.js");
const headers = read("public/_headers");

function publicTextFiles(path = resolve(root, "public")) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? publicTextFiles(child) : [child];
  }).filter(file => !/\.(?:ico|png|woff2?)$/i.test(file));
}

test("the public catalog exposes only GitHub repository and README links", () => {
  assert.doesNotMatch(projects, /"site":/);
  assert.doesNotMatch(main, /a\.site/);
  assert.doesNotMatch(index, />site\s*<span aria-hidden="true">↗<\/span>/i);
  assert.match(main, /rel="ugc nofollow noopener noreferrer">GitHub/);
  assert.match(main, /rel="ugc nofollow noopener noreferrer">README/);
});

test("public assets contain no removed API marketplace promotion", () => {
  const removedBrand = new RegExp(["omni", "akey"].join(""), "i");
  for (const file of publicTextFiles()) {
    assert.doesNotMatch(readFileSync(file, "utf8"), removedBrand, file);
  }
});

test("project submissions accept only canonical GitHub repository URLs", () => {
  assert.equal(normalizeGitHubRepoUrl("https://github.com/typesafe-ai/skills"), "https://github.com/typesafe-ai/skills");
  assert.equal(normalizeGitHubRepoUrl("https://github.com/typesafe-ai/skills.git/"), "https://github.com/typesafe-ai/skills");

  for (const value of [
    "http://github.com/typesafe-ai/skills",
    "https://github.com/typesafe-ai/skills/issues",
    "https://github.com/typesafe-ai/skills?tab=readme",
    "https://github.com.evil.example/typesafe-ai/skills",
    "https://evil.example/phishing",
    "javascript:alert(1)",
  ]) {
    assert.equal(normalizeGitHubRepoUrl(value), null, value);
  }
});

test("trust pages and a security contact are published", () => {
  for (const path of ["privacy", "terms", "security"]) {
    const page = read(`public/${path}/index.html`);
    assert.match(page, new RegExp(`<link rel="canonical" href="https://jevhunt\\.com/${path}/"`));
    assert.match(index, new RegExp(`href="/${path}/"`));
  }
  const securityTxt = read("public/.well-known/security.txt");
  assert.match(securityTxt, /^Contact: https:\/\/github\.com\/xiaohu0x\/jevhunt\/security/m);
  assert.match(securityTxt, /^Canonical: https:\/\/jevhunt\.com\/\.well-known\/security\.txt/m);
});

test("the home page explains authentication and sensitive-data boundaries", () => {
  assert.match(index, /Browsing JevHunt never requires an account/);
  assert.match(index, /never asks for your Google password, JEV API key, or payment details/);
  assert.match(index, /id="subConsent" required/);
  assert.match(i18n, /Confirm the Terms and Privacy Policy before submitting/);
  assert.match(i18n, /Continue with Google/);
  assert.match(main, /t\("form\.consentInvalid"\)/);
  assert.match(main, /t\("auth\.continue"\)/);
});

test("security headers constrain executable content and transport", () => {
  assert.match(headers, /Content-Security-Policy: default-src 'self';/);
  assert.match(headers, /script-src 'self' 'unsafe-inline' https:\/\/www\.googletagmanager\.com/);
  assert.match(headers, /object-src 'none'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /Strict-Transport-Security: max-age=31536000; includeSubDomains/);
});

test("post-authentication redirects remain same-origin paths", () => {
  assert.equal(safeNext("/"), "/");
  assert.equal(safeNext("/privacy/?from=auth#data"), "/privacy/?from=auth#data");
  for (const value of ["https://evil.example", "//evil.example", "javascript:alert(1)", "evil/path", null]) {
    assert.equal(safeNext(value), "/");
  }
});
