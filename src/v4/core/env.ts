/**
 * Configuration loading.
 *
 * v3 read the ClickUp token from a `.env` file next to the install; v4 initially read only
 * `process.env`, so upgrading silently lost the token and the server exited before it could say
 * so. In stdio mode that surfaces in the client as "server disconnected" with the real reason in
 * a log file nobody opens. This module restores the file lookup.
 *
 * Search order, first hit wins:
 *
 *   1. <cwd>/.env
 *   2. <install root>/.env          — two levels up from this compiled file
 *   3. <install root>/../.env       — the repo checked out inside a project folder
 *
 * Precedence is deliberately split:
 *
 * - **`CLICKUP_API_TOKEN` from the file wins over the environment.** A desktop MCP host rewrites
 *   its own config from memory when it quits, so a token pasted into the client config goes
 *   stale the moment it is rotated. The file is the one place a rotation actually takes.
 * - **Everything else only fills a gap.** `MCP_PROFILE` especially: if a stray `.env` outranked
 *   the client config, a file sitting in a working directory could widen a capability profile.
 *   Explicit configuration must always win for anything that grants permission.
 *
 * `MCP_STRICT_ENV=1` or `MCP_NO_ENV_FILE=1` disables the lookup entirely — the posture for an
 * unattended deployment, where secrets come from the unit file and a stray `.env` is an attack.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The one key whose file value outranks the environment. */
const FILE_WINS = 'CLICKUP_API_TOKEN';

export interface EnvFileResult {
  /** Which file was read, for the startup banner. Null when none was found or lookup is off. */
  source: string | null;
  /** Keys actually applied to `process.env`. */
  applied: string[];
}

/**
 * Parse a `.env` file. Deliberately minimal: `KEY=value`, `#` comments, optional `export`,
 * optional matching quotes. No interpolation, no multiline — anything fancier belongs in a real
 * config file, and silently mis-parsing a token is worse than not supporting a syntax.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0];
    if (quoted) value = value.slice(1, -1);
    else value = value.split(' #')[0].trim(); // trailing comment, unquoted values only
    out[m[1]] = value;
  }
  return out;
}

/** Candidate `.env` locations, in search order. */
export function envFileCandidates(moduleUrl: string, cwd: string = process.cwd()): string[] {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  // build/v4/core/env.js → install root
  const installRoot = path.resolve(moduleDir, '..', '..', '..');
  return [
    path.join(cwd, '.env'),
    path.join(installRoot, '.env'),
    path.resolve(installRoot, '..', '.env'),
  ];
}

/**
 * Load the first `.env` found and apply it to `process.env`.
 *
 * Returns which file was used so the caller can say so out loud — "where did my token come
 * from" is the question every credential bug starts with.
 */
export function loadEnvFile(
  opts: { moduleUrl?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): EnvFileResult {
  const env = opts.env ?? process.env;
  if (env.MCP_NO_ENV_FILE === '1' || env.MCP_STRICT_ENV === '1') {
    return { source: null, applied: [] };
  }

  const candidates = envFileCandidates(opts.moduleUrl ?? import.meta.url, opts.cwd);
  for (const file of candidates) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      continue; // no file here
    }

    const parsed = parseEnvFile(text);
    const applied: string[] = [];
    for (const [key, value] of Object.entries(parsed)) {
      if (!value) continue;
      const isSet = typeof env[key] === 'string' && env[key]!.trim() !== '';
      if (key === FILE_WINS || !isSet) {
        env[key] = value;
        applied.push(key);
      }
    }
    return { source: file, applied };
  }

  return { source: null, applied: [] };
}
