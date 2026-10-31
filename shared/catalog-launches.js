import { activeClause } from "./catalog-data.js";
import { isVerified } from "./catalog-featured.js";
import { esc, projectPath, repoUrl } from "./render.js";

/**
 * The launch board: a repository launches on the day it was created and its
 * GitHub stars are the votes. Everything in a day group started on the same
 * date, so star counts inside a group compare directly. Stars measure attention
 * rather than quality, so the board says "most starred" and never "best". A
 * repository with no description is not a launch, because a row could not say
 * what it does. Neither is a list, which points at other projects instead of
 * launching one; the directory keeps those under Directories & Lists.
 */
export const LAUNCH_DAYS = 3;
export const LAUNCH_ROWS = 6;
export const LAUNCH_TOP = 8;
export const LAUNCH_WINDOW = 30;
export const LAUNCH_PAGE_SIZE = 50;
/** The board lists launches with this many stars and the day pages list them all, like featured and all products on a launch site. launch.lead and launch.empty repeat the number. */
export const LAUNCH_MIN_STARS = 5;

const RELATION_LABELS = {
  "jev-app": "Jev application",
  integration: "Integration",
  sdk: "SDK / client",
  "local-alternative": "Local alternative",
  research: "Research",
  resource: "Resource / directory",
  unclassified: "Relationship under review",
};
const LAUNCH_WHERE = `${activeClause} AND category <> 'lists' AND json_extract(preview,'$.fork') IS NOT 1 AND json_extract(preview,'$.archived') IS NOT 1 AND created GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND TRIM(COALESCE(json_extract(preview,'$.desc'),'')) <> ''`;
const LAUNCH_ORDER = "stars DESC, name COLLATE NOCASE, repo";
const DAY_MS = 86400000;
const STAR_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2.8l2.85 5.86 6.45.92-4.67 4.53 1.1 6.42L12 17.5l-5.73 3.03 1.1-6.42L2.7 9.58l6.45-.92z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

export const utcToday = () => new Date().toISOString().slice(0, 10);
export const isLaunchDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const shiftDate = (date, days) => new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
const noon = date => new Date(date + "T12:00:00Z");
const compareLaunch = (a, b) => (Number(b.stars) || 0) - (Number(a.stars) || 0)
  || String(a.name).localeCompare(String(b.name), "en", { sensitivity: "base" })
  || String(a.repo).localeCompare(String(b.repo));

function pulseFrom(counts, end) {
  return Array.from({ length: LAUNCH_WINDOW }, (_, index) => {
    const date = shiftDate(end, index + 1 - LAUNCH_WINDOW);
    return { date, count: counts.get(date) || 0 };
  });
}

const emptyBoard = today => ({ today, days: [], top: [], pulse: [] });
const isLaunch = project => project.cat !== "lists" && project.fork !== true && project.archived !== true && isLaunchDate(project.created) && String(project.desc ?? "").trim() !== "";
const countsByDate = rows => new Map(rows.map(row => [row.date, row.count]));
/** The strip ends today so a quiet spell reads as empty days, unless the whole window would be blank. */
const pulseEnd = (anchor, today) => today && anchor >= shiftDate(today, 1 - LAUNCH_WINDOW) ? today : anchor;

/** Static-build board. Without `today` the labels stay absolute, because the page outlives the build. */
export function launchBoardFromProjects(projects, { today = null } = {}) {
  const launches = projects.filter(project => isLaunch(project) && (!today || project.created <= today));
  const anchor = launches.reduce((latest, project) => project.created > latest ? project.created : latest, "");
  if (!anchor) return emptyBoard(today);
  const from = shiftDate(anchor, 1 - LAUNCH_WINDOW);
  const ranked = launches.filter(project => project.created >= from).sort(compareLaunch);
  const counts = new Map();
  for (const project of ranked) counts.set(project.created, (counts.get(project.created) || 0) + 1);
  const notable = ranked.filter(project => Number(project.stars) >= LAUNCH_MIN_STARS);
  const days = [...new Set(notable.map(project => project.created))].sort().reverse().slice(0, LAUNCH_DAYS).map(date => ({
    date, count: counts.get(date), projects: notable.filter(project => project.created === date).slice(0, LAUNCH_ROWS),
  }));
  return { today, days, top: notable.slice(0, LAUNCH_TOP), pulse: pulseFrom(counts, pulseEnd(anchor, today)) };
}

