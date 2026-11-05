import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { dailyHistory, selectDailyProjects, utcDay } from '../shared/daily-picks.js';

const fixture = Array.from({ length: 100 }, (_, index) => ({ repo: `owner/project-${index}`, name: `Project ${index}`, desc: 'An existing project.', cat: 'apps', created: '2025-01-01', pushed: '2026-01-02' }));
test('daily picks stay stable within a UTC day and span 1–8 unique projects across the year', () => {
  const counts = new Set(), selections = new Set();
  const saved = JSON.stringify(fixture);
  for (let index = 0; index < 366; index++) {
    const day = utcDay(new Date(Date.UTC(2028, 0, 1 + index)));
    const picks = selectDailyProjects(fixture, day);
    assert.ok(picks.length >= 1 && picks.length <= 8);
    assert.equal(new Set(picks.map(p => p.repo)).size, picks.length);
    assert.deepEqual(picks, selectDailyProjects([...fixture].reverse(), day));
    counts.add(picks.length); selections.add(picks.map(p => p.repo).join(','));
  }
  assert.equal(counts.size, 8);
  assert.ok(selections.size > 350);
  assert.equal(JSON.stringify(fixture), saved, 'Selection must not alter project facts or dates');
  assert.equal(utcDay(new Date('2026-11-05T20:00:00-05:00')), '2026-11-06');
  assert.throws(() => selectDailyProjects(fixture, '2026-02-30'));
});

test('daily selection excludes unavailable entries and handles a small pool without duplicates', () => {
  const good = fixture[0];
  const pool = [good, good, { ...fixture[1], archived: true }, { ...fixture[2], fork: true }, { ...fixture[3], desc: ' ' }, { ...fixture[4], cat: 'lists' }, { ...fixture[5], repo: 'invalid' }];
  assert.deepEqual(selectDailyProjects(pool, '2026-11-05'), [good]);
  assert.deepEqual(selectDailyProjects([], '2026-11-05'), []);
});

