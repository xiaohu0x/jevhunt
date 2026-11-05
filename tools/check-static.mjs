import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function checkStatic(root = 'public') {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    assert.ok(!e.isSymbolicLink(), 'Static releases may not contain symlinks');
    return e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)];
  });
  const files = walk(root);
  assert.ok(files.length <= 5000, `JevHunt file budget exceeded: ${files.length}/5000 (one quarter of the free plan limit). Publishing stopped.`);
  for (const file of files) {
    assert.ok(statSync(file).size <= 12 * 1024 * 1024, `JevHunt 12 MiB asset budget exceeded: ${file}`);
    assert.ok(!/(?:^|\/)(?:_worker\.js|functions)(?:\/|$)/.test(file), 'Worker code is forbidden in a static release');
  }
  assert.ok(!existsSync(join(root, '_worker.js')), 'A Pages Worker must never be uploaded');
  const routes = JSON.parse(readFileSync(join(root, '_routes.json')));
  assert.deepEqual(routes.exclude, ['/*'], 'All requests must bypass Functions');
  const build = JSON.parse(readFileSync(join(root, 'build-info.json')));
  assert.equal(build.mode, 'static');
  assert.equal(build.runtimeDatabase, false);
  assert.equal(build.runtimeWorker, false);
  const redirects = readFileSync(join(root, '_redirects'), 'utf8').split('\n').filter(s => s.trim() && !s.startsWith('#'));
  for (const rule of redirects) {
    const [source, target, code] = rule.split(/\s+/);
    assert.ok(!(code === '200' && target === source + 'index.html'), 'Pages would ignore a self-rewrite: ' + source);
    assert.ok(!(code === '200' && target.endsWith('.html')), 'Rewrite targets must use clean URLs to avoid Pages canonical redirects: ' + source);
  }
  const dynamic = redirects.filter(s => /[:*]/.test(s.split(' ')[0])).length;
  assert.ok(dynamic <= 100 && redirects.length - dynamic <= 2000, 'Free Pages redirect limit exceeded; publishing stopped');
  const rewrites = new Map(redirects.map(line => line.trim().split(/\s+/)).filter(([, , code]) => code === '200').map(([source, target]) => [source, target]));
  const index = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(index, /data-catalog-mode="static"/);
  assert.ok(!/id="(?:submitForm|subSignin|auth)"/.test(index), 'Static pages may not offer server-backed sign-in or forms');
  // Every sitemap entry must resolve to a generated file, not a missing D1 route.
  const xml = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  for (const [, url] of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const path = new URL(url).pathname;
    const asset = rewrites.get(path) || path;
    const file = join(root, asset, asset.endsWith('/') ? 'index.html' : '');
    assert.ok(existsSync(file) || (!asset.endsWith('/') && existsSync(file + '.html')), `Missing static sitemap page: ${path}`);
  }
  return { files: files.length, redirects: redirects.length, mode: build.mode };
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) console.log(JSON.stringify(checkStatic(process.argv[2] || 'public')));
