import { cpSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkStatic } from './check-static.mjs';

checkStatic();
const args = process.argv.slice(2);
if (args.some(arg => !['--dry-run'].includes(arg))) throw new Error('Only --dry-run is supported. Production always publishes the checked static directory.');
// Outside the repository: Wrangler cannot discover root Functions or legacy bindings.
const stage = mkdtempSync(join(tmpdir(), 'jevhunt-static-'));
try {
  cpSync('public', join(stage, 'public'), { recursive: true });
  const report = checkStatic(join(stage, 'public'));
  console.log('Static upload validated:', report);
  if (!args.includes('--dry-run')) {
    const build = JSON.parse(readFileSync('public/build-info.json'));
    execFileSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'pages', 'deploy', 'public', '--project-name', 'jevhunt', '--branch', 'main', '--commit-hash', build.commit, '--commit-message', 'Daily static catalog'], { cwd: stage, stdio: 'inherit' });
  }
} finally { rmSync(stage, { recursive: true, force: true }); }
