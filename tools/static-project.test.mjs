import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadData } from './lib/site.mjs';
import { STATIC_PROJECT_LIMIT } from '../shared/static-projects.js';
import { checkStatic } from './check-static.mjs';
const data = loadData();

test('the static release stays below one quarter of the free file quota', () => {
  const report = checkStatic();
  assert.ok(report.files <= 5000);
  assert.equal(data.apps.filter(p => p.staticPage).length, STATIC_PROJECT_LIMIT);
  for (const repo of data.projectContents.keys()) assert.ok(data.apps.find(p => p.repo.toLowerCase() === repo)?.staticPage, repo);
});

test('a long-tail page renders complete facts and recommendations using only static JSON', async t => {
  const project = data.apps.find(p => !p.staticPage && p.desc);
  const dom = new JSDOM(readFileSync('public/project/index.html', 'utf8'), { url: 'https://jevhunt.com' + project.detailPath, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const requests = [];
  dom.window.fetch = async path => {
    requests.push(path);
    assert.match(path, /^\/assets\/project-data\//);
    return Response.json(JSON.parse(readFileSync('public' + new URL(path, 'https://jevhunt.com').pathname)));
  };
  await dom.window.eval('(async () => {' + readFileSync('public/assets/js/project-static.js', 'utf8') + '})()');
  const document = dom.window.document;
  assert.equal(requests.length, 2);
  assert.ok(document.querySelector('h1').textContent.toLowerCase().startsWith(project.name.toLowerCase()));
  assert.equal(document.querySelector('link[rel="canonical"]').href, 'https://jevhunt.com' + project.detailPath);
  assert.ok(document.querySelector('.facts').textContent.includes(project.language || 'Not reported'));
  assert.ok(document.querySelector('#similar-projects .card'));
  const graph = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
  assert.equal(graph[0].codeRepository.toLowerCase(), 'https://github.com/' + project.repo.toLowerCase());
});

test('an unknown shared project never displays somebody else’s record', async t => {
  const dom = new JSDOM(readFileSync('public/project/index.html', 'utf8'), { url: 'https://jevhunt.com/project/?repo=unknown/not-in-catalog', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.fetch = async () => Response.json({ projects: [] });
  await dom.window.eval('(async () => {' + readFileSync('public/assets/js/project-static.js', 'utf8') + '})()');
  assert.match(dom.window.document.getElementById('projectSnapshot').textContent, /not in the current catalog/);
});
