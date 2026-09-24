import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeEvidence, evidenceIn, inspectRepository } from './catalog-policy.mjs';

test('negation, sponsor links and downstream users are not integration evidence', () => {
  for (const source of [
    'This project does not use TypeSafe Jev.',
    'Related tools: @typesafe-ai/sdk.',
    '# Users\n- [typesafe-ai/typesafe-sdk-python](https://github.com/typesafe-ai/typesafe-sdk-python) - generates Jev models',
    '<img src="typesafe.ai/jev-1.13.svg" alt="Jev"/>',
    '# Jev\nA calendar and decision helper with no model integration.',
  ]) assert.equal(evidenceIn(source), null, source);
});
test('real API configuration is preferred to a decorative Jev mention', () => {
  const result = analyzeEvidence('Jev is a TypeSafe model.\nSet TYPESAFE_API_KEY before starting.');
  assert.equal(result.line, 2);
  assert.equal(result.level, 'documented');
});
test('local replicas and opt-in integrations have distinct relationships', () => {
  assert.equal(analyzeEvidence('Small Jev-like decision models you can run yourself.\nfrom typesafe_sdk import TypeSafeClient', { category: 'research' }).relationship, 'local-alternative');
  assert.equal(analyzeEvidence('Set TYPESAFE_API_KEY to use the optional Jev reranker.', { category: 'apps' }).relationship, 'integration');
  assert.equal(analyzeEvidence('Set TYPESAFE_API_KEY to classify tickets.', { category: 'apps' }).relationship, 'jev-app');
});
test('source fallback pins evidence to the repository commit and ignores fixture files', async () => {
  const commit = 'a'.repeat(40), calls = [];
  const github = {
    async raw(repo, sha, path) {
      calls.push({ repo, sha, path });
      if (path === 'README.md') return 'An extensible application.';
      if (path === 'src/jev.ts') return 'const model = "jev-latest"; client.systemOne({ model });';
      return null;
    },
    async api() { return { tree: [{ type: 'blob', path: 'tests/fixtures/jev.ts', size: 200 }, { type: 'blob', path: 'src/jev.ts', size: 200 }] }; },
  };
  const result = await inspectRepository({ repo: 'sample/app', commit, cat: 'apps' }, github);
  assert.equal(result.level, 'code-reference');
  assert.equal(result.url, `https://github.com/sample/app/blob/${commit}/src/jev.ts#L1`);
  assert.ok(calls.every(call => call.sha === commit));
  assert.ok(!calls.some(call => call.path.includes('fixtures')));
});
test('temporary source errors are surfaced rather than treated as an unrelated repository', async () => {
  await assert.rejects(inspectRepository({ repo: 'sample/app', commit: 'a'.repeat(40) }, { async raw() { throw new Error('HTTP 503'); } }), /503/);
});
