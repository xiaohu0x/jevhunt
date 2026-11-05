import { validRepo } from './catalog-data.js';
import { launchRowHtml } from './catalog-launches.js';
import { esc } from './render.js';

export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

// A date seeds a local shuffle. Visiting, refreshing or changing language does
// not call a service, change repository facts or consume another daily run.
export function selectDailyProjects(projects, day = utcDay()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || utcDay(new Date(day)) !== day) throw new Error('Invalid selection date');
  const eligible = new Map();
  for (const project of projects) {
    if (validRepo(project.repo) && !project.archived && !project.fork && project.cat !== 'lists' && String(project.desc || '').trim()) eligible.set(project.repo.toLowerCase(), project);
  }
  const pool = [...eligible].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, project]) => project);
  let seed = 2166136261;
  for (const char of 'jevhunt-daily-v1:' + day) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const count = Math.min(pool.length, 1 + Math.floor(random() * 8));
  for (let index = 0; index < count; index++) {
    const other = index + Math.floor(random() * (pool.length - index));
    [pool[index], pool[other]] = [pool[other], pool[index]];
  }
  return pool.slice(0, count);
}

export function dailyPicksHtml(projects, day, messages = {}, { basePath = '', lang = 'en' } = {}) {
  const date = day ? `<p class="home-section__lead"><time datetime="${esc(day)}">${esc(new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z')))} · UTC</time></p>` : '';
  return date + '<ol class="launch-list">' + projects.map((project, index) => launchRowHtml(project, index + 1, messages, { basePath, lang, showAvatar: false })).join('') + '</ol>';
}
