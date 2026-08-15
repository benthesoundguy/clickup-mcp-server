#!/usr/bin/env node
/**
 * npm runs `prepare` on `npm install` and `npm ci` — including production-only
 * installs, where devDependencies (and therefore `tsc`) are absent. Calling
 * `npm run build` unconditionally there fails the whole install with
 * `sh: tsc: command not found` / npm code 127, which is a surprising way for
 * `npm ci --omit=dev` to break.
 *
 * So: build when the toolchain is present (the `npm install <git-url>` case,
 * where npm does install devDependencies to run this), and skip loudly but
 * successfully when it isn't.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

try {
  require.resolve('typescript');
} catch {
  console.log('[prepare] typescript not installed (production-only install) — skipping build.');
  console.log('[prepare] Run `npm ci && npm run build` if you need build/ populated.');
  process.exit(0);
}

const result = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
