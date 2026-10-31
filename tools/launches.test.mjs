import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { database } from "./helpers/d1.mjs";
import { publicPreview } from "../shared/catalog-data.js";
import { LAUNCH_MIN_STARS, LAUNCH_PAGE_SIZE, LAUNCH_ROWS, LAUNCH_TOP, LAUNCH_WINDOW, evidenceCitation, launchBoardFromProjects, launchBoardHtml, launchDayView, launchRowHtml, readLaunchBoard, readLaunchDay } from "../shared/catalog-launches.js";
import { onRequestGet as latestRoute } from "../functions/launches/index.js";
import { onRequestGet as dayRoute } from "../functions/launches/[date]/[[page]].js";
import { onRequestGet as localizedLatestRoute } from "../functions/[locale]/launches/index.js";
import { onRequestGet as localizedDayRoute } from "../functions/[locale]/launches/[date]/[[page]].js";

const commit = "8b22d43d01d9ddda5d686d093d5385884622f3de";
const today = "2026-10-30";
const launch = (repo, created, stars, extra = {}) => ({
  repo, name: repo.split("/")[1], desc: `${repo} does one documented thing.`, cat: "apps", relationship: "jev-app", language: "Python",
  stars, created, pushed: created, archived: false, fork: false, evidenceLevel: "documented",
  evidence: `https://github.com/${repo}/blob/${commit}/README.md#L5-L5`, freshness: "current", ...extra,
});
const catalog = [
  launch("a/newest-thin", "2026-10-24", LAUNCH_MIN_STARS - 1),
  launch("a/quiet-one", "2026-10-22", 40),
  launch("b/quiet-two", "2026-10-22", 40),
  launch("a/loud", "2026-10-20", 900),
  ...Array.from({ length: 8 }, (_, index) => launch(`c/busy-${index}`, "2026-10-18", 100 + index)),
  launch("d/older", "2026-10-10", 50),
  launch("e/out-of-window", "2026-09-01", 99999),
  launch("f/fork", "2026-10-22", 5000, { fork: true }),
  launch("f/archived", "2026-10-22", 5000, { archived: true }),
  launch("f/no-description", "2026-10-22", 5000, { desc: null }),
  launch("f/blank-description", "2026-10-22", 5000, { desc: "   " }),
  launch("f/awesome-list", "2026-10-22", 5000, { cat: "lists", relationship: "local-alternative" }),
  launch("f/unknown-date", "unknown", 5000),
  launch("f/future", "2026-11-02", 5000),
];

function seeded(t, projects) {
  const DB = database();
  t.after(() => DB.db.close());
  for (const project of projects) {
    DB.db.prepare("INSERT INTO catalog_entries (repo,payload,preview,name,category,relationship,language,stars,created,active,checked_at,next_check_at) VALUES (?,?,?,?,?,?,?,?,?,1,1,2)")
      .run(project.repo.toLowerCase(), JSON.stringify(project), JSON.stringify(publicPreview(project)), project.name, project.cat, project.relationship, project.language, project.stars, project.created);
  }
  return DB;
}
const summary = board => ({
  days: board.days.map(day => ({ date: day.date, count: day.count, repos: day.projects.map(project => project.repo) })),
  top: board.top.map(project => project.repo),
  pulse: board.pulse,
});
const fragment = html => new JSDOM(`<!doctype html><body>${html}`).window.document;
const assets = { fetch: async input => {
  try { return new Response(readFileSync("public" + new URL(input.url || input).pathname)); }
  catch { return new Response("Not found", { status: 404 }); }
} };
const context = (DB, path, params = {}) => ({
  request: new Request(`https://jevhunt.com${path}`), params, env: { DB, ASSETS: assets },
  next: async () => new Response("next", { status: 404 }),
});

test("an evidence permalink becomes a short citation and anything else stays out", () => {
  const base = `https://github.com/o/r/blob/${commit}`;
  assert.equal(evidenceCitation(`${base}/README.md#L191-L191`), "README.md:191 @8b22d43");
  assert.equal(evidenceCitation(`${base}/docs/x%20y.md#L2-L9`), "x y.md:2-9 @8b22d43");
  assert.equal(evidenceCitation(`${base}/README.md`), "README.md @8b22d43");
  assert.equal(evidenceCitation(`https://github.com/o/r/tree/${commit}/docs`), "");
  assert.equal(evidenceCitation(null), "");
});

