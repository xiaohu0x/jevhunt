import { validRepo } from './catalog-data.js';
import { launchRowHtml } from './catalog-launches.js';
import { esc } from './render.js';

export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);
export const shiftPickDate = (day, offset) => utcDay(new Date(Date.parse(day + 'T12:00:00Z') + offset * 86400000));

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

export function dailyHistory(projects, today = utcDay(), length = 30) {
  return Array.from({ length }, (_, index) => {
    const date = shiftPickDate(today, index + 1 - length);
    return { date, projects: selectDailyProjects(projects, date) };
  });
}

export function dailyBoardHtml(history, messages = {}, { today = utcDay(), selected = null, basePath = '', lang = 'en', relative = true } = {}) {
  const days = history.filter(day => day.date <= today && day.date >= shiftPickDate(today, -29));
  if (!days.length) return '';
  const shown = selected && days.some(day => day.date === selected) ? days.filter(day => day.date === selected) : days.slice(-3).reverse();
  const url = date => `${basePath}/?pick-day=${date}#launches`;
  const numbers = new Intl.NumberFormat(lang);
  const format = (date, options) => new Intl.DateTimeFormat(lang, { ...options, timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
  const short = date => format(date, { month: 'short', day: 'numeric' });
  const title = messages['daily.pulse'] || 'Daily picks · last 30 days';
  const peak = Math.max(1, ...days.map(day => day.projects.length));
  const bars = days.map(day => {
    const count = day.projects.length, marked = shown.some(item => item.date === day.date);
    return `<a class="launch-pulse__day${marked ? ' is-marked' : ''}" href="${url(day.date)}" data-pick-day="${day.date}" style="--h:${Math.round(count / peak * 100)}%" aria-label="${esc(short(day.date) + ': ' + numbers.format(count))}"${day.date === (selected || today) ? ' aria-current="date"' : ''}><span class="launch-pulse__bar"></span><span class="launch-pulse__tip" aria-hidden="true"><strong>${numbers.format(count)}</strong> ${esc(short(day.date))}</span></a>`;
  }).join('');
  const pulse = `<nav class="launch-pulse" id="dailyHistory" aria-label="${esc(title)}"><p class="launch-pulse__title">${esc(title)} · UTC</p><div class="launch-pulse__bars">${bars}</div><div class="launch-pulse__axis"><span>${esc(short(days[0].date))}</span><span>${esc(short(days.at(-1).date))}</span></div></nav>`;
  const navigation = selected && shown.length === 1 ? `<nav class="launch-page__days" aria-label="${esc(messages['launch.browse'] || 'Browse by day')}">${shown[0].date > days[0].date ? `<a href="${url(shiftPickDate(selected, -1))}" data-pick-day="${shiftPickDate(selected, -1)}" rel="prev">${esc(messages['launch.previousDay'] || 'Previous day')}</a>` : ''}<a href="${basePath}/#launches" data-pick-day="">${esc(messages['daily.latest'] || 'Latest days')}</a>${selected < today ? `<a href="${url(shiftPickDate(selected, 1))}" data-pick-day="${shiftPickDate(selected, 1)}" rel="next">${esc(messages['launch.nextDay'] || 'Next day')}</a>` : ''}</nav>` : '';
  const groups = shown.map(day => {
    const age = Math.round((Date.parse(today) - Date.parse(day.date)) / 86400000);
    let label = relative && age <= 2 ? new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-age || 0, 'day') : format(day.date, { weekday: 'long' });
    label = label.charAt(0).toLocaleUpperCase(lang) + label.slice(1);
    const rows = day.projects.map((project, index) => launchRowHtml(project, index + 1, messages, { basePath, lang, showAvatar: false })).join('');
    return `<section class="launch-day" id="pick-${day.date}" data-pick-date="${day.date}" aria-labelledby="pick-title-${day.date}"><h3 class="launch-day__date" id="pick-title-${day.date}"><time class="launch-day__stack" datetime="${day.date}"><span class="launch-day__month">${esc(format(day.date, { month: 'short' }))}</span><span class="launch-day__num">${Number(day.date.slice(8))}</span><span class="launch-day__name${relative && age <= 2 ? ' is-relative' : ''}">${esc(label)}</span></time></h3><div class="launch-day__rows"><ol class="launch-list">${rows}</ol></div></section>`;
  }).join('');
  return pulse + navigation + groups;
}
