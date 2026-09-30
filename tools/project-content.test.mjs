import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { database } from "./helpers/d1.mjs";
import { LOCALES } from "../shared/locales.js";
import { PROJECT_CONTENT_VERSION, validateProjectContent, applyProjectContent, matchingProjectContent } from "../shared/project-content.js";
import { readProjectContent, attachProjectContent, localizeCatalogProjects } from "../shared/project-content-store.js";
import { projectContentStatements, projectContentVerificationSql, verifyPublishedProjectContent } from "./lib/project-content-publish.mjs";
import { publicPreview } from "../shared/catalog-data.js";
import { readCatalogPage, readCatalogQuery, catalogCacheRequest } from "../shared/catalog-query.js";
import { renderProject } from "../shared/catalog-view.js";
import { onRequestGet as sitemap } from "../functions/sitemap.xml.js";

const commit = "a".repeat(40);
const project = { id: 12345, name: "example", repo: "owner/example", desc: "Original repository description", cat: "apps", relationship: "jev-app", language: "Python", stars: 10, commit, archived: false, evidenceLevel: "documented", evidence: "https://github.com/owner/example/blob/" + commit + "/README.md" };
// Synthetic strings exercise the data contract and routing, not language quality.
function record() {
  const claims = ["purpose", "jev", "usage", "limits"].map(id => ({ id, kind: "documented", text: "Fixture claim " + id, evidence: [{ source: "readme", start: 1, end: 1, quote: "Fixture source." }] }));
  return { version: PROJECT_CONTENT_VERSION, repo: project.repo, repositoryId: project.id, displayName: "Example", relationship: "integration", category: "agents", status: "reviewed", reviewedAt: "2026-09-30",
    sources: [{ id: "readme", path: "README.md", commit, url: project.evidence, sha256: "b".repeat(64), accessedAt: "2026-09-30T00:00:00Z" }], claims,
    locales: Object.fromEntries(Object.keys(LOCALES).map(locale => [locale, { title: `Example + Jev — ${locale} workflow`, h1: `Example: ${locale} workflow`, description: `Example ${locale} description.`,
      summary: locale === "ru" ? "Классификация документов" : locale === "zh-cn" ? "中文项目摘要" : `${locale} project summary`,
      sections: claims.map(claim => ({ kind: claim.id, heading: locale + " " + claim.id, text: locale + " specific " + claim.id, claims: [claim.id] })),
      review: { semantic: "source-checked", language: "model-reviewed", searchIntent: "inferred" } }])) };
}
function fixture(t, overrides = {}) {
  const DB = database(); t.after(() => DB.db.close());
  const p = { ...project, ...overrides };
  DB.db.prepare("INSERT INTO catalog_entries(repo,github_id,payload,preview,name,category,relationship,language,stars,active,checked_at,next_check_at) VALUES(?,?,?,?,?,?,?,?,?,1,1,1)")
    .run(p.repo.toLowerCase(), p.id, JSON.stringify(p), JSON.stringify(publicPreview(p)), p.name, p.cat, p.relationship, p.language, p.stars);
  return DB;
}

test("the content contract requires complete locale bodies and evidence, without manufacturing review", () => {
  assert.deepEqual(validateProjectContent(record()), []);
  const missing = record(); delete missing.locales.ja;
  assert.ok(validateProjectContent(missing).some(message => /Missing supported locale/.test(message)));
  const unsupported = record(); unsupported.locales.en.sections[0].claims = ["invented"];
  assert.ok(validateProjectContent(unsupported).some(message => /supporting claims/.test(message)));
  const unreviewed = record(); delete unreviewed.locales.en.review;
  assert.ok(validateProjectContent(unreviewed).some(message => /review/.test(message)));
  assert.equal(matchingProjectContent({ ...project, id: 999 }, record()), false);
});

