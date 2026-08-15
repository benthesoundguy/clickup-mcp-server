#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { setupTaskTools } from './tools/task-tools.js';
import { setupDocTools } from './tools/doc-tools.js';
import { setupSpaceTools } from './tools/space-tools.js';
import { setupChecklistTools } from './tools/checklist-tools.js';
import { setupCommentTools } from './tools/comment-tools.js';
import { setupCustomFieldTools } from './tools/custom-field-tools.js';
import { setupCustomFieldValueTools } from './tools/custom-field-value-tools.js';
import { setupDependencyTools } from './tools/dependency-tools.js';
import { setupTagTools } from './tools/tag-tools.js';
import { setupViewTools } from './tools/view-tools.js';
import { setupGoalTools } from './tools/goal-tools.js';
import { setupWebhookTools } from './tools/webhook-tools.js';
import { setupGuestTools } from './tools/guest-tools.js';
import { setupChatTools } from './tools/chat-tools.js';
import { setupTimeTrackingTools } from './tools/time-tracking-tools.js';
import { setupUserTools } from './tools/user-tools.js';
import { setupGroupTools } from './tools/group-tools.js';
import { setupTemplateTools } from './tools/template-tools.js';
import { setupAttachmentTools } from './tools/attachment-tools.js';
import { setupReminderTools } from './tools/reminder-tools.js';
import { setupStatusTools } from './tools/status-tools.js';
import { setupProjectIntelligenceTools } from './tools/project-intelligence-tools.js';

const SERVER_VERSION = '3.3.1';

// Transports:
//   default                        → stdio (Claude Desktop / Claude Code local)
//   MCP_TRANSPORT=http, or         → streamable HTTP (remote clients: claude.ai
//   MCP_HTTP_PORT set                custom connectors, mobile, reverse proxies).
//                                    Binds MCP_HTTP_HOST:MCP_HTTP_PORT,
//                                    default 127.0.0.1:8000. Requires
//                                    MCP_AUTH_TOKEN; requests must carry it as
//                                    `Authorization: Bearer <token>` or in the
//                                    path `/mcp/<token>` (claude.ai's connector
//                                    UI has no custom-header field, so the URL
//                                    form is the one you paste there).
//
// MCP_STRICT_ENV=1 is the posture for an unattended server deployment: secrets
// must come from the environment, the server never invents or persists one, and
// it refuses to start rather than run misconfigured. See resolveAuthToken().

const DEFAULT_HTTP_HOST = '127.0.0.1';
const DEFAULT_HTTP_PORT = 8000;

/** Strict mode: env-only secrets, no generated fallbacks, no local state. */
const STRICT_ENV = process.env.MCP_STRICT_ENV === '1';

/**
 * stdout is the JSON-RPC channel in stdio mode, so anything written there
 * corrupts the protocol — all stdio logging must go to stderr. HTTP mode has no
 * such constraint and systemd expects stdout, so route it there.
 */
const httpMode = Boolean(process.env.MCP_HTTP_PORT || process.env.MCP_TRANSPORT === 'http');
const log = (msg: string) => {
  if (httpMode) process.stdout.write(msg + '\n');
  else process.stderr.write(msg + '\n');
};

/**
 * Build stamp — lets a client tell whether the running process predates a
 * rebuild. Version skew (a host app holding an old server process after the
 * code was rebuilt) has repeatedly produced "the fix didn't work" reports;
 * this makes it visible instead of invisible.
 */
