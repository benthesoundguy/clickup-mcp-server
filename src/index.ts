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

const SERVER_VERSION = '3.1.0';

// Transports:
//   default              → stdio (Claude Desktop / Claude Code local config)
//   MCP_HTTP_PORT set    → streamable HTTP on that port (remote clients:
//                          claude.ai custom connectors, mobile). Requires
//                          MCP_AUTH_TOKEN; requests must carry it either as
//                          `Authorization: Bearer <token>` or in the path
//                          `/mcp/<token>` (claude.ai's connector UI has no
//                          custom-header field, so the URL form is the one
//                          you paste there).

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
        transport: process.env.MCP_HTTP_PORT ? 'http' : 'stdio',
        node: process.version,
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

function extractToken(req: http.IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  // Path form: /mcp/<token>
  const m = (req.url ?? '').split('?')[0].match(/^\/mcp\/([^/]+)\/?$/);
  return m?.[1];
}

async function runHttp(port: number, authToken: string) {
  const httpServer = http.createServer(async (req, res) => {
    // Health probe (no auth, no data)
    if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
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

  httpServer.listen(port, () => {
    console.error(`ClickUp MCP server listening on HTTP :${port} (streamable, stateless, token auth)`);
  });

  process.on('SIGINT', () => {
    httpServer.close(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    httpServer.close(() => process.exit(0));
  });
}

// ── entry ──────────────────────────────────────────────────────────────

/**
 * Resolve the HTTP auth token:
 * 1. MCP_AUTH_TOKEN env var, if set (must be ≥16 chars);
 * 2. otherwise a previously generated token from .mcp-auth-token;
 * 3. otherwise generate one, persist it (0600) so restarts keep the same
 *    connector URL working, and print where to find it.
 */
function resolveAuthToken(): string {
  const fromEnv = process.env.MCP_AUTH_TOKEN;
  if (fromEnv) {
    if (fromEnv.length < 16) {
      console.error('MCP_AUTH_TOKEN is too short (min 16 chars) — this server can modify your workspace. Generate a strong one:  openssl rand -hex 24');
      process.exit(1);
    }
    return fromEnv;
  }

  const tokenFile = path.join(process.cwd(), '.mcp-auth-token');
  try {
    const existing = fs.readFileSync(tokenFile, 'utf-8').trim();
    if (existing.length >= 16) {
      console.error(`[Auth] Using generated token from ${tokenFile}`);
      return existing;
    }
  } catch { /* no file yet */ }

  const generated = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(tokenFile, generated + '\n', { mode: 0o600 });
  console.error('─'.repeat(64));
  console.error('[Auth] No MCP_AUTH_TOKEN set — generated one for you:');
  console.error(`[Auth]   ${generated}`);
  console.error(`[Auth] Saved to ${tokenFile} (it will be reused on restart).`);
  console.error('[Auth] Connector URL:  https://<your-host>/mcp/' + generated);
  console.error('─'.repeat(64));
  return generated;
}

const httpPort = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT, 10) : undefined;

if (httpPort) {
  runHttp(httpPort, resolveAuthToken()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  runStdio().catch(console.error);
}