test("publishing synchronizes classifications and previews while preserving newer live metadata", async t => {
  const DB = fixture(t), r = record();
  DB.db.prepare("UPDATE catalog_entries SET stars=777,payload=json_set(payload,'$.stars',777,'$.commit',?),preview=json_set(preview,'$.stars',777)").run("c".repeat(40));
  for (const sql of projectContentStatements(project, r, 100)) DB.db.exec(sql);
  const row = DB.db.prepare("SELECT * FROM catalog_entries").get();
  const payload = JSON.parse(row.payload), preview = JSON.parse(row.preview);
  assert.equal(row.stars, 777); assert.equal(payload.stars, 777); assert.equal(preview.stars, 777);
  assert.equal(payload.commit, "c".repeat(40)); assert.equal(payload.content.sourceChanged, true);
  const queue = DB.db.prepare("SELECT state,reason,source_commit FROM project_content_queue").get();
  assert.equal(queue.state, "pending"); assert.equal(queue.reason, "source-changed"); assert.equal(queue.source_commit, payload.commit);
  assert.equal(payload.desc, project.desc);
  for (const item of [row, payload, preview]) {
    assert.equal(item.name, "Example"); assert.equal(item.relationship, "integration");
  }
  assert.equal(row.category, "agents"); assert.equal(payload.cat, "agents"); assert.equal(preview.cat, "agents");
  assert.equal(preview.desc, r.locales.en.summary);
  assert.equal(DB.db.prepare("SELECT COUNT(*) n FROM project_content_locales").get().n, 15);
  assert.deepEqual(await readProjectContent(DB, payload), r);
  assert.equal((await localizeCatalogProjects(DB, [preview], "zh-cn"))[0].desc, "中文项目摘要");
  const query = readCatalogQuery(new URLSearchParams({ q: "классификация", locale: "ru", kind: "integration" }));
  const found = await readCatalogPage(DB, query);
  assert.equal(found.pagination.total, 1); assert.equal(found.apps[0].desc, "Классификация документов");
  assert.equal((await readCatalogPage(DB, readCatalogQuery(new URLSearchParams({ kind: "jev-app" })))).pagination.total, 0);
  for (const sql of projectContentStatements(project, r, 101)) DB.db.exec(sql);
  assert.equal(DB.db.prepare("SELECT state FROM project_content_queue").get().state, "pending", "republishing old evidence must retain source review work");
  const records = new Map([[project.repo, r]]);
  assert.deepEqual(verifyPublishedProjectContent(DB.db.prepare(projectContentVerificationSql(records)).all(), records), { repositories: 1, localePages: 15 });
});

test("publication cannot revive withdrawn repositories or attach an old identity's content", async t => {
  const DB = fixture(t);
  DB.db.prepare("INSERT INTO catalog_withdrawals VALUES('owner/example',1,'editor')").run();
  for (const sql of projectContentStatements(project, record(), 100)) DB.db.exec(sql);
  assert.equal(DB.db.prepare("SELECT COUNT(*) n FROM project_content").get().n, 0);
  DB.db.prepare("DELETE FROM catalog_withdrawals").run();
  for (const sql of projectContentStatements(project, record(), 100)) DB.db.exec(sql);
  DB.db.prepare("UPDATE catalog_entries SET github_id=999,payload=json_set(payload,'$.id',999)").run();
  assert.equal(await readProjectContent(DB, { ...project, id: 999 }), null);
  const inherited = { ...project, id: 999, content: { version: PROJECT_CONTENT_VERSION, summary: "OLD IDENTITY SUMMARY" } };
  const refreshed = await attachProjectContent(DB, inherited, 101);
  assert.equal(refreshed.content, undefined);
  assert.equal(publicPreview(refreshed).desc, project.desc);
  const preview = { ...publicPreview(project), id: 999 };
  assert.equal((await localizeCatalogProjects(DB, [preview], "zh-cn"))[0].desc, project.desc);
  assert.equal((await readCatalogPage(DB, readCatalogQuery(new URLSearchParams({ q: "классификация", locale: "ru" })))).pagination.total, 0);
});

test("a reviewed canonical rename replaces the old content key without identity collisions", async t => {
  const DB = fixture(t), original = record();
  for (const sql of projectContentStatements(project, original, 100)) DB.db.exec(sql);
  const renamed = { ...project, repo: "new-owner/example" };
  DB.db.prepare("UPDATE catalog_entries SET repo=?,payload=?,preview=?").run(renamed.repo, JSON.stringify(renamed), JSON.stringify(publicPreview(renamed)));
  const content = { ...original, repo: renamed.repo };
  for (const sql of projectContentStatements(renamed, content, 101)) DB.db.exec(sql);
  assert.equal(DB.db.prepare("SELECT COUNT(*) n FROM project_content").get().n, 1);
  assert.equal(DB.db.prepare("SELECT repo FROM project_content").get().repo, renamed.repo);
  assert.equal(DB.db.prepare("SELECT COUNT(*) n FROM project_content_locales WHERE repo='owner/example'").get().n, 0);
  assert.equal(DB.db.prepare("SELECT COUNT(*) n FROM project_content_locales WHERE repo=?").get(renamed.repo).n, 15);
  assert.deepEqual(await readProjectContent(DB, renamed), content);
});