async function readLaunchCounts(DB, from, to) {
  const { results } = await DB.prepare(`SELECT created AS date, COUNT(*) AS count, COALESCE(SUM(stars >= ?), 0) AS notable FROM catalog_entries WHERE ${LAUNCH_WHERE} AND created BETWEEN ? AND ? GROUP BY created`).bind(LAUNCH_MIN_STARS, from, to).all();
  return results.map(row => ({ date: row.date, count: Number(row.count), notable: Number(row.notable) }));
}

export async function latestLaunchDate(DB, today = utcToday()) {
  const row = await DB.prepare(`SELECT created AS date FROM catalog_entries WHERE ${LAUNCH_WHERE} AND created <= ? ORDER BY created DESC LIMIT 1`).bind(today).first();
  return row?.date || null;
}

/** Live board. It anchors to the newest launch so a slow discovery week never empties the page. */
export async function readLaunchBoard(DB, { today = utcToday() } = {}) {
  const anchor = await latestLaunchDate(DB, today);
  if (!anchor) return emptyBoard(today);
  const from = shiftDate(anchor, 1 - LAUNCH_WINDOW);
  const counted = await readLaunchCounts(DB, from, anchor);
  const pulse = pulseFrom(countsByDate(counted), pulseEnd(anchor, today));
  const dates = counted.filter(row => row.notable).map(row => row.date).sort().reverse().slice(0, LAUNCH_DAYS);
  if (!dates.length) return { today, days: [], top: [], pulse };
  const [dayRows, topRows] = await Promise.all([
    DB.prepare(`SELECT data, date FROM (SELECT preview AS data, created AS date, ROW_NUMBER() OVER (PARTITION BY created ORDER BY ${LAUNCH_ORDER}) AS position FROM catalog_entries WHERE ${LAUNCH_WHERE} AND stars >= ? AND created IN (${dates.map(() => "?").join(",")})) WHERE position <= ? ORDER BY date DESC, position`).bind(LAUNCH_MIN_STARS, ...dates, LAUNCH_ROWS).all(),
    DB.prepare(`SELECT preview AS data FROM catalog_entries WHERE ${LAUNCH_WHERE} AND stars >= ? AND created BETWEEN ? AND ? ORDER BY ${LAUNCH_ORDER} LIMIT ?`).bind(LAUNCH_MIN_STARS, from, anchor, LAUNCH_TOP).all(),
  ]);
  const counts = countsByDate(counted);
  const days = dates.map(date => ({
    date, count: counts.get(date), projects: dayRows.results.filter(row => row.date === date).map(row => JSON.parse(row.data)),
  }));
  return { today, days, top: topRows.results.map(row => JSON.parse(row.data)), pulse };
}

export async function readLaunchDay(DB, date, number = 1, { today = utcToday() } = {}) {
  // Recent days share one strip, so the bars hold still while paging; an older day sits mid-strip.
  const end = date >= shiftDate(today, 1 - LAUNCH_WINDOW) ? today : shiftDate(date, LAUNCH_WINDOW / 2);
  const [total, rows, previous, next, counted] = await Promise.all([
    DB.prepare(`SELECT COUNT(*) AS n FROM catalog_entries WHERE ${LAUNCH_WHERE} AND created = ?`).bind(date).first(),
    DB.prepare(`SELECT preview AS data FROM catalog_entries WHERE ${LAUNCH_WHERE} AND created = ? ORDER BY ${LAUNCH_ORDER} LIMIT ? OFFSET ?`).bind(date, LAUNCH_PAGE_SIZE, (number - 1) * LAUNCH_PAGE_SIZE).all(),
    DB.prepare(`SELECT created AS date FROM catalog_entries WHERE ${LAUNCH_WHERE} AND created < ? ORDER BY created DESC LIMIT 1`).bind(date).first(),
    DB.prepare(`SELECT created AS date FROM catalog_entries WHERE ${LAUNCH_WHERE} AND created > ? AND created <= ? ORDER BY created LIMIT 1`).bind(date, today).first(),
    readLaunchCounts(DB, shiftDate(end, 1 - LAUNCH_WINDOW), end),
  ]);
  return {
    total: Number(total?.n || 0),
    projects: rows.results.map(row => JSON.parse(row.data)),
    previous: previous?.date || null,
    next: next?.date || null,
    pulse: pulseFrom(countsByDate(counted), end),
  };
}

