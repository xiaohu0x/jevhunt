import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkStatic } from './check-static.mjs';
checkStatic();
const stage = mkdtempSync(join(tmpdir(), 'jevhunt-preview-'));
try {
  cpSync('public', join(stage, 'public'), { recursive: true });
  const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'pages', 'dev', 'public', '--port', process.env.JEVHUNT_PREVIEW_PORT || '8788', '--compatibility-date', '2026-09-01'], { cwd: stage, stdio: 'inherit' });
  process.exitCode = result.status || 0;
} finally { rmSync(stage, { recursive: true, force: true }); }