test("subsequent discovery preserves reviewed classifications and queues changed sources", async t => {
  const DB = fixture(t), r = record();
  for (const sql of projectContentStatements(project, r, 100)) DB.db.exec(sql);
  const same = await attachProjectContent(DB, project, 101);
  assert.equal(same.relationship, "integration"); assert.equal(same.cat, "agents");
  assert.equal(DB.db.prepare("SELECT state FROM project_content_queue").get().state, "published");
  const changed = await attachProjectContent(DB, { ...project, commit: "c".repeat(40) }, 102);
  assert.equal(changed.relationship, "integration"); assert.equal(changed.content.sourceChanged, true);
  assert.equal(DB.db.prepare("SELECT state FROM project_content_queue").get().state, "pending");
  assert.equal(DB.db.prepare("SELECT reason FROM project_content_queue").get().reason, "source-changed");
});

test("reviewed copy controls the visible body, TDH, citations and schema in every locale", t => {
  const r = record();
  for (const [localeKey, localeInfo] of Object.entries(LOCALES)) {
    const dom = new JSDOM(renderProject(project, {}, [], [], {}, { localeKey, localeInfo, localePrefix: localeKey === "en" ? "" : "/" + localeKey, content: r }));
    t.after(() => dom.window.close());
    const d = dom.window.document, copy = r.locales[localeKey];
    assert.equal(d.title, copy.title + " | JevHunt");
    assert.equal(d.querySelector("h1").textContent, copy.h1);
    assert.equal(d.querySelector('meta[name="description"]').content, copy.description);
    assert.equal(d.querySelectorAll(".project-explanation section").length, 4);
    for (const section of copy.sections) assert.equal(d.querySelector(`#project-${section.kind} > p`).textContent, section.text);
    assert.equal(d.querySelector(".project-citations a").href, project.evidence + "#L1-L1");
    assert.equal(JSON.parse(d.querySelector('script[type="application/ld+json"]').textContent)["@graph"][0].description, copy.description);
  }
  const fallback = new JSDOM(renderProject({ ...project, id: 999 }, {}, [], [], {}, { content: r }));
  t.after(() => fallback.window.close());
  assert.equal(fallback.window.document.querySelector(".project-explanation"), null);
  assert.notEqual(fallback.window.document.title, r.locales.en.title + " | JevHunt");
});

test("locale-specific full-index responses cannot share a cache identity", () => {
  const request = locale => { const url = new URL("https://jevhunt.com/api/catalog?all=1&locale=" + locale); return catalogCacheRequest(url, readCatalogQuery(url.searchParams), "revision").url; };
  assert.notEqual(request("en"), request("zh-cn"));
});

test("publication verification rejects stale search text, locale bodies and listing classifications", t => {
  const DB = fixture(t), r = record(), records = new Map([[project.repo, r]]);
  for (const sql of projectContentStatements(project, r, 100)) DB.db.exec(sql);
  const verify = () => verifyPublishedProjectContent(DB.db.prepare(projectContentVerificationSql(records)).all(), records);
  assert.deepEqual(verify(), { repositories: 1, localePages: 15 });
  DB.db.prepare("UPDATE project_content_locales SET search_text='stale' WHERE locale='ru'").run();
  assert.throws(verify, /ru search text differs/);
  DB.db.prepare("UPDATE project_content_locales SET search_text=? WHERE locale='ru'").run(r.locales.ru.summary.toLowerCase());
  DB.db.prepare("UPDATE project_content_locales SET payload=json_set(payload,'$.title','stale') WHERE locale='ja'").run();
  assert.throws(verify, /locale data incomplete or inconsistent/);
  DB.db.prepare("UPDATE project_content_locales SET payload=? WHERE locale='ja'").run(JSON.stringify(r.locales.ja));
  DB.db.prepare("UPDATE catalog_entries SET relationship='jev-app'").run();
  assert.throws(verify, /catalog classification differs/);
  DB.db.prepare("UPDATE catalog_entries SET active=0").run();
  assert.throws(verify, /missing from the active catalog/);
});

test("reviewed projects publish every supported locale in the live sitemap and withdrawals remove them", async t => {
  const DB = fixture(t), r = record();
  for (const sql of projectContentStatements(project, r, 100)) DB.db.exec(sql);
  const xml = await (await sitemap({ env: { DB } })).text();
  const dom = new JSDOM(xml, { contentType: "application/xml" });
  t.after(() => dom.window.close());
  const urls = [...dom.window.document.querySelectorAll("loc")].map(node => node.textContent);
  for (const info of Object.values(LOCALES)) assert.ok(urls.includes(`https://jevhunt.com${info.path}projects/${project.repo}/`));
  assert.equal(urls.filter(url => url.includes(`/projects/${project.repo}/`)).length, 15);
  DB.db.prepare("INSERT INTO catalog_withdrawals VALUES(?,1,'editor')").run(project.repo);
  assert.ok(!(await (await sitemap({ env: { DB } })).text()).includes(`/projects/${project.repo}/`));
});
