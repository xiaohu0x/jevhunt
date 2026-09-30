import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { PROJECT_SEO_COPY, TOPIC_KEYS } from "../shared/project-seo-copy.js";
import { projectSeo, projectIntent, duplicateProjectNames, displayUnits } from "../shared/project-seo.js";
import { LOCALES } from "../shared/locales.js";
import { renderProject } from "../shared/catalog-view.js";
import { loadData } from "./lib/site.mjs";

const trading = { name: "TradingAgents", repo: "TauricResearch/TradingAgents", desc: "TradingAgents: Multi-Agents LLM Financial Trading Framework", cat: "agents", relationship: "integration", evidenceLevel: "documented", language: "Python", evidence: "https://github.com/TauricResearch/TradingAgents/blob/" + "a".repeat(40) + "/README.md", evidenceDetail: { excerpt: "export TYPESAFE_API_KEY=... # Jev social-post screening (optional)" } };

test("every locale has complete native metadata vocabulary with identical placeholders", () => {
  assert.deepEqual(Object.keys(PROJECT_SEO_COPY).sort(), Object.keys(LOCALES).sort());
  for (const [key, copy] of Object.entries(PROJECT_SEO_COPY)) {
    assert.equal(copy.topics.length, TOPIC_KEYS.length, key);
    assert.ok(copy.topics.every(value => typeof value === "string" && value.trim()), key);
    assert.deepEqual(Object.keys(copy.roles).sort(), Object.keys(PROJECT_SEO_COPY.en.roles).sort(), key);
    for (const field of ["opening", "platform", "code", "action", "owner"]) {
      const placeholders = value => [...value.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
      assert.deepEqual(placeholders(copy[field]), placeholders(PROJECT_SEO_COPY.en[field]), key + ":" + field);
    }
    assert.ok(copy.tradingScope.includes("TradingAgents") && copy.tradingScope.includes("Jev"), key);
    if (key !== "en") assert.notEqual(projectSeo(trading, { localeKey: key }).description, projectSeo(trading).description, key);
  }
});

test("TradingAgents leads with the searched entity and explains the optional Jev role", () => {
  const english = projectSeo(trading);
  assert.equal(english.title, "TradingAgents + Jev — Multi-Agent Trading");
  assert.match(english.description, /optional Jev screening of social posts/);
  assert.match(english.description, /Python source code/);
  assert.doesNotMatch(english.title, /TauricResearch/);
  const chinese = projectSeo(trading, { localeKey: "zh-cn" });
  assert.equal(chinese.title, "TradingAgents + Jev：多智能体交易框架");
  assert.match(chinese.description, /可选用 Jev 筛选社交帖子/);
  assert.match(projectSeo(trading, { localeKey: "ja" }).description, /任意で利用/);
  const changedEvidence = projectSeo({ ...trading, evidenceDetail: { excerpt: "Only a generic reference to the SDK remains." } });
  assert.equal(changedEvidence.scoped, false);
  assert.doesNotMatch(changedEvidence.description, /screening of social posts/);
});

test("owners distinguish collisions without displacing the project name", () => {
  assert.deepEqual([...duplicateProjectNames([{ name: "demo", repo: "one/demo" }, { name: "DEMO", repo: "two/demo" }, { name: "unique", repo: "one/unique" }])], ["demo"]);
  const first = projectSeo(trading, { duplicateName: true });
  assert.match(first.title, /^TradingAgents.*\(TauricResearch\)$/);
  assert.match(first.description, /^TradingAgents \(TauricResearch\)/);
  assert.notEqual(first.title, projectSeo({ ...trading, repo: "another/TradingAgents" }, { duplicateName: true }).title);
});

test("use cases come from descriptions; owner names and evidence snippets cannot inject a purpose", () => {
  const base = { name: "Example", repo: "trading-mcp-sql/example", cat: "apps", relationship: "jev-app", desc: "", evidenceDetail: { excerpt: "Example: trading bots with SQL and MCP" } };
  assert.equal(projectIntent(base).basis, "catalog-facts");
  assert.equal(projectIntent(base).topic, "app");
  assert.equal(projectIntent({ ...base, desc: "Not a trading tool." }).topic, "app");
  assert.equal(projectIntent({ ...base, desc: "Semantic code search with Jev." }).topic, "search");
  assert.equal(projectIntent({ ...base, desc: "A code-review workflow." }).topic, "codeReview");
  const plugin = projectSeo({ ...base, desc: "Claude Code plugin for context compaction.", relationship: "integration" });
  assert.match(plugin.title, /Context Compaction for Claude Code/);
  assert.equal(projectIntent({ ...base, desc: "Context compaction. Not for Claude Code." }).platform, null);
});

test("SDKs, research, alternatives and unavailable facts do not become product claims", () => {
  const base = { name: "Example", repo: "owner/example", cat: "apps", desc: "", language: "unknown", archived: true };
  const alternative = projectSeo({ ...base, relationship: "local-alternative" });
  assert.match(alternative.title, /Local Jev Alternative/);
  assert.doesNotMatch(alternative.title, /\+ Jev|Integration/);
  assert.match(alternative.description, /repository is archived/);
  assert.doesNotMatch(alternative.description, /unknown|undefined|install|tutorial|best|fastest|free/i);
  assert.match(projectSeo({ ...base, relationship: "research" }).title, /Jev Research/);
  assert.match(projectSeo({ ...base, relationship: "sdk", language: "Python", evidenceLevel: "official" }).title, /Official Python SDK/);
  assert.doesNotMatch(projectSeo({ ...base, relationship: "sdk", desc: "The official SDK", evidenceLevel: "documented" }).title, /Official/);
  assert.match(projectSeo({ ...base, relationship: "not-a-relationship" }).title, /Jev Project Details/);
  assert.equal(projectSeo(base, { localeKey: "constructor" }).title, projectSeo(base).title);
  const directory = projectSeo({ ...base, relationship: "local-alternative", desc: "A curated directory of Jev projects and local alternatives." });
  assert.equal(directory.relationship, "resource");
  assert.match(directory.title, /Jev Resources/);
  assert.ok(directory.flags.includes("source-relationship-conflict"));
  const benchmark = projectSeo({ ...base, relationship: "local-alternative", desc: "Benchmark TypeSafe JEV against LLMs and local alternatives." });
  assert.equal(benchmark.relationship, "research");
  assert.doesNotMatch(benchmark.description, /Local Jev Alternative/);
});

test("rendered metadata, H1, visible summary and structured data agree in all locales", t => {
  const { i18n } = loadData();
  for (const [localeKey, localeInfo] of Object.entries(LOCALES)) {
    const seo = projectSeo(trading, { localeKey });
    const html = renderProject(trading, {}, [], [], i18n.locales[localeKey].messages, { localeKey, localeInfo, localePrefix: localeKey === "en" ? "" : `/${localeKey}` });
    const dom = new JSDOM(html);
    t.after(() => dom.window.close());
    const document = dom.window.document;
    assert.equal(document.title, seo.title + " | JevHunt", localeKey);
    assert.equal(document.querySelectorAll("h1").length, 1);
    assert.equal(document.querySelector("h1").textContent, seo.heading);
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) assert.equal(document.querySelector(selector).content, seo.description, localeKey);
    assert.equal(document.querySelector('meta[property="og:title"]').content, document.title);
    assert.equal(document.querySelector('meta[name="twitter:title"]').content, document.title);
    assert.equal(document.querySelector(".legal__summary").textContent, seo.description);
    assert.equal(JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)["@graph"][0].description, seo.description);
    assert.ok(document.querySelector(".project-source-description").textContent.includes(trading.desc));
    assert.equal(document.querySelectorAll('link[rel="alternate"]').length, 16);
    assert.equal(document.querySelector('meta[name="robots"]'), null);
  }
});

test("rendering preserves long names and Unicode while escaping untrusted catalog fields", t => {
  const name = 'Long-Project-'.repeat(8) + '🧑‍💻<script>alert("x")</script>';
  const project = { ...trading, repo: "owner/long-project", name, desc: 'A browser extension. </p><img src=x onerror=alert(1)>' };
  const seo = projectSeo(project, { localeKey: "zh-cn" });
  assert.ok(seo.title.startsWith(name));
  assert.ok(seo.description.includes(name));
  assert.ok(seo.flags.includes("long-title"));
  assert.equal(displayUnits("e\u0301中"), 3);
  const dom = new JSDOM(renderProject(project, {}, [], [], {}, { localeKey: "zh-cn" }));
  t.after(() => dom.window.close());
  assert.equal(dom.window.document.title, seo.title + " | JevHunt");
  assert.equal(dom.window.document.querySelector('meta[name="description"]').content, seo.description);
  assert.equal(dom.window.document.querySelector("main script,main img"), null);
});