export const launchProjects = board => [...board.days.flatMap(day => day.projects), ...board.top];

export function mapLaunchProjects(board, map) {
  return { ...board, days: board.days.map(day => ({ ...day, projects: day.projects.map(map) })), top: board.top.map(map) };
}

/** `README.md:191 @8b22d43` from a permalink. Only the file name is kept; the link carries the full path. */
export function evidenceCitation(url) {
  const match = /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/([0-9a-f]{7,40})\/([^#?]+)(?:#L(\d+)(?:-L(\d+))?)?$/i.exec(String(url || ""));
  if (!match) return "";
  const [, commit, path, start, end] = match;
  const encoded = path.split("/").at(-1);
  let file = encoded;
  try { file = decodeURIComponent(encoded); } catch { /* Keep a malformed escape readable rather than dropping the citation. */ }
  const lines = start ? `:${start}${end && end !== start ? `-${end}` : ""}` : "";
  return `${file}${lines} @${commit.slice(0, 7)}`;
}

export function projectTileHtml(project, lang = "en") {
  const repo = String(project.repo || "");
  const initial = Array.from(project.name || repo.split("/").at(-1) || "J")[0].toLocaleUpperCase(lang);
  const owner = repo.split("/")[0].replace(/[^A-Za-z0-9-]/g, "");
  // A background layer over the letter: a failed avatar leaves the letter, not a broken image icon.
  return `<span class="project-tile" aria-hidden="true">${esc(initial)}${owner ? `<span class="project-tile__image" style="background-image:url('https://github.com/${owner}.png?size=88')"></span>` : ""}</span>`;
}

export function launchRowHtml(project, position, messages = {}, { basePath = "", lang = "en", showDate = false } = {}) {
  const text = (key, fallback) => messages[key] || fallback;
  const repo = String(project.repo || "");
  const name = project.name || repo.split("/").at(-1);
  const kind = Object.hasOwn(RELATION_LABELS, project.relationship) ? project.relationship : "unclassified";
  const stars = Number(project.stars) || 0;
  const starLabel = text("launch.star", "Star {name} on GitHub. Current stars: {count}")
    .replace("{name}", () => name).replace("{count}", () => new Intl.NumberFormat(lang).format(stars));
  const compact = new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 }).format(stars);
  const evidenceText = text("apps.evidence", "Evidence");
  const citation = evidenceCitation(project.evidence);
  const source = /^https:\/\//.test(project.evidence || "")
    ? `<a class="launch-row__source" href="${esc(project.evidence)}" target="_blank" rel="ugc nofollow noopener noreferrer" aria-label="${esc(citation ? `${evidenceText}: ${citation}` : evidenceText)}">${esc(citation || evidenceText)}</a>`
    : "";
  const launched = showDate && isLaunchDate(project.created)
    ? `<time datetime="${esc(project.created)}">${esc(new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", timeZone: "UTC" }).format(noon(project.created)))}</time>`
    : "";
  const verified = isVerified(project)
    ? `<span class="launch-row__verified" role="img" aria-label="${esc(text("home.verified", "Verified"))}" title="${esc(text("apps.verifiedHint", "Documented evidence, a description and a recent catalog check"))}">${CHECK_ICON}</span>`
    : "";
  return `<li class="launch-row"><span class="launch-row__rank${position === 1 ? " is-first" : ""}">${position}</span>${projectTileHtml(project, lang)}<div class="launch-row__body"><div class="launch-row__title"><a class="launch-row__name" href="${projectPath(repo, basePath)}">${esc(name)}</a>${verified}</div><p class="launch-row__desc">${esc(project.desc)}</p><div class="launch-row__meta">${launched}<span>${esc(text(`relationship.${kind}`, RELATION_LABELS[kind]))}</span>${project.language ? `<span>${esc(project.language)}</span>` : ""}${source}</div></div><a class="launch-row__stars" href="${esc(repoUrl(repo))}" target="_blank" rel="ugc nofollow noopener noreferrer" aria-label="${esc(starLabel)}">${STAR_ICON}<span>${esc(compact)}</span></a></li>`;
}

