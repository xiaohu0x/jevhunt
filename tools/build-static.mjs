import { buildSync } from 'esbuild';
import { projectShard, PROJECT_SHARDS } from '../shared/static-projects.js';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadData, page, projectPath } from './lib/site.mjs';
import { renderProject } from '../shared/catalog-view.js';
import { duplicateProjectNames, projectNameKey } from '../shared/project-seo.js';
import { localizedProjectPreview } from './lib/project-content.mjs';
import { launchBoardFromProjects, launchDayView, isLaunchDate, LAUNCH_PAGE_SIZE } from '../shared/catalog-launches.js';
import { rssFeed } from '../shared/rss.js';

const { apps, catalogMeta: meta, i18n, projectContents } = loadData();
const write = (path, html) => { const file = 'public' + path; mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, html); };
const issueUrl = 'https://github.com/xiaohu0x/jevhunt/issues/new?title=Submit%20a%20Jev%20project';
const redirects = readFileSync('public/_redirects', 'utf8').trim().split('\n').filter(line => line.startsWith('/projects/'));
const fallbackRedirects = [];
const duplicates = duplicateProjectNames(apps);
const launches = apps.filter(p => p.cat !== 'lists' && !p.fork && !p.archived && isLaunchDate(p.created) && String(p.desc || '').trim());
const launchDates = [...new Set(launches.map(p => p.created))].sort();
const board = launchBoardFromProjects(apps);
const pulseDates = board.pulse.map(p => p.date);
const dates = [...new Set([...launchDates, ...pulseDates])].sort();
const groups = new Map(dates.map(date => [date, launches.filter(p => p.created === date).sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name))]));

