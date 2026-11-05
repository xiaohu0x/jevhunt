import { projectShard } from '../shared/static-projects.js';
import { renderProject } from '../shared/catalog-view.js';
import { projectNameKey } from '../shared/project-seo.js';

const legacy = location.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?projects\/([a-z0-9-]+\/[a-z0-9._-]+)\/?$/i)?.[1];
const repo = (new URL(location.href).searchParams.get('repo') || legacy || '').toLowerCase();
const host = document.getElementById('projectSnapshot');
if (/^[a-z0-9-]+\/[a-z0-9_.-]+$/.test(repo)) {
  try {
    const version = document.querySelector('meta[name="catalog-version"]')?.content || '';
    const response = await fetch(`/assets/project-data/${projectShard(repo)}.json?v=${encodeURIComponent(version)}`);
    if (!response.ok) throw new Error('Could not load this project. Please try again.');
    const data = await response.json();
    const project = data.projects.find(p => p.repo.toLowerCase() === repo);
    if (!project) throw new Error('This project is not in the current catalog.');
    if (legacy || project.staticPage) {
      if (new URL(project.detailPath, location.origin).href !== location.href) location.replace(project.detailPath);
    } else {
      const navigation = await fetch('/assets/project-data/navigation.json?v=' + encodeURIComponent(version));
      if (!navigation.ok) throw new Error('Could not load project recommendations.');
      const { meta, categories, recentlyPushed, duplicateNames } = await navigation.json();
      const similar = (categories[project.cat] || []).filter(p => p.repo.toLowerCase() !== repo).slice(0, 6);
      const active = recentlyPushed.filter(p => p.repo.toLowerCase() !== repo).slice(0, 6);
      const html = renderProject(project, meta, similar, active, {}, { duplicateName: duplicateNames.includes(projectNameKey(project)), hasAlternativesPage: false });
      const documentView = new DOMParser().parseFromString(html, 'text/html');
      for (const script of documentView.querySelectorAll('script:not([type="application/ld+json"])')) script.remove();
      document.head.replaceChildren(...documentView.head.childNodes);
      document.body.replaceChildren(...documentView.body.childNodes);
      document.documentElement.lang = 'en';
      document.getElementById('pageTheme')?.addEventListener('click', () => {
        const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = theme;
        try { localStorage.setItem('jh-theme', theme); } catch {}
      });
    }
  } catch (error) { if (host) host.textContent = error.message; }
}

else if (host) host.textContent = 'Choose a project from the directory to view its details.';
