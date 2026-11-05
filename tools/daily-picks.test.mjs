import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { selectDailyProjects, utcDay } from '../shared/daily-picks.js';

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

async function boot(t, locale = 'en', fail = false) {
  const prefix = locale === 'en' ? '' : '/' + locale;
  const dom = new JSDOM(readFileSync(`public${prefix}/index.html`, 'utf8'), { url: `https://jevhunt.com${prefix}/`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  let now = '2026-11-05T00:01:00Z';
  const NativeDate = window.Date;
  window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return new NativeDate(now).getTime(); } };
  const timers = [];
  window.setTimeout = callback => timers.push(callback);
  window.eval(readFileSync(`public/assets/js/locales/${locale}.js`, 'utf8'));
  const requests = [];
  window.fetch = async path => {
    requests.push(path);
    assert.match(path, /^\/assets\/daily-picks\.json\?v=[a-f0-9]+$/);
    if (fail) throw new Error('Offline');
    return Response.json(JSON.parse(readFileSync('public/assets/daily-picks.json', 'utf8')));
  };
  await window.eval('(async () => {' + readFileSync('public/assets/js/daily-picks.js', 'utf8') + '})()');
  return { window, document: window.document, requests, timers, setDate: date => { now = date; } };
}

test('the homepage rotates existing static projects at midnight without additional network requests', async t => {
  const { window, document, requests, timers, setDate } = await boot(t, 'zh-cn');
  const pool = JSON.parse(readFileSync('public/assets/daily-picks.json', 'utf8'));
  const board = document.getElementById('launchBoard');
  assert.equal(document.getElementById('launchesTitle').textContent, '今日精选');
  assert.equal(board.dataset.selectionDay, '2026-11-05');
  assert.equal(board.querySelectorAll('.launch-row').length, selectDailyProjects(pool, '2026-11-05').length);
  assert.equal(board.querySelectorAll('.project-tile__image').length, 0, 'Daily picks must not request external avatars');
  const previous = board.innerHTML;
  document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(board.innerHTML, previous);
  setDate('2026-11-06T00:00:01Z');
  timers.shift()();
  assert.equal(board.dataset.selectionDay, '2026-11-06');
  assert.notEqual(board.innerHTML, previous);
  assert.equal(requests.length, 1, 'Daily rotation reuses the static file, without D1, GitHub or API calls');
  const names = [...board.querySelectorAll('.launch-row__name')];
  assert.deepEqual(names.map(node => node.textContent), selectDailyProjects(pool, '2026-11-06').map(p => p.name));
  for (const link of names) assert.match(link.getAttribute('href'), /^\/(?:project\/\?repo=|(?:zh-cn\/)?projects\/)/);
});

test('network failure keeps useful catalog picks without claiming they are today’s selection', async t => {
  const { document, requests } = await boot(t, 'en', true);
  assert.equal(document.getElementById('launchesTitle').textContent, 'Catalog picks');
  assert.ok(document.querySelector('#launchBoard .launch-row__name'));
  assert.equal(document.getElementById('launchBoard').dataset.selectionDay, undefined);
  assert.equal(requests.length, 1);
});

test('all home languages offer daily picks, and no source-sync schedule remains', () => {
  for (const file of readdirSync('public/assets/js/locales')) {
    const locale = file.replace(/\.js$/, '');
    const html = readFileSync(`public${locale === 'en' ? '' : '/' + locale}/index.html`, 'utf8');
    assert.match(html, /data-daily-source="\/assets\/daily-picks\.json\?v=/);
    assert.match(html, /data-i18n="daily.lead"/);
    assert.equal((html.match(/src="\/assets\/js\/daily-picks\.js/g) || []).length, 1);
  }
  for (const file of readdirSync('.github/workflows')) assert.doesNotMatch(readFileSync('.github/workflows/' + file, 'utf8'), /\b(?:schedule|cron):/);
});
