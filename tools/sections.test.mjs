import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { onRequestGet as categoriesRoute } from "../functions/categories/index.js";
import { onRequestGet as tasksRoute } from "../functions/tasks/index.js";
import { onRequestGet as taskRoute } from "../functions/tasks/[task]/[[page]].js";
import { database } from "./helpers/d1.mjs";
import { publicPreview } from "../shared/catalog-data.js";
import { TASK_LIST, taskById, taskClause, projectTaskIds } from "../shared/catalog-tasks.js";
import { isFeatured, compareFeatured } from "../shared/catalog-featured.js";
import { categoriesIndexView, tasksIndexView, taskPageView } from "../shared/catalog-section-pages.js";
import { compareView, alternativesView } from "../shared/catalog-compare.js";
import { collectionsIndexView, collectionPageView } from "../shared/catalog-collection-pages.js";
import { COLLECTION_LIST, collectionMatches, collectionById } from "../shared/catalog-collections.js";
import { onRequestGet as collectionsRoute } from "../functions/collections/index.js";
import { onRequestGet as collectionRoute } from "../functions/collections/[collection]/[[page]].js";
import { onRequestGet as rssRoute } from "../functions/rss.xml.js";

const origin = "https://jevhunt.com";
const evidence = "https://github.com/owner/example/blob/" + "a".repeat(40) + "/README.md";

function setup(t) {
  const DB = database();
  t.after(() => DB.db.close());
  DB.db.prepare("UPDATE catalog_control SET revision='sections-v1',published_at=1790640000").run();
  const add = (overrides = {}) => {
    const project = {
      name: "Example",
      repo: "owner/example",
      desc: "A documented project description that is long enough to pass the featured description threshold for the directory.",
      cat: "apps",
      relationship: "jev-app",
      evidenceLevel: "documented",
      evidence,
      evidenceDetail: { excerpt: "Source evidence" },
      language: "Python",
      stars: 120,
      created: "2026-09-01",
      added: "2026-09-03",
      pushed: "2026-09-05",
      archived: false,
      freshness: "current",
      ...overrides,
    };
    DB.db.prepare("INSERT INTO catalog_entries(repo,payload,preview,name,category,relationship,language,stars,created,active,checked_at,next_check_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,2)")
      .run(project.repo.toLowerCase(), JSON.stringify(project), JSON.stringify(publicPreview(project)), project.name, project.cat, project.relationship, project.language, project.stars, project.created, overrides.active ?? 1);
    return project;
  };
  const env = { DB };
  const get = async (path, params = {}) => {
    const url = new URL(path, origin);
    const request = new Request(url);
    const next = () => new Response("static fallback", { status: 200 });
    if (path === "/categories/") return categoriesRoute({ request, env, next });
    if (path === "/tasks/") return tasksRoute({ request, env, next });
    if (path === "/collections/") return collectionsRoute({ request, env, next });
    const collectionMatch = path.match(/^\/collections\/([^/]+)(?:\/(\d+))?\/$/);
    if (collectionMatch) return collectionRoute({ request, env, next, params: { collection: collectionMatch[1], page: collectionMatch[2] || "" } });
    const match = path.match(/^\/tasks\/([^/]+)(?:\/(\d+))?\/$/);
    if (match) return taskRoute({ request, env, next, params: { task: match[1], page: match[2] || "" } });
    throw new Error("Unhandled test path " + path);
  };
  return { DB, add, get };
}

test("the task taxonomy is bounded, unique and every task binds its keywords", () => {
  assert.ok(TASK_LIST.length >= 15 && TASK_LIST.length <= 25, `unexpected task count ${TASK_LIST.length}`);
  assert.equal(new Set(TASK_LIST.map(task => task.id)).size, TASK_LIST.length);
  for (const task of TASK_LIST) {
    assert.ok(task.name && task.blurb && task.description, task.id);
    const clause = taskClause(task);
    assert.ok(clause.values.length > 0, task.id);
    assert.equal((clause.sql.match(/\?/g) || []).length, clause.values.length, task.id);
    assert.ok(clause.values.every(value => value.startsWith("% ") && value.endsWith(" %")), task.id);
  }
  assert.equal(taskById("browser-automation").name, "Browser automation");
  assert.equal(taskById("nope"), null);
});

