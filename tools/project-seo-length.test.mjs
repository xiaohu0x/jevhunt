import assert from "node:assert/strict";
import test from "node:test";
import { projectSeo, projectSeoLengthDiagnostics } from "../shared/project-seo.js";
import { PROJECT_CONTENT_VERSION } from "../shared/project-content.js";

const project = { id: 101, name: "Example", repo: "owner/Example", desc: "A browser automation tool.", cat: "browser", relationship: "jev-app" };
function authored(localized, locale = "en", status = "reviewed") {
  const entry = { ...localized, summary: "Reviewed fixture summary.", sections: [{ kind: "purpose", heading: "Purpose" }] };
  return { version: PROJECT_CONTENT_VERSION, repositoryId: project.id, repo: project.repo,
    relationship: project.relationship, status,
    sources: [{ id: "readme", path: "README.md" }], claims: [],
    locales: { en: entry, [locale]: entry } };
}

test("authored metadata gets advisory diagnostics without changing reviewed text or provenance flags", () => {
  const localized = { title: "Example " + "a".repeat(80), h1: "e\u0301".repeat(77), description: "Reviewed description. " + "文".repeat(130) };
  const seo = projectSeo(project, { content: authored(localized, "en", "source-limited") });
  assert.equal(seo.title, localized.title);
  assert.equal(seo.heading, localized.h1);
  assert.equal(seo.description, localized.description);
  assert.equal(seo.basis, "reviewed-content");
  assert.deepEqual(new Set(seo.flags), new Set(["source-limited", "long-title", "long-heading", "long-description"]));
  assert.deepEqual(seo.lengthDiagnostics.heading, { units: 77, budget: 76 });
});

test("title budget includes rendered suffix and collision owner while H1 keeps its own measurement", () => {
  const localized = { title: "Example " + "a".repeat(58), h1: "H".repeat(76), description: "Example " + "d".repeat(182) };
  const content = authored(localized);
  const plain = projectSeo(project, { content });
  assert.deepEqual(plain.flags, []);
  assert.deepEqual(plain.lengthDiagnostics.title, { units: 76, budget: 76 });
  assert.deepEqual(plain.lengthDiagnostics.description, { units: 190, budget: 190 });
  const collision = projectSeo(project, { content, duplicateName: true });
  assert.equal(collision.title, localized.title + " (owner)");
  assert.equal(collision.heading, localized.h1);
  assert.equal(collision.description, localized.description.replace("Example", "Example (owner)"));
  assert.deepEqual(collision.flags, ["long-title", "long-description"]);
  assert.equal(collision.lengthDiagnostics.title.units, 84);
  assert.equal(collision.lengthDiagnostics.description.units, 198);
  assert.equal(collision.lengthDiagnostics.heading.units, 76);
});

test("CJK descriptions use the shared wide-script budget at the exact boundary", () => {
  for (const localeKey of ["zh-cn", "zh-tw", "ja", "ko"]) {
    const localized = { title: "Example", h1: "Example", description: "中".repeat(120) };
    const within = projectSeo(project, { localeKey, content: authored(localized, localeKey) });
    assert.equal(within.lengthDiagnostics.description.units, 240, localeKey);
    assert.equal(within.lengthDiagnostics.description.budget, 240, localeKey);
    assert.equal(within.flags.includes("long-description"), false, localeKey);
    const over = { ...localized, description: localized.description + "文" };
    const diagnosed = projectSeo(project, { localeKey, content: authored(over, localeKey) });
    assert.equal(diagnosed.flags.includes("long-description"), true, localeKey);
    assert.equal(diagnosed.description, over.description, localeKey);
  }
});

test("fallback metadata uses the same length diagnostics and keeps long Unicode names intact", () => {
  const name = "Project-".repeat(30) + "🧑‍💻e\u0301";
  const seo = projectSeo({ ...project, name }, { localeKey: "ja" });
  assert.ok(seo.title.startsWith(name));
  assert.ok(seo.heading.startsWith(name));
  assert.ok(seo.description.includes(name));
  assert.ok(seo.flags.includes("long-title"));
  assert.ok(seo.flags.includes("long-heading"));
  assert.ok(seo.flags.includes("long-description"));
  assert.equal(seo.lengthDiagnostics.description.budget, 240);
  assert.deepEqual(seo.lengthDiagnostics, projectSeoLengthDiagnostics(seo, { localeKey: "ja" }));
});

test("unknown locales use English budgets and combining marks do not consume extra display units", () => {
  const metadata = { title: "e\u0301".repeat(66), heading: "H".repeat(76), description: "d".repeat(191) };
  const diagnostics = projectSeoLengthDiagnostics(metadata, { localeKey: "constructor" });
  assert.deepEqual(diagnostics.title, { units: 76, budget: 76 });
  assert.deepEqual(diagnostics.description, { units: 191, budget: 190 });
  assert.deepEqual(diagnostics.flags, ["long-description"]);
});