function buildStamp(): string {
  try {
    const self = fileURLToPath(import.meta.url);
    const mtime = fs.statSync(self).mtime.toISOString();
    const started = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();
    return `build ${mtime} · process started ${started}`;
  } catch {
    return 'build stamp unavailable';
  }
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: 'clickup-mcp-server',
    version: SERVER_VERSION,
  });
  setupTaskTools(server);
  setupDocTools(server);
  setupSpaceTools(server);
  setupChecklistTools(server);
  setupCommentTools(server);
  setupCustomFieldTools(server);
  setupCustomFieldValueTools(server);
  setupDependencyTools(server);
  setupTagTools(server);
  setupViewTools(server);
  setupGoalTools(server);
  setupWebhookTools(server);
  setupGuestTools(server);
  setupChatTools(server);
  setupTimeTrackingTools(server);
  setupUserTools(server);
  setupGroupTools(server);
  setupTemplateTools(server);
  setupAttachmentTools(server);
  setupReminderTools(server);
  setupStatusTools(server);
  setupProjectIntelligenceTools(server);

  // Diagnostic: which code is this process actually running?
  server.tool(
    'server_info',
    'Report this MCP server\'s version and build stamp. Call it first when a fix '
    + 'appears not to have taken effect: if the build timestamp predates the change '
    + 'you expect, the host app is holding an old process and needs restarting.',
    {},
    async () => ({
      content: [{ type: 'text', text: JSON.stringify({
        name: 'clickup-mcp-server',
        version: SERVER_VERSION,
        build: buildStamp(),
        transport: httpMode ? 'http' : 'stdio',
        node: process.version,
        arch: `${process.arch}/${process.platform}`,
      }) }],
    })
  );

  return server;
}

// Prevent process crashes from unhandled errors
process.on('unhandledRejection', (reason) => {
  console.error('[ClickUpServer] Unhandled rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[ClickUpServer] Uncaught exception:', error);
});

// ── stdio mode ─────────────────────────────────────────────────────────

async function runStdio() {
  const server = buildServer();
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ClickUp MCP server running on stdio');
}

// ── HTTP mode (stateless streamable HTTP) ──────────────────────────────

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * A token in the URL path is what claude.ai's connector UI needs (it has no
 * custom-header field), but URLs land in proxy and CDN access logs in a way
 * headers do not. Strict mode therefore accepts the header form only, unless
 * the path form is explicitly re-enabled.
 */
const allowTokenInPath = STRICT_ENV
  ? process.env.MCP_ALLOW_TOKEN_IN_PATH === '1'
  : true;

function extractToken(req: http.IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  if (!allowTokenInPath) return undefined;
  // Path form: /mcp/<token>
  const m = (req.url ?? '').split('?')[0].match(/^\/mcp\/([^/]+)\/?$/);
  return m?.[1];
}