test("the board lists the newest days with a launch over the star floor and counts every launch", () => {
  const board = summary(launchBoardFromProjects(catalog, { today }));
  assert.deepEqual(board.days.map(day => day.date), ["2026-10-22", "2026-10-20", "2026-10-18"]);
  assert.deepEqual(board.days.map(day => day.count), [2, 1, 8]);
  assert.deepEqual(board.days[0].repos, ["a/quiet-one", "b/quiet-two"], "equal stars fall back to the name");
  assert.equal(board.days[2].repos.length, LAUNCH_ROWS);
  assert.equal(board.days[2].repos[0], "c/busy-7");
  assert.equal(board.top.length, LAUNCH_TOP);
  assert.equal(board.top[0], "a/loud");
  for (const hidden of ["f/fork", "f/archived", "f/no-description", "f/blank-description", "f/awesome-list", "f/unknown-date", "f/future", "e/out-of-window", "a/newest-thin"]) {
    assert.ok(!board.days.some(day => day.repos.includes(hidden)) && !board.top.includes(hidden), hidden);
  }
  assert.equal(board.pulse.length, LAUNCH_WINDOW);
  assert.equal(board.pulse.at(-1).date, today);
  assert.deepEqual(board.pulse.slice(-7).map(day => day.count), [1, 0, 0, 0, 0, 0, 0], "a launch under the floor still counts, and the quiet days since stay visible");
});

test("the D1 queries and the static build agree on the board", async t => {
  const DB = seeded(t, catalog);
  const live = await readLaunchBoard(DB, { today });
  assert.deepEqual(summary(live), summary(launchBoardFromProjects(catalog.map(publicPreview), { today })));
});

test("the pulse strip never renders blank when the newest launch is older than the window", async t => {
  const projects = [launch("a/old", "2026-09-01", 9)];
  const built = launchBoardFromProjects(projects, { today });
  assert.deepEqual(built.pulse.at(-1), { date: "2026-09-01", count: 1 });
  const live = await readLaunchBoard(seeded(t, projects), { today });
  assert.deepEqual(live.pulse, built.pulse);
});

test("with nothing over the star floor the board explains itself and keeps the strip", async t => {
  const board = await readLaunchBoard(seeded(t, [launch("a/thin", "2026-10-29", LAUNCH_MIN_STARS - 1)]), { today });
  assert.deepEqual(board.days, []);
  assert.deepEqual(board.top, []);
  const document = fragment(launchBoardHtml(board, { "launch.empty": "Nothing yet." }));
  assert.equal(document.querySelector(".launch-empty").textContent, "Nothing yet.");
  assert.equal(document.querySelector(".launch-row"), null);
  assert.equal(document.querySelector("a.launch-pulse__day").getAttribute("href"), "/launches/2026-10-29/");
  const empty = fragment(launchBoardHtml(await readLaunchBoard(seeded(t, []), { today })));
  assert.ok(empty.querySelector(".launch-empty"));
  assert.equal(empty.querySelector(".launch-pulse"), null);
});