test("project tasks are derived from the same text used by the SQL predicate", () => {
  assert.ok(projectTaskIds({ name: "Browser Agent", repo: "owner/browser-agent", desc: "A browser automation harness with typed decisions." }).includes("browser-automation"));
  assert.ok(!projectTaskIds({ name: "Storage tool", repo: "owner/storage", desc: "A storage wrapper for paragraph editing." }).includes("rag-retrieval"));
  assert.ok(projectTaskIds({ name: "RAG", repo: "owner/rag", desc: "Retrieval augmented generation over a knowledge base." }).includes("rag-retrieval"));
});

test("featured excludes lists, thin descriptions and low traction but keeps documented projects", () => {
  const base = { stars: 500, cat: "apps", evidenceLevel: "documented", desc: "x".repeat(90), archived: false };
  assert.equal(isFeatured(base), true);
  assert.equal(isFeatured({ ...base, cat: "lists" }), false);
  assert.equal(isFeatured({ ...base, stars: 49 }), false);
  assert.equal(isFeatured({ ...base, desc: "too short" }), false);
  assert.equal(isFeatured({ ...base, archived: true }), false);
  assert.equal(isFeatured({ ...base, evidenceLevel: "legacy-unreviewed" }), false);
  const official = { ...base, evidenceLevel: "official", stars: 60 };
  const popular = { ...base, stars: 900 };
  assert.deepEqual([official, popular].sort(compareFeatured)[0], official);
});

test("the categories index lists every category with counts and sample projects", async t => {
  const { add, get } = setup(t);
  add({ repo: "alpha/router", name: "Ticket Router", cat: "agents" });
  add({ repo: "beta/browser", name: "Browser Agent", cat: "browser" });
  add({ repo: "gamma/client", name: "Client", cat: "sdks", relationship: "sdk" });
  for (let i = 0; i < 3; i++) add({ repo: `alpha/extra-${i}`, name: `Extra ${i}`, cat: "agents", stars: 50 - i });
  const response = await get("/categories/");
  assert.equal(response.status, 200);
  const document = new JSDOM(await response.text()).window.document;
  const blocks = [...document.querySelectorAll(".category-block")];
  assert.equal(blocks.length, 3);
  const agents = blocks.find(block => block.querySelector("h2").textContent.includes("Agent Tooling"));
  assert.match(agents.textContent, /4 projects/);
  assert.equal(agents.querySelectorAll("li").length, 3);
  assert.equal(agents.querySelector('a[href="/categories/agents/"]').getAttribute("href"), "/categories/agents/");
  assert.equal(document.querySelectorAll(".category-tasks .task-card").length, TASK_LIST.length);
  const schema = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
  assert.equal(schema["@graph"][0]["@type"], "CollectionPage");
});

test("the task index and a task page render only matching projects", async t => {
  const { add, get } = setup(t);
  add({ repo: "alpha/browser-agent", name: "Browser Agent", desc: "Browser automation that drives Chrome with typed decisions." });
  add({ repo: "beta/trading-bot", name: "Trading Bot", desc: "A trading bot choosing entries with Jev." });
  add({ repo: "gamma/browser-2", name: "Second Browser", desc: "Another browser agent for Playwright." });

  const index = await get("/tasks/");
  assert.equal(index.status, 200);
  const indexDocument = new JSDOM(await index.text()).window.document;
  assert.equal(indexDocument.querySelectorAll(".task-index .task-card").length, TASK_LIST.length);

  const page = await get("/tasks/browser-automation/");
  assert.equal(page.status, 200);
  const document = new JSDOM(await page.text()).window.document;
  const names = [...document.querySelectorAll(".app-grid .card__name")].map(link => link.textContent);
  assert.deepEqual(names.sort(), ["Browser Agent", "Second Browser"]);
  assert.equal(document.querySelector("h1").textContent.trim(), "Browser automation");
  assert.ok(document.querySelector(".legal__summary").textContent.length > 40);
  const schema = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
  assert.equal(schema["@graph"][1]["@type"], "ItemList");
  assert.equal(schema["@graph"][1].itemListElement.length, 2);

  const empty = await get("/tasks/trading-finance/");
  assert.equal(empty.status, 200);
  const emptyDocument = new JSDOM(await empty.text()).window.document;
  assert.deepEqual([...emptyDocument.querySelectorAll(".app-grid .card__name")].map(link => link.textContent), ["Trading Bot"]);
});

