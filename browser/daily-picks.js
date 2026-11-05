import { dailyBoardHtml, dailyHistory, shiftPickDate, utcDay } from '../shared/daily-picks.js';
import { localizeStaticProjects } from '../public/assets/js/catalog-locales.js';

const board = document.querySelector('#launchBoard[data-daily-source]');
if (board && document.documentElement.dataset.catalogMode === 'static') {
  const localeKey = document.documentElement.dataset.locale || 'en';
  const locale = window.JH?.i18n?.locales?.[localeKey] || { lang: 'en', messages: {} };
  let historyDays = [], pool, pendingPool, signature = '';
  try {
    const seed = JSON.parse(document.getElementById('dailySelectionSeed')?.textContent || 'null');
    if (Array.isArray(seed?.days)) historyDays = seed.days;
  } catch { /* Keep the prerendered dated groups. */ }

  const localize = history => history.map(day => ({ ...day, projects: localizeStaticProjects(day.projects, window.JH?.catalogSummaryOverlay, localeKey) }));
  function render() {
    const today = utcDay();
    if (!historyDays.some(day => day.date === today) || !historyDays.some(day => day.date === shiftPickDate(today, -29))) return false;
    const requested = new URL(location.href).searchParams.get('pick-day');
    const selected = historyDays.some(day => day.date === requested && day.date <= today && day.date >= shiftPickDate(today, -29)) ? requested : null;
    const nextSignature = today + '|' + selected;
    if (signature === nextSignature) return true;
    board.innerHTML = dailyBoardHtml(historyDays, locale.messages, { today, selected, basePath: localeKey === 'en' ? '' : '/' + localeKey, lang: locale.lang });
    board.dataset.selectionDay = today;
    document.getElementById('launchesTitle').textContent = locale.messages['daily.title'] || 'Daily picks';
    signature = nextSignature;
    return true;
  }
  async function refresh() {
    if (render()) return;
    try {
      // The embedded date groups work immediately. After that window expires,
      // download one static pool and reuse it for every date and midnight change.
      if (!pool) {
        pendingPool ||= fetch(board.dataset.dailySource).then(async response => {
          if (!response.ok) throw new Error('Daily selection unavailable');
          const data = await response.json();
          if (!Array.isArray(data)) throw new Error('Invalid selection pool');
          return data;
        }).catch(error => { pendingPool = null; throw error; });
        pool = await pendingPool;
      }
      historyDays = localize(dailyHistory(pool, utcDay()));
      render();
    } catch { /* The chart and dated groups remain available offline. */ }
  }
  board.addEventListener('click', event => {
    const link = event.target.closest('a[data-pick-day]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const url = new URL(location.href);
    if (link.dataset.pickDay) url.searchParams.set('pick-day', link.dataset.pickDay);
    else url.searchParams.delete('pick-day');
    url.hash = 'launches';
    window.history.pushState({}, '', url);
    render();
  });
  window.addEventListener('popstate', () => { void refresh(); });
  const schedule = () => {
    const now = new Date();
    setTimeout(() => { void refresh(); schedule(); }, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime() + 50);
  };
  await refresh();
  schedule();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
}