/** One series, so the bars share a neutral fill and the accent only marks the days listed below. */
export function launchPulseHtml(pulse, messages = {}, { basePath = "", lang = "en", marked = [], current = null } = {}) {
  if (!pulse?.length) return "";
  const title = messages["launch.pulse"] || "Launches per day, past 30 days";
  const peak = Math.max(...pulse.map(day => day.count));
  const peakAt = pulse.findIndex(day => day.count === peak);
  const numbers = new Intl.NumberFormat(lang);
  const short = new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", timeZone: "UTC" });
  const label = date => short.format(noon(date));
  const bars = pulse.map((day, index) => {
    const tip = `<span class="launch-pulse__tip" aria-hidden="true"><strong>${esc(numbers.format(day.count))}</strong> ${esc(label(day.date))}</span>`;
    if (!day.count) return `<span class="launch-pulse__day is-empty"><span class="launch-pulse__bar"></span>${tip}</span>`;
    const isMarked = marked.includes(day.date) || day.date === current;
    return `<a class="launch-pulse__day${isMarked ? " is-marked" : ""}" href="${basePath}/launches/${day.date}/" style="--h:${Math.round(day.count / peak * 100)}%" aria-label="${esc(`${label(day.date)}: ${numbers.format(day.count)}`)}"${day.date === current ? ' aria-current="date"' : ""}><span class="launch-pulse__bar"></span>${index === peakAt ? `<span class="launch-pulse__peak" aria-hidden="true">${esc(numbers.format(peak))}</span>` : ""}${tip}</a>`;
  }).join("");
  return `<nav class="launch-pulse" aria-label="${esc(title)}"><p class="launch-pulse__title">${esc(title)}</p><div class="launch-pulse__bars">${bars}</div><div class="launch-pulse__axis" aria-hidden="true"><span>${esc(label(pulse[0].date))}</span><span>${esc(label(pulse.at(-1).date))}</span></div></nav>`;
}

function launchDayHtml(day, messages, { basePath, lang, today }) {
  const date = noon(day.date);
  const part = options => new Intl.DateTimeFormat(lang, { ...options, timeZone: "UTC" }).format(date);
  const age = today ? Math.round((Date.parse(today) - Date.parse(day.date)) / DAY_MS) : null;
  const relative = age === 0 || age === 1 ? new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(-age || 0, "day") : "";
  const dayName = relative ? relative.charAt(0).toLocaleUpperCase(lang) + relative.slice(1) : part({ weekday: "long" });
  const rows = day.projects.map((project, index) => launchRowHtml(project, index + 1, messages, { basePath, lang })).join("");
  const more = day.count > day.projects.length
    ? `<a class="launch-day__more" href="${basePath}/launches/${day.date}/">${esc((messages["launch.more"] || "See all {count} from this day").replace("{count}", () => new Intl.NumberFormat(lang).format(day.count)))}</a>`
    : "";
  return `<div class="launch-day" id="launch-${day.date}"><h3 class="launch-day__date"><time class="launch-day__stack" datetime="${day.date}"><span class="launch-day__month">${esc(part({ month: "short" }))}</span><span class="launch-day__num">${Number(day.date.slice(8))}</span><span class="launch-day__name${relative ? " is-relative" : ""}">${esc(dayName)}</span></time></h3><div class="launch-day__rows"><ol class="launch-list">${rows}</ol>${more}</div></div>`;
}