for (const [localeKey, locale] of Object.entries(i18n.locales)) {
  const prefix = localeKey === 'en' ? '' : '/' + localeKey;
  const indexPath = `public${prefix}/index.html`;
  let home = readFileSync(indexPath, 'utf8');
  home = home.replace(/<html\b([^>]*)>/, (_match, attrs) => '<html' + attrs.replace(/\sdata-catalog-mode="[^"]*"/g, '') + ' data-catalog-mode="static">');
  home = home.replace(/<div class="auth" id="auth">[\s\S]*?<\/div>/, '');
  home = home.replace(/<div class="sub__signin" id="subSignin"[^>]*>[\s\S]*?<\/div>/, '');
  home = home.replace(/<form\b[^>]*id="submitForm"[^>]*>[\s\S]*?<\/form>/, `<p class="static-submit"><a class="btn btn--primary" href="${issueUrl}" rel="noopener noreferrer">${locale.messages['nav.submit']} · GitHub ↗</a></p>`);
  home = home.replace(/<p class="static-submit">[\s\S]*?<\/p>/, `<p class="static-submit"><a class="btn btn--primary" href="${issueUrl}" rel="noopener noreferrer">${locale.messages['nav.submit']} · GitHub ↗</a></p>`);
  writeFileSync(indexPath, home.replace(/[ \t]+$/gm, ''));
  if (localeKey !== 'en') {
    rmSync(`public${prefix}/projects`, { recursive: true, force: true });
    for (const project of apps) {
      const content = projectContents.get(project.repo.toLowerCase());
      if (!content) continue;
      const path = projectPath(project.repo, prefix);
      const similar = apps.filter(p => p.cat === project.cat && p.repo !== project.repo).sort((a, b) => b.stars - a.stars).slice(0, 6).map(p => localizedProjectPreview(p, projectContents, localeKey));
      write(path + 'page.html', renderProject(project, meta, similar, [], locale.messages, { localeKey, localeInfo: locale, localePrefix: prefix, duplicateName: duplicates.has(projectNameKey(project)), content }));
      // Exact rewrites preserve translated pages before the broad English fallback.
      redirects.push(`${path} ${path}page 200`);
    }
    fallbackRedirects.push(`${prefix}/projects/:owner/:repo/ /projects/:owner/:repo/ 302`);
  }
  rmSync(`public${prefix}/launches`, { recursive: true, force: true });
  const localeDates = localeKey === 'en' ? dates : pulseDates;
  for (const date of localeDates) {
    const items = groups.get(date), pages = Math.max(1, Math.ceil(items.length / LAUNCH_PAGE_SIZE));
    for (let number = 1; number <= (localeKey === 'en' ? pages : 1); number++) {
      const view = launchDayView({ date, projects: items.slice((number - 1) * LAUNCH_PAGE_SIZE, number * LAUNCH_PAGE_SIZE).map(p => localizedProjectPreview(p, projectContents, localeKey)),
        number, pages, pulse: board.pulse, previous: launchDates.filter(d => d < date).at(-1), next: launchDates.find(d => d > date), messages: locale.messages, basePath: prefix, lang: locale.lang });
      if (localeKey !== 'en') redirects.push(`${view.path} ${view.path}page 200`);
      write(view.path + (localeKey === 'en' ? 'index.html' : 'page.html'), page({ ...view, messages: locale.messages, localeKey, localeInfo: locale, localePrefix: prefix }));
    }
  }
  if (localeKey !== 'en') fallbackRedirects.push(`${prefix}/launches/:date/ /launches/:date/ 302`, `${prefix}/launches/:date/:page/ /launches/:date/:page/ 302`, `${prefix}/tasks/:task/:page/ /tasks/:task/:page/ 302`);
  if (launchDates.length) redirects.push(`${prefix}/launches/ ${prefix}/launches/${launchDates.at(-1)}/ 302`);
}
write('/_redirects', [...new Set([...redirects, ...fallbackRedirects])].join('\n') + '\n');
write('/_routes.json', JSON.stringify({ version: 1, include: ['/*'], exclude: ['/*'] }) + '\n');
// One bounded shard per long-tail project request; no full-catalog download.
rmSync('public/assets/project-data', { recursive: true, force: true });
for (let shard = 0; shard < PROJECT_SHARDS; shard++) write(`/assets/project-data/${shard}.json`, JSON.stringify({ projects: apps.filter(p => projectShard(p.repo) === shard) }));
const categoryPools = Object.fromEntries([...new Set(apps.map(p => p.cat))].map(cat => [cat, apps.filter(p => p.cat === cat).sort((a, b) => b.stars - a.stars).slice(0, 7)]));
const recentPool = apps.filter(p => !p.archived && p.pushed).sort((a, b) => b.pushed.localeCompare(a.pushed)).slice(0, 13);
write('/assets/project-data/navigation.json', JSON.stringify({ meta: { projectCount: apps.length, syncedAt: meta.syncedAt }, categories: categoryPools, recentlyPushed: recentPool, duplicateNames: [...duplicates] }));
buildSync({ entryPoints: ['browser/project-static.js'], outfile: 'public/assets/js/project-static.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
const projectShell = page({ title: 'Jev project', description: 'Repository facts, source evidence and related projects.', path: '/project/', noindex: true,
  body: '<h1>Project details</h1><p id="projectSnapshot" role="status">Loading project…</p><noscript>Enable JavaScript to view this project, or <a href="/browse/">browse the directory</a>.</noscript>' });
const version = `<meta name="catalog-version" content="${meta.catalogHash}">`;
const script = '<script type="module" src="/assets/js/project-static.js"></script>';
write('/project/index.html', projectShell.replace('</head>', version + '</head>').replace('</body>', script + '</body>'));
let missing = readFileSync('public/404.html', 'utf8').replace(/<meta name="catalog-version"[^>]*>/g, '').replace(/<script[^>]*src="\/assets\/js\/project-static\.js[^"]*"[^>]*><\/script>/g, '');
write('/404.html', missing.replace('</head>', version + '</head>').replace('</body>', script + '</body>'));
write('/rss.xml', rssFeed([...apps].sort((a, b) => String(b.added || '').localeCompare(a.added || ''))));
write('/admin/index.html', page({ title: 'Project review', description: 'Project corrections and submissions.', path: '/admin/', noindex: true, body: `<h1>Project review</h1><p><a href="https://github.com/xiaohu0x/jevhunt/issues">Review project submissions on GitHub</a></p>` }));
let submit = readFileSync('public/submit/index.html', 'utf8');
submit = submit.replace('href="/#submit"', `href="${issueUrl}"`).replace(/Approved projects appear after the scheduled catalog check, usually within a few hours\./, 'Approved projects appear in a subsequent catalog update.');
write('/submit/index.html', submit);
let methodology = readFileSync('public/methodology/index.html', 'utf8');
methodology = methodology.replace(/<p>A Cloudflare scheduled worker[\s\S]*?<\/p>/, '<p>The catalog is updated in a bounded daily batch. Each run checks a small group of projects; other listings retain their last known information. Failed checks retain the previous data. Editors review corrections and submissions on GitHub.</p>');
write('/methodology/index.html', methodology);
write('/status/index.html', page({ title: 'Catalog update status', description: 'The last catalog update and daily batch results.', path: '/status/', body: `<h1>Catalog update status</h1><p>Catalog snapshot: <time>${meta.syncedAt}</time></p><p>${apps.length} listed projects. Updates run in daily batches, so individual projects may have older check dates.</p><p><a href="https://github.com/xiaohu0x/jevhunt/actions/workflows/catalog-daily.yml">Daily update history</a> · <a href="/catalog-audit.json">Catalog audit</a></p>` }));
const compare = readFileSync('public/compare/index.html', 'utf8').replace(/<div id="staticComparison"[^>]*><\/div>/g, '').replace(/<script[^>]*src="\/assets\/js\/compare-static\.js[^"]*"[^>]*><\/script>/g, '').replace('</main>', '<div id="staticComparison" aria-live="polite"></div></main>').replace('</body>', '<script type="module" src="/assets/js/compare-static.js"></script></body>');
write('/compare/index.html', compare);
const comparison = apps.map(({ repo, name, relationship, evidenceLevel, license, language, stars, pushed, archived, evidence, detailPath }) => ({ repo, name, relationship, evidenceLevel, license, language, stars, pushed, archived, evidence, detailPath }));
write('/assets/catalog-compare.json', JSON.stringify(comparison));
const build = JSON.parse(readFileSync('public/build-info.json', 'utf8'));
write('/build-info.json', JSON.stringify({ ...build, mode: 'static', syncSchedule: 'daily', runtimeDatabase: false, runtimeWorker: false }) + '\n');
console.log('Built static localized details, launch days, submissions, status and comparison.');
