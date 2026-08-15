#!/usr/bin/env node
/**
 * v4 entry point — stdio by default, streamable HTTP when configured.
 *
 * In stdio mode logs go to stderr, because stdout *is* the transport and anything written to
 * it that isn't a JSON-RPC frame corrupts the session. In HTTP mode stdout is free, and
 * journald wants it there.
 */

import * as http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {
  buildContext,
  buildServerWithContext,
  discoverWorkspaceId,
  SERVER_VERSION,
  allTools,
} from './server.js';
import { accessConfigFromEnv, authorize, publicOrigin } from './core/auth.js';

const DEFAULT_HTTP_HOST = '127.0.0.1';
const DEFAULT_HTTP_PORT = 8000;

const httpMode = Boolean(process.env.MCP_HTTP_PORT || process.env.MCP_TRANSPORT === 'http');

/**
 * Collapse control characters so an interpolated value can never forge a log line.
 *
 * Sanitised at the chokepoint rather than at each call site: every line this server emits is
 * one line by construction, so any control character present came from interpolated data.
 * Fixing it here covers the call sites nobody thought of.
 */
function oneLine(msg: string): string {
  return msg.replace(
    /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g,
    (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
}

const log = (msg: string) => {
  const line = `[clickup-v4] ${oneLine(msg)}\n`;
  if (httpMode) process.stdout.write(line);
  else process.stderr.write(line);
};

function buildStamp(): string {
  try {
    const self = fileURLToPath(import.meta.url);
    const mtime = fs.statSync(self).mtime.toISOString();
    const started = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();
    return `build ${mtime} · started ${started}`;
  } catch {
    return 'build stamp unavailable';
  }
}

async function main(): Promise<void> {
  const token = process.env.CLICKUP_API_TOKEN?.trim();
  if (!token) {
    log('FATAL: CLICKUP_API_TOKEN is not set. Get a personal token from ClickUp → Settings → Apps.');
    process.exit(1);
  }

  // One context for the whole process: the workspace index, status cache and rate governor
  // are all per-token state that must outlive any single request.
  const ctx = buildContext({
    token,
    workspaceId: process.env.CLICKUP_WORKSPACE_ID?.trim() || undefined,
    log,
  });

  try {
    const id = await discoverWorkspaceId(ctx);
    (ctx as { workspaceId: string }).workspaceId = id;
    log(`workspace ${id} · ${allTools.length} tools · v${SERVER_VERSION}`);
  } catch (err) {
    log(`FATAL: could not reach ClickUp: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (!httpMode) {
    const server = buildServerWithContext(ctx);
    await server.connect(new StdioServerTransport());
    log('ready (stdio)');
    return;
  }

  await runHttp(ctx);
}

async function runHttp(ctx: ReturnType<typeof buildContext>): Promise<void> {
  const host = process.env.MCP_HTTP_HOST?.trim() || DEFAULT_HTTP_HOST;
  const port = Number(process.env.MCP_HTTP_PORT) || DEFAULT_HTTP_PORT;

  const authToken = process.env.MCP_AUTH_TOKEN?.trim();
  if (!authToken || authToken.length < 16) {
    log('FATAL: MCP_AUTH_TOKEN must be set to at least 16 characters in HTTP mode.');
    log('FATAL: this server can modify your workspace. Generate one:  openssl rand -hex 24');
    process.exit(1);
  }
  const accessConfig = accessConfigFromEnv();
  const allowTokenInPath = process.env.MCP_ALLOW_TOKEN_IN_PATH === '1';

  const server = http.createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];

    // Unauthenticated health probe. No workspace data, no credential echo.
    if (req.method === 'GET' && (path === '/health' || path === '/healthz' || path === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          name: 'clickup-mcp-v4',
          version: SERVER_VERSION,
          tools: allTools.length,
          build: buildStamp(),
        }),
      );
      return;
    }

    if (!path.startsWith('/mcp')) {
      res.writeHead(404).end();
      return;
    }

    const auth = await authorize(req, { authToken, allowTokenInPath, accessConfig });
    if (!auth.ok) {
      log(`401 ${req.method} ${path} from ${req.socket.remoteAddress} — ${auth.reason}`);
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="clickup-mcp", resource_metadata="${publicOrigin(req)}/.well-known/oauth-protected-resource"`,
      });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    log(`${req.method} ${path} authorized via ${auth.via}${auth.subject ? ` (${auth.subject})` : ''}`);

    try {
      // Stateless: a fresh protocol object per request, but the *shared* context — so the
      // workspace index is built once for the process, not once per request.
      const mcp = buildServerWithContext(ctx);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close();
        mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      log(`request error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      }
    }
  });

  server.listen(port, host, () => {
    log(`v${SERVER_VERSION} listening on http://${host}:${port} (streamable HTTP, stateless)`);
    log(`${buildStamp()} · node ${process.version} · ${process.arch}/${process.platform}`);
    if (accessConfig) {
      log(`Cloudflare Access: ON · iss ${accessConfig.issuer} · aud ${accessConfig.aud.slice(0, 8)}…`);
      log('accepted credentials: Access JWT (user or service token) OR bearer token');
    } else {
      log('Cloudflare Access: off (set CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD) · bearer token only');
    }
    log('ready');
  });

  // systemd sends SIGTERM and waits. Stop accepting, drop idle keepalives, and hard-exit if a
  // request hangs, so shutdown never stalls the unit until TimeoutStopSec.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => {
      log('forced exit after 5s');
      process.exit(0);
    }, 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
