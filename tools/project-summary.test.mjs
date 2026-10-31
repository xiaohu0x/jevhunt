import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { projectSeo, projectSummary, displayUnits } from "../shared/project-seo.js";
import { renderProject } from "../shared/catalog-view.js";

const vector = { name: "vector-cache", repo: "shivendrasoni/vector-cache", desc: "A simple semantic cache implementation. It caches responses from an LLM based on semantic similarity.", cat: "apps", relationship: "jev-app", evidenceLevel: "documented", language: "Python" };
const memory = { name: "mnemon-memory-agent", repo: "Grivn/mnemon-memory-agent", desc: "Long-term memory for AI agents on Jev. Keep raw records and answer from a small context.", cat: "agents", relationship: "jev-app", evidenceLevel: "documented", language: "TypeScript" };
const survey = { name: "jev-ecosystem-survey", repo: "cl-victor1/jev-ecosystem-survey", desc: "Survey of the open-source ecosystem around TypeSafe Jev: use-case classification of 16,128 repositories and evaluations.", cat: "research", relationship: "local-alternative", evidenceLevel: "documented", language: null };

test("a source summary replaces the taxonomy label in the English title and description", () => {
  const seo = projectSeo(vector);
  assert.equal(projectSummary(vector), "A simple semantic cache implementation");
  assert.match(seo.title, /^vector-cache \+ Jev: A simple semantic cache implementation$/);
  assert.match(seo.description, /^vector-cache: A simple semantic cache implementation\./);
  assert.doesNotMatch(seo.title, /Jev App/);
  assert.equal(seo.summary, "A simple semantic cache implementation");
  assert.equal(seo.descriptionSummary, seo.summary);
  assert.ok(seo.lengthDiagnostics.title.units <= 76);
  assert.ok(seo.lengthDiagnostics.description.units <= 190);
});

test("the summary comes from the first sentence and never repeats the project name", () => {
  const seo = projectSeo(memory);
  assert.match(seo.title, /long-term memory for AI agents/i);
  assert.doesNotMatch(seo.title, /Decision Models|mnemon-memory-agent +: mnemon/i);
  assert.match(seo.description, /^mnemon-memory-agent: Long-term memory for AI agents\./);
});

test("a survey is classified as research and keeps its own use case", () => {
  const seo = projectSeo(survey);
  assert.equal(seo.relationship, "research");
  assert.match(seo.title, /^jev-ecosystem-survey: Survey of the open-source ecosystem/);
  assert.doesNotMatch(seo.title, /Local Jev Alternative/);
  assert.match(seo.description, /^jev-ecosystem-survey: Survey of the open-source ecosystem/);
});

test("a non-English description never becomes an English summary sentence", () => {
  const project = { ...vector, name: "botInversion", repo: "YedraN/botInversion", desc: "Bot usado con Jev para invertir" };
  const seo = projectSeo(project);
  assert.equal(projectSummary(project), "");
  assert.equal(seo.summary, "");
  assert.equal(seo.neutral, true);
  assert.match(seo.title, /Jev Project$/);
  assert.doesNotMatch(seo.title + seo.description, /usado|invertir/);
});

test("a project without a description gets a neutral label, not an invented use case", () => {
  const seo = projectSeo({ ...vector, name: "kestrel", repo: "lpliu-art/kestrel", desc: "" });
  assert.equal(seo.summary, "");
  assert.equal(seo.neutral, true);
  assert.match(seo.title, /^kestrel — Jev Project$/);
  assert.equal(seo.description, "kestrel: Jev Project. Explore the Jev references, Python source code and similar projects.");
  assert.ok(seo.flags.includes("needs-specific-description"));
});

test("title truncation does not leave an unmatched parenthesis or repeat the owner incorrectly", () => {
  const project = { ...vector, name: "jev-lab", repo: "andrest04/jev-lab", desc: "A local Node lab for TypeSafe's Jev (System One): typed questions in, probabilities out. The API key stays local." };
  const seo = projectSeo(project, { duplicateName: true });
  assert.match(seo.title, /^jev-lab: .*\(andrest04\)$/);
  assert.equal((seo.title.match(/\(/g) || []).length, (seo.title.match(/\)/g) || []).length);
  assert.ok(displayUnits(seo.title + " | JevHunt") <= 76);
});

test("localised pages keep the reviewed vocabulary until a local summary exists", () => {
  const zh = projectSeo(vector, { localeKey: "zh-cn" });
  assert.equal(zh.summary, "");
  assert.match(zh.title, /^vector-cache：Jev 应用$/);
  assert.doesNotMatch(zh.description, /semantic cache/i);
});

test("a newly discovered project renders through the same generator without reviewed content", t => {
  const seo = projectSeo(vector);
  const dom = new JSDOM(renderProject(vector, {}, [], [], {}, { localeKey: "en", localeInfo: { lang: "en" } }));
  t.after(() => dom.window.close());
  const document = dom.window.document;
  assert.equal(document.title, seo.title + " | JevHunt");
  assert.equal(document.querySelector("h1").textContent, seo.heading);
  assert.equal(document.querySelector('meta[name="description"]').content, seo.description);
  assert.match(document.querySelector('meta[name="description"]').content, /semantic cache implementation/);
});

test("a description that starts with the project name and a verb is not duplicated in the title", () => {
  const project = { ...vector, name: "Composio", repo: "ComposioHQ/composio", desc: "Composio powers 1000+ toolkits and tool search." };
  assert.equal(projectSummary(project), "");
  const seo = projectSeo(project);
  assert.equal(seo.summary, "");
  assert.doesNotMatch(seo.title, /Composio powers/i);
  assert.match(seo.title, /Jev Project$/);
});