test("shared section views keep crawlable identifiers and canonical paths", () => {
  const categories = categoriesIndexView({ projectCount: 10, categoryCounts: { apps: 7, agents: 3 }, samples: { apps: [], agents: [] } });
  assert.equal(categories.path, "/categories/");
  assert.match(categories.body, /<h1>Browse Jev projects by category<\/h1>/);
  const tasks = tasksIndexView({ projectCount: 10 });
  assert.equal(tasks.path, "/tasks/");
  const task = taskPageView({ task: taskById("browser-automation"), projects: [], total: 0, number: 1, pages: 1 });
  assert.equal(task.path, "/tasks/browser-automation/");
  assert.match(task.body, /breadcrumbs/);
});

test("the static build publishes the task and category entry points", () => {
  const home = new JSDOM(readFileSync("public/index.html", "utf8")).window.document;
  assert.equal(home.querySelectorAll("#taskGrid .task-card").length, TASK_LIST.length);
  assert.ok(home.querySelectorAll("#featuredGrid .card").length > 0);
  assert.equal(home.querySelectorAll("#categoryGrid .category-card").length, 10);
  const categories = new JSDOM(readFileSync("public/categories/index.html", "utf8")).window.document;
  assert.equal(categories.querySelectorAll(".category-block").length, 10);
  const tasks = new JSDOM(readFileSync("public/tasks/index.html", "utf8")).window.document;
  assert.equal(tasks.querySelectorAll(".task-index .task-card").length, TASK_LIST.length);
  const browser = new JSDOM(readFileSync("public/tasks/browser-automation/index.html", "utf8")).window.document;
  assert.ok(browser.querySelectorAll(".app-grid .card").length > 0);
  const sitemap = readFileSync("public/sitemap.xml", "utf8");
  assert.match(sitemap, /<loc>https:\/\/jevhunt\.com\/tasks\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/jevhunt\.com\/categories\/<\/loc>/);
});