export function launchBoardHtml(board, messages = {}, { basePath = "", lang = "en" } = {}) {
  const pulse = launchPulseHtml(board?.pulse, messages, { basePath, lang, marked: (board?.days || []).map(day => day.date) });
  if (!board?.days?.length) return `${pulse}<p class="launch-empty">${esc(messages["launch.empty"] || "No launch has reached 5 stars yet. Browse by day to see every launch.")}</p>`;
  const days = board.days.map(day => launchDayHtml(day, messages, { basePath, lang, today: board.today })).join("");
  const listed = new Set(board.days.flatMap(day => day.projects.map(project => project.repo)));
  // With very few launches the top list would only repeat the day groups.
  if (!board.top.some(project => !listed.has(project.repo))) return pulse + days;
  // The title stacks around the number, like the date beside each day group.
  const [before, after = ""] = (messages["launch.topTitle"] || "Most starred in {days} days").split("{days}");
  const rows = board.top.map((project, index) => launchRowHtml(project, index + 1, messages, { basePath, lang, showDate: true })).join("");
  return `${pulse}${days}<div class="launch-day launch-day--top"><h3 class="launch-day__date"><span class="launch-day__stack">${before.trim() ? `<span class="launch-day__month">${esc(before.trim())}</span> ` : ""}<span class="launch-day__num">${LAUNCH_WINDOW}</span> <span class="launch-day__name">${esc(after.trim())}</span></span></h3><div class="launch-day__rows"><ol class="launch-list">${rows}</ol></div></div>`;
}

/** /launches/<date>/ — every launch from one day. Thin by design, so it stays out of the index. */
export function launchDayView({ date, projects, number = 1, pages = 1, pulse = [], previous = null, next = null, messages = {}, basePath = "", lang = "en" }) {
  const text = (key, fallback) => messages[key] || fallback;
  const base = `${basePath}/launches/${date}/`;
  const title = text("launch.dayTitle", "Launches on {date}").replace("{date}", () => new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(noon(date)));
  const description = text("launch.dayLead", "Repositories created on this date, ranked by GitHub stars. They launched the same day, so their stars compare directly.");
  const offset = (number - 1) * LAUNCH_PAGE_SIZE;
  const rows = projects.map((project, index) => launchRowHtml(project, offset + index + 1, messages, { basePath, lang })).join("");
  const days = [
    previous ? `<a rel="prev" href="${basePath}/launches/${previous}/">${esc(text("launch.previousDay", "Previous day"))}</a>` : "",
    next ? `<a rel="next" href="${basePath}/launches/${next}/">${esc(text("launch.nextDay", "Next day"))}</a>` : "",
  ].join("");
  const pager = pages > 1
    ? `<nav class="catalog-pages" aria-label="${esc(text("apps.page", "Page {page} of {pages}").replace("{page}", number).replace("{pages}", pages))}">${number > 1 ? `<a rel="prev" href="${number === 2 ? base : `${base}${number - 1}/`}">${esc(text("apps.previous", "Previous"))}</a>` : ""} <span>${esc(text("apps.page", "Page {page} of {pages}").replace("{page}", number).replace("{pages}", pages))}</span> ${number < pages ? `<a rel="next" href="${base}${number + 1}/">${esc(text("apps.next", "Next"))}</a>` : ""}</nav>`
    : "";
  return {
    title,
    description,
    path: number === 1 ? base : `${base}${number}/`,
    noindex: true,
    body: `<div class="launch-page"><header class="legal__header launch-page__head"><nav class="breadcrumbs" aria-label="${esc(text("project.breadcrumb", "Breadcrumb"))}"><a href="${basePath}/">JevHunt</a> / ${esc(text("nav.launches", "Launches"))}</nav><h1>${esc(title)}</h1><p class="legal__summary">${esc(description)}</p></header>${launchPulseHtml(pulse, messages, { basePath, lang, current: date })}<nav class="launch-page__days" aria-label="${esc(text("launch.browse", "Browse by day"))}">${days}</nav><ol class="launch-list launch-list--long" start="${offset + 1}">${rows}</ol>${pager}</div>`,
  };
}