async function runHttp(host: string, port: number, authToken: string) {
  const httpServer = http.createServer(async (req, res) => {
    // Health probe (no auth, no data). /health is the monitoring contract;
    // /healthz and / are kept so existing probes don't break.
    const probePath = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && (probePath === '/health' || probePath === '/healthz' || probePath === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: 'clickup-mcp-server', version: SERVER_VERSION, build: buildStamp() }));
      return;
    }

    const urlPath = (req.url ?? '').split('?')[0];
    if (!urlPath.startsWith('/mcp')) {
      res.writeHead(404).end();
      return;
    }

    const token = extractToken(req);
    if (!token || !timingSafeEq(token, authToken)) {
      console.error(`[HTTP] 401 ${req.method} from ${req.socket.remoteAddress} (${token ? 'bad token' : 'no token'})`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    try {
      // Stateless mode: fresh server+transport per request. No session state
      // is kept between calls, which is exactly what claude.ai's connector
      // expects and keeps the surface simple.
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error('[HTTP] request error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      }
    }
  });

  httpServer.listen(port, host, () => {
    log(`[ClickUp MCP] v${SERVER_VERSION} listening on http://${host}:${port} (streamable HTTP, stateless, bearer auth)`);
    log(`[ClickUp MCP] ${buildStamp()} · node ${process.version} · ${process.arch}/${process.platform}`);
    log(`[ClickUp MCP] strict env mode: ${STRICT_ENV ? 'ON (env-only secrets, no local state)' : 'off'}`);
    log('[ClickUp MCP] ready');
  });

  // systemd sends SIGTERM and waits. Stop accepting, drop idle keepalive
  // sockets, and hard-exit if a request hangs, so shutdown never stalls the
  // unit until TimeoutStopSec.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[ClickUp MCP] ${signal} received, shutting down`);
    const forced = setTimeout(() => {
      log('[ClickUp MCP] shutdown timeout, forcing exit');
      process.exit(0);
    }, 5000);
    forced.unref();
    httpServer.close(() => {
      log('[ClickUp MCP] closed cleanly');
      process.exit(0);
    });
    httpServer.closeAllConnections?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ── entry ──────────────────────────────────────────────────────────────

/**
 * Resolve the HTTP auth token:
 * 1. MCP_AUTH_TOKEN env var, if set (must be ≥16 chars);
 * 2. otherwise a previously generated token from .mcp-auth-token;
 * 3. otherwise generate one, persist it (0600) so restarts keep the same
 *    connector URL working, and print where to find it.
 *
 * Steps 2 and 3 are conveniences for a laptop install. Under MCP_STRICT_ENV=1
 * they are disabled: an unattended server must never invent a credential nobody
 * configured, nor depend on a file whose loss silently rotates the token.
 */
function resolveAuthToken(): string {
  const fromEnv = process.env.MCP_AUTH_TOKEN;
  if (fromEnv) {
    if (fromEnv.length < 16) {
      log('[FATAL] MCP_AUTH_TOKEN is too short (min 16 chars) — this server can modify your workspace. Generate a strong one:  openssl rand -hex 24');
      process.exit(1);
    }
    return fromEnv;
  }

  if (STRICT_ENV) {
    log('[FATAL] MCP_STRICT_ENV=1 requires MCP_AUTH_TOKEN to be set in the environment.');
    log('[FATAL] Refusing to generate a token: an unattended deployment must not create credentials nobody configured.');
    log('[FATAL] Generate one with:  openssl rand -hex 24');
    process.exit(1);
  }

  const tokenFile = path.join(process.cwd(), '.mcp-auth-token');
  try {
    const existing = fs.readFileSync(tokenFile, 'utf-8').trim();
    if (existing.length >= 16) {
      log(`[Auth] Using generated token from ${tokenFile}`);
      return existing;
    }
  } catch { /* no file yet */ }

  const generated = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(tokenFile, generated + '\n', { mode: 0o600 });
  log('─'.repeat(64));
  log('[Auth] No MCP_AUTH_TOKEN set — generated one for you:');
  log(`[Auth]   ${generated}`);
  log(`[Auth] Saved to ${tokenFile} (it will be reused on restart).`);
  log('[Auth] Connector URL:  https://<your-host>/mcp/' + generated);
  log('─'.repeat(64));
  return generated;
}

/**
 * Strict mode has to be applied before anything reads a credential. It disables
 * the ClickUp client's .env-file lookup — that lookup deliberately outranks
 * process.env so a desktop host can't clobber it, which is right on a laptop and
 * wrong on a server, where a stray .env would silently outrank the unit file.
 */
function applyStrictEnv() {
  process.env.MCP_NO_ENV_FILE = '1';
  if (!process.env.CLICKUP_API_TOKEN) {
    log('[FATAL] MCP_STRICT_ENV=1 requires CLICKUP_API_TOKEN to be set in the environment.');
    log('[FATAL] Refusing to start: .env-file lookup is disabled in strict mode, so there is no other source.');
    process.exit(1);
  }
}

if (httpMode) {
  if (STRICT_ENV) applyStrictEnv();
  const host = process.env.MCP_HTTP_HOST || DEFAULT_HTTP_HOST;
  const port = process.env.MCP_HTTP_PORT
    ? parseInt(process.env.MCP_HTTP_PORT, 10)
    : DEFAULT_HTTP_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    log(`[FATAL] MCP_HTTP_PORT is not a valid port: ${process.env.MCP_HTTP_PORT}`);
    process.exit(1);
  }
  runHttp(host, port, resolveAuthToken()).catch((err) => {
    log(`[FATAL] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
} else {
  runStdio().catch(console.error);
}
