import assert from "node:assert/strict";
import test from "node:test";
import { renderCard, renderProject } from "../shared/catalog-view.js";
import { loadData } from "./lib/site.mjs";

test("live server cards expose the same evidence and repository actions as client cards", () => {
  const html = renderCard({
    name: "Example", repo: "owner/example", desc: "A project", language: "Python", stars: 7,
    relationship: "jev-app", evidenceLevel: "documented", evidence: "https://github.com/owner/example/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/README.md",
    created: "2026-09-20", pushed: "2026-09-21", fork: true, archived: false, freshness: "current",
  }, { "relationship.jev-app": "Jev application", "evidence.documented": "Documented", "apps.evidence": "Evidence", "apps.fork": "Fork", "apps.published": "published {date}", "apps.updated": "updated {date}", "apps.starsLabel": "{count} GitHub stars" });
  assert.match(html, /class="card__go" href="https:\/\/github\.com\/owner\/example"/);
  assert.match(html, /class="card__site" href="https:\/\/github\.com\/owner\/example\/blob\//);
  assert.match(html, /published 2026-09-20/);
  assert.match(html, /updated 2026-09-21/);
  assert.match(html, /aria-label="7 GitHub stars"/);
  assert.doesNotMatch(html, />Details →</);
});

test("localized project details guide visitors into similar and recently active projects", () => {
  const { i18n } = loadData();
  const messages = i18n.locales["zh-cn"].messages;
  const project = { name: "示例项目", repo: "owner/example", desc: "一个项目", cat: "apps", language: "Python", stars: 7,
    relationship: "jev-app", evidenceLevel: "documented", evidence: "https://github.com/owner/example/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/README.md",
    created: "2026-09-20", pushed: "2026-09-21", archived: false, fork: false, freshness: "current", provenance: ["github-search"],
    evidenceDetail: { excerpt: "已验证的来源", commit: "a".repeat(40) } };
  const html = renderProject(project, { syncedAt: "2026-09-29T00:00:00.000Z" }, [
    { ...project, repo: "owner/similar", name: "相似项目" },
  ], [
    { ...project, repo: "owner/active", name: "活跃项目", pushed: "2026-09-28" },
  ], messages, { localeKey: "zh-cn", localeInfo: { lang: "zh-CN", path: "/zh-cn/" }, localePrefix: "/zh-cn" });
  assert.match(html, /<html lang="zh-CN" data-locale="zh-cn"/);
  assert.match(html, /\/zh-cn\/projects\/owner\/example\//);
  assert.match(html, /项目事实/);
  assert.match(html, /相似项目/);
  assert.match(html, /最近活跃项目/);
  assert.match(html, /\/zh-cn\/projects\/owner\/similar\//);
  assert.match(html, /\/zh-cn\/projects\/owner\/active\//);
  assert.doesNotMatch(html, /同语言/);
});
