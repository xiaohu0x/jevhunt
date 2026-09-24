import assert from 'node:assert/strict';
import test from 'node:test';
import { readCatalogState, catalogUrl, matchesProject } from '../public/assets/js/catalog-state.js';

test('shared filters round trip without losing the locale or authentication error parameters', () => {
  const original = 'https://jevhunt.com/zh-cn/?q=Jev%20router&kind=integration&language=Python&activity=archived&category=agents&sort=updated-desc&page=3&auth_error=cancelled#apps';
  const state = readCatalogState(original, ['agents']);
  const output = new URL(catalogUrl(original, state), 'https://jevhunt.com');
  assert.equal(output.pathname, '/zh-cn/');
  assert.equal(output.searchParams.get('auth_error'), 'cancelled');
  assert.deepEqual(readCatalogState(output, ['agents']), state);
  assert.equal(state.visible, 60);
});
test('unknown filters and unbounded pagination cannot alter the catalog model', () => {
  const state = readCatalogState('https://jevhunt.com/?category=bad&kind=bad&sort=bad&page=-2');
  assert.equal(state.filter, 'all'); assert.equal(state.kind, 'all'); assert.equal(state.sort, 'stars-desc'); assert.equal(state.visible, 20);
});
test('language, relationship, archival state and text filters compose', () => {
  const state = readCatalogState('https://jevhunt.com/?kind=integration&language=Python&activity=active&q=router', ['agents']);
  const project = { name: 'Router', repo: 'owner/router', cat: 'agents', relationship: 'integration', language: 'Python', archived: false };
  assert.ok(matchesProject(project, state));
  assert.ok(!matchesProject({ ...project, archived: true }, state));
  assert.ok(!matchesProject({ ...project, relationship: 'local-alternative' }, state));
  assert.ok(!matchesProject({ ...project, language: 'Go' }, state));
});