test("board markup stays inside the locale and uses the static date only without today", () => {
  const messages = { "launch.topTitle": "{days}日間のスター最多", "launch.more": "{count} 件すべて" };
  const document = fragment(launchBoardHtml(launchBoardFromProjects(catalog, { today }), messages, { basePath: "/ja", lang: "ja" }));
  assert.equal(document.querySelector(".launch-row__name").getAttribute("href"), "/ja/projects/a/quiet-one/");
  assert.equal(document.querySelector("a.launch-pulse__day").getAttribute("href").slice(0, 13), "/ja/launches/");
  assert.equal(document.querySelector(".launch-day__more").textContent, "8 件すべて");
  assert.equal(document.querySelector(".launch-day__more").getAttribute("href"), "/ja/launches/2026-10-18/");
  const top = document.querySelector(".launch-day--top .launch-day__date");
  assert.equal(top.textContent.replace(/\s+/g, ""), "30日間のスター最多");
  assert.equal(top.querySelector(".launch-day__num").textContent, String(LAUNCH_WINDOW));
  assert.equal(top.querySelector(".launch-day__month"), null, "a title that opens on the number has no empty slot before it");
  assert.equal(document.querySelectorAll('.launch-pulse__day.is-marked').length, 3);
  const fallback = fragment(launchBoardHtml(launchBoardFromProjects(catalog, { today }))).querySelector(".launch-day--top .launch-day__date");
  assert.equal(fallback.textContent.replace(/\s+/g, " ").trim(), "Most starred in 30 days", "stars measure attention, so the title does not call the list the best");

  const relative = fragment(launchBoardHtml(launchBoardFromProjects([launch("a/b", "2026-10-29", 9)], { today })));
  assert.equal(relative.querySelector(".launch-day__name").textContent, "Yesterday");
  assert.ok(relative.querySelector(".launch-day__name.is-relative"));
  const absolute = fragment(launchBoardHtml(launchBoardFromProjects([launch("a/b", "2026-10-29", 9)])));
  assert.equal(absolute.querySelector(".launch-day__name").textContent, "Thursday", "a prerendered page outlives the build");
});

test("a row escapes catalog text and only links real evidence", () => {
  const html = launchRowHtml(launch("o/r", "2026-10-22", 1234, { name: "<img src=x onerror=alert(1)>", desc: '"><script>alert(1)</script>', evidence: "javascript:alert(1)" }), 1);
  const document = fragment(`<ol>${html}</ol>`);
  assert.equal(document.querySelector("script"), null);
  assert.equal(document.querySelector(".launch-row__name img"), null);
  assert.equal(document.querySelector(".launch-row__source"), null);
  assert.equal(document.querySelector(".project-tile img"), null, "a failed avatar must leave the letter, not a broken image icon");
  assert.equal(document.querySelector(".project-tile").firstChild.textContent, "<");
  assert.match(document.querySelector(".project-tile__image").getAttribute("style"), /https:\/\/github\.com\/o\.png/);
  const stars = document.querySelector(".launch-row__stars");
  assert.equal(stars.getAttribute("href"), "https://github.com/o/r");
  assert.equal(stars.getAttribute("rel"), "ugc nofollow noopener noreferrer");
  assert.equal(stars.getAttribute("target"), "_blank");
  assert.match(stars.getAttribute("aria-label"), /1,234/);

  const cited = fragment(`<ol>${launchRowHtml(launch("o/r", "2026-10-22", 3), 2, {}, { showDate: true })}</ol>`);
  const source = cited.querySelector(".launch-row__source");
  assert.equal(source.textContent, "README.md:5 @8b22d43");
  assert.equal(source.getAttribute("rel"), "ugc nofollow noopener noreferrer");
  assert.equal(cited.querySelector(".launch-row__meta time").getAttribute("datetime"), "2026-10-22");
  assert.equal(cited.querySelector(".launch-row__rank.is-first"), null);
});

test("a day page lists every launch of that day in pages and links its neighbours", async t => {
  const busy = Array.from({ length: LAUNCH_PAGE_SIZE + 20 }, (_, index) => launch(`g/day-${index}`, "2026-10-21", index));
  const DB = seeded(t, [...catalog, ...busy]);
  const first = await readLaunchDay(DB, "2026-10-21", 1, { today });
  assert.equal(first.total, LAUNCH_PAGE_SIZE + 20);
  assert.equal(first.projects.length, LAUNCH_PAGE_SIZE);
  assert.equal(first.projects[0].repo, `g/day-${LAUNCH_PAGE_SIZE + 19}`);
  assert.equal(first.previous, "2026-10-20");
  assert.equal(first.next, "2026-10-22");
  const second = await readLaunchDay(DB, "2026-10-21", 2, { today });
  assert.equal(second.projects.length, 20);
  assert.ok(second.projects.at(-1).stars < LAUNCH_MIN_STARS, "the day page has no star floor");
  const newest = await readLaunchDay(DB, "2026-10-24", 1, { today });
  assert.equal(newest.next, null, "a future-dated row never becomes the next day");
  assert.equal(newest.pulse.at(-1).date, today);
  const old = await readLaunchDay(DB, "2026-09-01", 1, { today });
  assert.ok(old.pulse.some(day => day.date === "2026-09-01" && day.count === 1), "an older day stays on its own strip");
  assert.ok(old.pulse.at(-1).date < today);

  const view = launchDayView({ date: "2026-10-21", ...second, number: 2, pages: 2, basePath: "/fr", lang: "fr" });
  assert.equal(view.noindex, true);
  assert.equal(view.path, "/fr/launches/2026-10-21/2/");
  const document = fragment(view.body);
  assert.equal(document.querySelector(".launch-list").getAttribute("start"), String(LAUNCH_PAGE_SIZE + 1));
  assert.equal(document.querySelector(".launch-row__rank").textContent, String(LAUNCH_PAGE_SIZE + 1));
  assert.equal(document.querySelector('.catalog-pages [rel="prev"]').getAttribute("href"), "/fr/launches/2026-10-21/");
  assert.equal(document.querySelector('.launch-page__days [rel="next"]').getAttribute("href"), "/fr/launches/2026-10-22/");
  assert.equal(document.querySelector('a.launch-pulse__day[aria-current="date"]').getAttribute("href"), "/fr/launches/2026-10-21/");
});

