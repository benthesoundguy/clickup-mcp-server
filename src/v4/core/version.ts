/**
 * Version and build identity.
 *
 * Its own module so that `whoami` can report the running build without importing `server.ts`,
 * which imports the tools — a cycle. Small enough that the indirection costs nothing.
 *
 * The build stamp exists because of a real and repeated failure: MCP hosts spawn the server
 * process at session start and hold it, so a rebuild does not reach an already-running session.
 * Several "the fix didn't work" reports were an old process still running. Reporting the build
 * time turns that from a mystery into one glance.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SERVER_VERSION = '4.3.1';

/** mtime of this module's own file, plus when the process started. */
export function buildStamp(): string {
  try {
    const self = fileURLToPath(import.meta.url);
    const mtime = fs.statSync(self).mtime.toISOString();
    const started = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();
    return `build ${mtime} · started ${started}`;
  } catch {
    return 'build stamp unavailable';
  }
}
