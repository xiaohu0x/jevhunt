import { dailyPicksHtml, selectDailyProjects, utcDay } from '../shared/daily-picks.js';
import { localizeStaticProjects } from '../public/assets/js/catalog-locales.js';

const board = document.querySelector('#launchBoard[data-daily-source]');
if (board && document.documentElement.dataset.catalogMode === 'static') {
  const localeKey = document.documentElement.dataset.locale || 'en';
  const locale = window.JH?.i18n?.locales?.[localeKey] || { lang: 'en', messages: {} };
  try {
    // One cacheable static file. Midnight and returning to the tab reuse it.
    const response = await fetch(board.dataset.dailySource);
    if (!response.ok) throw new Error('Daily selection unavailable');
    const projects = await response.json();
    if (!Array.isArray(projects)) throw new Error('Invalid selection pool');
    const render = () => {
      const day = utcDay();
      if (board.dataset.selectionDay === day) return;
      const picks = localizeStaticProjects(selectDailyProjects(projects, day), window.JH?.catalogSummaryOverlay, localeKey);
      if (!picks.length) return;
      board.innerHTML = dailyPicksHtml(picks, day, locale.messages, { basePath: localeKey === 'en' ? '' : '/' + localeKey, lang: locale.lang });
      board.dataset.selectionDay = day;
      document.getElementById('launchesTitle').textContent = locale.messages['daily.title'] || "Today's picks";
    };
    const schedule = () => {
      render();
      const now = new Date();
      setTimeout(schedule, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime() + 50);
    };
    schedule();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  } catch {
    // The dated snapshot and its real project links remain useful offline.
  }
}