test("the launches index opens the newest day, and with none still lands on the board", async t => {
  const DB = seeded(t, catalog.filter(project => project.created !== "2026-11-02"));
  const opened = await latestRoute(context(DB, "/launches/"));
  assert.equal(opened.status, 302);
  assert.equal(new URL(opened.headers.get("location")).pathname, "/launches/2026-10-24/");
  const localized = await localizedLatestRoute(context(DB, "/zh-cn/launches/", { locale: "zh-cn" }));
  assert.equal(new URL(localized.headers.get("location")).pathname, "/zh-cn/launches/2026-10-24/");
  const unknown = await localizedLatestRoute(context(DB, "/xx/launches/", { locale: "xx" }));
  assert.equal(await unknown.text(), "next");
  const english = await localizedLatestRoute(context(DB, "/en/launches/", { locale: "en" }));
  assert.equal(await english.text(), "next");

  const empty = seeded(t, []);
  const nothing = new URL((await latestRoute(context(empty, "/launches/"))).headers.get("location"));
  assert.equal(nothing.pathname + nothing.hash, "/#launches");
  const nothingLocalized = new URL((await localizedLatestRoute(context(empty, "/ja/launches/", { locale: "ja" }))).headers.get("location"));
  assert.equal(nothingLocalized.pathname + nothingLocalized.hash, "/ja/#launches");
  const broken = new URL((await latestRoute({ ...context(empty, "/launches/"), env: { ASSETS: assets } })).headers.get("location"));
  assert.equal(broken.pathname + broken.hash, "/#launches", "a database failure must not break the menu link");
});

test("day routes render real days and 404 everything else", async t => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const DB = seeded(t, [launch("h/one", yesterday, 12), launch("h/two", yesterday, 1)]);
  const response = await dayRoute(context(DB, `/launches/${yesterday}/`, { date: yesterday }));
  assert.equal(response.status, 200);
  const document = new JSDOM(await response.text()).window.document;
  assert.equal(document.querySelector('meta[name="robots"]').content, "noindex, nofollow");
  assert.equal(document.querySelector('link[rel="canonical"]').href, `https://jevhunt.com/launches/${yesterday}/`);
  assert.equal(document.querySelectorAll(".launch-row").length, 2);
  assert.ok(document.querySelector(".legal-nav .brand__word"));

  const translated = await localizedDayRoute(context(DB, `/zh-cn/launches/${yesterday}/`, { locale: "zh-cn", date: yesterday }));
  const localized = new JSDOM(await translated.text()).window.document;
  assert.equal(localized.documentElement.lang, "zh-CN");
  assert.equal(localized.querySelector(".launch-row__name").getAttribute("href"), "/zh-cn/projects/h/one/");

  for (const [date, page] of [["2026-13-45"], ["2026-02-31"], ["not-a-date"], ["2099-01-01"], ["2001-01-01"], [yesterday, "2"], [yesterday, "0"], [yesterday, "abc"]]) {
    const path = `/launches/${date}/${page ? `${page}/` : ""}`;
    assert.equal((await dayRoute(context(DB, path, { date, page: page ? [page] : undefined }))).status, 404, path);
  }
});