test("compare and alternatives views expose decision fields and structured data", () => {
  const base = { name: "Example", repo: "owner/example", desc: "A documented browser agent with typed decisions and a long description.", cat: "browser", relationship: "jev-app", evidenceLevel: "documented", evidence: "https://github.com/owner/example/blob/" + "a".repeat(40) + "/README.md", license: "MIT", language: "Python", stars: 120, pushed: "2026-09-20", archived: false, freshness: "current" };
  const alt = { ...base, name: "Alternative", repo: "owner/alternative", stars: 50, license: "Apache-2.0" };
  const view = alternativesView({ project: base, alternatives: [alt], categoryName: "Browser & Computer Use" });
  assert.equal(view.path, "/alternatives/owner/example/");
  assert.match(view.body, /<table class="compare-table/);
  assert.match(view.body, /MIT/);
  assert.match(view.body, /Apache-2\.0/);
  assert.match(view.body, /Browser automation/);
  assert.equal(view.schema["@graph"].find(node => node["@type"] === "FAQPage").mainEntity.length, 3);
  assert.equal(view.schema["@graph"].find(node => node["@type"] === "ItemList").itemListElement.length, 1);
  const compare = compareView({ projects: [base, alt] });
  assert.equal(compare.noindex, true);
  assert.match(compare.body, /Compare Example vs Alternative/);
  assert.match(compare.body, /GitHub/);
  assert.ok(compareView({ projects: [] }).body.includes("Pick two or three projects"));
});


test("collections render rule-based views with counts and structured data", async t => {
  const { add, get } = setup(t);
  add({ repo: "alpha/browser", name: "Browser Agent", cat: "browser", desc: "A browser automation agent for Chrome." });
  add({ repo: "beta/local", name: "Local Model", cat: "research", relationship: "local-alternative", desc: "A local decision model." });
  add({ repo: "gamma/sdk", name: "SDK", cat: "sdks", relationship: "sdk", desc: "A client library." });
  const index = await get("/collections/");
  assert.equal(index.status, 200);
  const indexDocument = new JSDOM(await index.text()).window.document;
  assert.equal(indexDocument.querySelectorAll(".collection-card").length, COLLECTION_LIST.length);
  assert.match(indexDocument.body.textContent, /browser agents/i);
  const page = await get("/collections/browser-agents/");
  assert.equal(page.status, 200);
  const document = new JSDOM(await page.text()).window.document;
  assert.deepEqual([...document.querySelectorAll(".app-grid .card__name")].map(link => link.textContent), ["Browser Agent"]);
  const schema = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
  assert.equal(schema["@graph"][1]["@type"], "ItemList");
  const local = await get("/collections/local-alternatives/");
  const localDocument = new JSDOM(await local.text()).window.document;
  assert.deepEqual([...localDocument.querySelectorAll(".app-grid .card__name")].map(link => link.textContent), ["Local Model"]);
});

test("collection views and RSS keep canonical paths and feed shape", () => {
  const view = collectionsIndexView({ projectCount: 3, counts: { "browser-agents": 1 } });
  assert.equal(view.path, "/collections/");
  assert.match(view.body, /Browser agents/);
  const page = collectionPageView({ collection: collectionById("browser-agents"), projects: [], total: 0, number: 1, pages: 1 });
  assert.equal(page.path, "/collections/browser-agents/");
  assert.equal(collectionMatches(collectionById("official-jev"), { cat: "official" }), true);
  assert.equal(collectionMatches(collectionById("sdk-clients"), { cat: "apps" }), false);
});

test("the static build ships collections, RSS, submit and claim links", () => {
  const collections = new JSDOM(readFileSync("public/collections/index.html", "utf8")).window.document;
  assert.equal(collections.querySelectorAll(".collection-card").length, COLLECTION_LIST.length);
  const browser = new JSDOM(readFileSync("public/collections/browser-agents/index.html", "utf8")).window.document;
  assert.ok(browser.querySelectorAll(".app-grid .card").length > 0);
  const submit = new JSDOM(readFileSync("public/submit/index.html", "utf8")).window.document;
  assert.match(submit.body.textContent, /Claim a listing/);
  assert.ok(submit.querySelector('img[src="/badge.svg"]'));
  const sitemap = readFileSync("public/sitemap.xml", "utf8");
  assert.match(sitemap, /<loc>https:\/\/jevhunt\.com\/collections\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/jevhunt\.com\/submit\/<\/loc>/);
  const project = readFileSync("public/projects/browser-use/jev-ultrafast/index.html", "utf8");
  assert.match(project, /Claim this listing/);
});

test("the live RSS endpoint returns an RSS feed", async t => {
  const { add, DB } = setup(t);
  add({ repo: "alpha/recent", name: "Recent Project", added: "2026-09-30" });
  const response = await rssRoute({ request: new Request("https://jevhunt.com/rss.xml"), env: { DB }, waitUntil: () => {} });
  assert.match(response.headers.get("content-type"), /application\/rss\+xml/);
  const text = await response.text();
  assert.match(text, /<rss version="2.0">/);
  assert.match(text, /Recent Project/);
});
