#!/usr/bin/env node
/**
 * v4 entry point (stdio).
 *
 * Logs go to stderr here: stdout is the MCP transport, and anything written to it that isn't
 * a JSON-RPC frame corrupts the session.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer, discoverWorkspaceId, SERVER_VERSION, allTools } from './server.js';

/** Collapse control characters so an interpolated value can never forge a log line. */
function oneLine(msg: string): string {
  return msg.replace(
    /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g,
    (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
}

const log = (msg: string) => process.stderr.write(`[clickup-v4] ${oneLine(msg)}\n`);

async function main(): Promise<void> {
  const token = process.env.CLICKUP_API_TOKEN?.trim();
  if (!token) {
    log('FATAL: CLICKUP_API_TOKEN is not set. Get a personal token from ClickUp → Settings → Apps.');
    process.exit(1);
  }

  const { server, ctx } = buildServer({
    token,
    workspaceId: process.env.CLICKUP_WORKSPACE_ID?.trim() || undefined,
    log,
  });

  // Resolve the workspace once at startup so no tool ever has to ask the agent for it.
  try {
    const id = await discoverWorkspaceId(ctx);
    (ctx as { workspaceId: string }).workspaceId = id;
    log(`workspace ${id} · ${allTools.length} tools · v${SERVER_VERSION}`);
  } catch (err) {
    log(`FATAL: could not reach ClickUp: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('ready');
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