async function boot(t, { locale = 'en', fail = false, seed = true, query = '' } = {}) {
  const prefix = locale === 'en' ? '' : '/' + locale;
  const dom = new JSDOM(readFileSync(`public${prefix}/index.html`, 'utf8'), { url: `https://jevhunt.com${prefix}/${query}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  let now = '2026-11-05T00:01:00Z';
  const NativeDate = window.Date;
  window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return new NativeDate(now).getTime(); } };
  const timers = [];
  window.setTimeout = callback => timers.push(callback);
  window.eval(readFileSync(`public/assets/js/locales/${locale}.js`, 'utf8'));
  const pool = JSON.parse(readFileSync('public/assets/daily-picks.json', 'utf8'));
  const seedElement = window.document.getElementById('dailySelectionSeed');
  if (seed) seedElement.textContent = JSON.stringify({ days: dailyHistory(pool, '2026-11-12', 37) });
  else seedElement.remove();
  const requests = [];
  window.fetch = async path => {
    requests.push(path);
    assert.match(path, /^\/assets\/daily-picks\.json\?v=[a-f0-9]+$/);
    if (fail) throw new Error('Offline');
    return Response.json(pool);
  };
  await window.eval('(async () => {' + readFileSync('public/assets/js/daily-picks.js', 'utf8') + '})()');
  return { window, document: window.document, requests, timers, pool, setDate: date => { now = date; } };
}

const names = group => [...group.querySelectorAll('.launch-row__name')].map(node => node.textContent);
const flush = () => new Promise(resolve => setImmediate(resolve));

test('the homepage restores the 30-day chart and today, yesterday and the day before without a fetch', async t => {
  const { document, requests, pool } = await boot(t, { locale: 'zh-cn' });
  const board = document.getElementById('launchBoard');
  assert.equal(document.getElementById('launchesTitle').textContent, '每日精选');
  assert.equal(board.dataset.selectionDay, '2026-11-05');
  assert.equal(board.querySelectorAll('.launch-pulse__day').length, 30);
  const groups = [...board.querySelectorAll('.launch-day')];
  assert.deepEqual(groups.map(group => group.dataset.pickDate), ['2026-11-05', '2026-11-04', '2026-11-03']);
  assert.deepEqual(groups.map(group => group.querySelector('.launch-day__name').textContent), ['今天', '昨天', '前天']);
  for (const group of groups) assert.deepEqual(names(group), selectDailyProjects(pool, group.dataset.pickDate).map(p => p.name));
  assert.equal(board.querySelectorAll('.project-tile__image').length, 0);
  assert.equal(requests.length, 0, 'The first render and embedded dates work without downloading the full pool');
});

test('each date opens its own fixed selection, with previous/next and return to recent days', async t => {
  const { window, document, requests, pool } = await boot(t, { query: '?q=jev' });
  const board = document.getElementById('launchBoard');
  const click = selector => board.querySelector(selector).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  click('[data-pick-day="2026-10-23"]');
  assert.equal(new URL(window.location.href).searchParams.get('pick-day'), '2026-10-23');
  assert.equal(new URL(window.location.href).searchParams.get('q'), 'jev');
  assert.equal(board.querySelectorAll('.launch-day').length, 1);
  assert.deepEqual(names(board.querySelector('.launch-day')), selectDailyProjects(pool, '2026-10-23').map(p => p.name));
  click('[rel="prev"]');
  assert.equal(board.querySelector('.launch-day').dataset.pickDate, '2026-10-22');
  click('[rel="next"]');
  assert.equal(board.querySelector('.launch-day').dataset.pickDate, '2026-10-23');
  click('[data-pick-day=""]');
  assert.equal(board.querySelectorAll('.launch-day').length, 3);
  assert.equal(new URL(window.location.href).searchParams.get('pick-day'), null);
  window.history.replaceState({}, '', '?pick-day=2026-10-19#launches');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  assert.equal(board.querySelector('.launch-day').dataset.pickDate, '2026-10-19');
  assert.equal(requests.length, 0, 'Date navigation must not query D1, GitHub or a server API');
});

test('a direct date link hydrates that day and future dates do not leak into the chart', async t => {
  const selected = await boot(t, { query: '?pick-day=2026-10-21#launches' });
  assert.equal(selected.document.querySelector('#launchBoard .launch-day').dataset.pickDate, '2026-10-21');
  const future = await boot(t, { query: '?pick-day=2026-11-06#launches' });
  assert.equal(future.document.querySelectorAll('#launchBoard .launch-day').length, 3);
  assert.equal(future.document.querySelector('#launchBoard [data-pick-day="2026-11-06"]'), null);
});

test('midnight preserves yesterday’s selection and an expired seed uses one reusable static pool', async t => {
  const { window, document, requests, timers, setDate } = await boot(t);
  const board = document.getElementById('launchBoard');
  const today = names(board.querySelector('[data-pick-date="2026-11-05"]'));
  setDate('2026-11-06T00:00:01Z');
  timers.shift()();
  await flush();
  assert.equal(board.dataset.selectionDay, '2026-11-06');
  assert.deepEqual(names(board.querySelector('[data-pick-date="2026-11-05"]')), today);
  assert.equal(requests.length, 0);
  setDate('2026-11-13T00:00:01Z');
  document.dispatchEvent(new window.Event('visibilitychange'));
  await flush();
  assert.equal(board.dataset.selectionDay, '2026-11-13');
  assert.equal(requests.length, 1);
  setDate('2026-11-14T00:00:01Z');
  document.dispatchEvent(new window.Event('visibilitychange'));
  await flush();
  assert.equal(board.dataset.selectionDay, '2026-11-14');
  assert.equal(requests.length, 1);
});

test('network failure retains the complete prerendered chart and three dated groups', async t => {
  const { document, requests } = await boot(t, { seed: false, fail: true });
  assert.equal(document.getElementById('launchesTitle').textContent, 'Daily picks');
  assert.equal(document.querySelectorAll('#launchBoard .launch-pulse__day').length, 30);
  assert.equal(document.querySelectorAll('#launchBoard .launch-day').length, 3);
  assert.equal(document.getElementById('launchBoard').dataset.selectionDay, undefined);
  assert.equal(requests.length, 1);
});

test('every locale ships the full first-paint layout and no source-sync schedule remains', () => {
  for (const file of readdirSync('public/assets/js/locales')) {
    const locale = file.replace(/\.js$/, '');
    const html = readFileSync(`public${locale === 'en' ? '' : '/' + locale}/index.html`, 'utf8');
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('#launchBoard .launch-pulse__day').length, 30, locale);
    assert.equal(doc.querySelectorAll('#launchBoard .launch-day').length, 3, locale);
    assert.equal(JSON.parse(doc.getElementById('dailySelectionSeed').textContent).days.length, 37);
    assert.equal(doc.querySelectorAll('script[src^="/assets/js/daily-picks.js"]').length, 1);
    assert.ok(doc.querySelector('a[data-i18n="launch.browse"]').href.endsWith('#dailyHistory'));
    for (const group of doc.querySelectorAll('#launchBoard .launch-day')) assert.ok(group.querySelectorAll('.launch-row').length >= 1 && group.querySelectorAll('.launch-row').length <= 8);
    dom.window.close();
  }
  for (const file of readdirSync('.github/workflows')) assert.doesNotMatch(readFileSync('.github/workflows/' + file, 'utf8'), /\b(?:schedule|cron):/);
});
