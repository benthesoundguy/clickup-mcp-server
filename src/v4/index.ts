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
import { toolsFor } from './tools/profiles.js';
import { accessConfigFromEnv, authorize, publicOrigin } from './core/auth.js';
import { parseProfile, describeProfile } from './core/policy.js';
import { resolveSandbox } from './core/localfile.js';
import { buildStamp } from './core/version.js';
import { loadEnvFile, envFileCandidates } from './core/env.js';
import {
  oauthEnv,
  resolveOAuthConfig,
  protectedResourceMetadata,
  metadataPaths,
  metadataUrl,
  type OAuthConfig,
} from './core/oauth.js';

const DEFAULT_HTTP_HOST = '127.0.0.1';
const DEFAULT_HTTP_PORT = 8000;

// Before anything reads process.env — including the transport decision on the next line.
const envFile = loadEnvFile({ moduleUrl: import.meta.url });

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

/**
 * What to tell someone whose server will not start.
 *
 * This is the single most-read string in the project: it is what a first-time install shows
 * when the token has not been found. It names every place the server looked, so "I put it in a
 * .env" and "the server did not see your .env" can be told apart without reading the source.
 */
function missingTokenMessage(): string {
  const looked = envFileCandidates(import.meta.url)
    .map((p) => `      ${p}`)
    .join('\n');
  const suppressed =
    process.env.MCP_NO_ENV_FILE === '1' || process.env.MCP_STRICT_ENV === '1'
      ? '\n  NOTE: .env lookup is DISABLED here by MCP_STRICT_ENV/MCP_NO_ENV_FILE, so the token ' +
        'must come from the environment.\n'
      : '';
  return (
    'ClickUp MCP is not configured: CLICKUP_API_TOKEN is not set.\n' +
    suppressed +
    '\nSet it in either place:\n' +
    '\n  1. Your MCP client config, which is usually easiest:\n' +
    '       "env": { "CLICKUP_API_TOKEN": "pk_..." }\n' +
    '\n  2. A .env file containing  CLICKUP_API_TOKEN=pk_...\n' +
    '     The server looked for one here, in order:\n' +
    looked +
    '\n\nGet a token from ClickUp → Settings → Apps → API Token. It starts with "pk_".\n' +
    'Then run the built server with --check to confirm it is picked up.'
  );
}

/**
 * `--check`: answer "why doesn't it work?" without needing the client, the logs, or this source.
 *
 * Prints every input the server resolved and then actually talks to ClickUp. Never prints the
 * token — a support transcript should be safe to paste into an issue.
 */
async function runCheck(): Promise<number> {
  const out = (line = '') => process.stdout.write(`${line}\n`);
  const token = process.env.CLICKUP_API_TOKEN?.trim();

  out(`ClickUp MCP v${SERVER_VERSION}`);
  out(`  ${buildStamp()}`);
  out(`  node ${process.version} · ${process.arch}/${process.platform}`);
  out();

  if (envFile.source) {
    out(`config file:  ${envFile.source}`);
    out(`              applied: ${envFile.applied.join(', ') || '(nothing usable)'}`);
  } else if (process.env.MCP_NO_ENV_FILE === '1' || process.env.MCP_STRICT_ENV === '1') {
    out('config file:  lookup disabled (MCP_STRICT_ENV / MCP_NO_ENV_FILE)');
  } else {
    out('config file:  none found. Looked in:');
    for (const c of envFileCandidates(import.meta.url)) out(`                ${c}`);
  }

  // Shape only, never the value: enough to spot "I pasted the wrong thing", nothing more.
  out(
    `token:        ${
      token ? `present (${token.slice(0, 3)}… ${token.length} chars)` : 'MISSING'
    }`,
  );
  if (token && !token.startsWith('pk_')) {
    out('              WARNING: personal ClickUp tokens start with "pk_".');
  }

  let profile;
  try {
    profile = parseProfile(process.env.MCP_PROFILE);
  } catch (err) {
    out(`profile:      INVALID — ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  out(`profile:      ${describeProfile(profile)}`);

  let attachRoot: string | null = null;
  try {
    attachRoot = await resolveSandbox(process.env.CLICKUP_ATTACH_ROOT);
    out(`attach root:  ${attachRoot ?? 'not set'}`);
  } catch (err) {
    out(`attach root:  INVALID — ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const toolCount = toolsFor(allTools, profile, (t) => t, {
    hasSandbox: attachRoot !== null,
  }).length;
  out(`transport:    ${httpMode ? 'http' : 'stdio'}`);
  out(`tools:        ${toolCount}`);

  // Remote auth is the hardest thing to debug from the client side, because a client that
  // cannot authenticate usually cannot tell you why. Resolve it here, including the network
  // round trip to the issuer, so a misconfiguration is visible before a client ever tries.
  try {
    const raw = oauthEnv();
    if (!raw) {
      out('oauth:        not configured (bearer token / Cloudflare Access only)');
    } else {
      const cfg = await resolveOAuthConfig(raw);
      out(`oauth:        resource server for ${cfg.resource}`);
      out(`              issuer   ${cfg.issuer}`);
      out(`              keys     ${cfg.jwksUrl}`);
      out(`              metadata ${metadataUrl(cfg.resource)}`);
      out('              tokens must name this server in their aud claim.');
    }
  } catch (err) {
    out(`oauth:        MISCONFIGURED — ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  out();

  if (!token) {
    out(missingTokenMessage());
    return 1;
  }

  out('contacting ClickUp…');
  const ctx = buildContext({ token, profile, attachRoot, log: () => {} });
  try {
    const id = await discoverWorkspaceId(ctx);
    (ctx as { workspaceId: string }).workspaceId = id;
    const me = await ctx.resolver.me();
    const idx = await ctx.resolver.index();
    const rate = ctx.http.stats().rate;
    out(`  user:       ${me.username} <${me.email}>`);
    out(`  workspace:  ${idx.workspaceName} (${idx.workspaceId})`);
    out(`  structure:  ${idx.spaces.length} spaces, ${idx.folders.length} folders, ${idx.lists.length} lists`);
    out(`  rate budget: ${rate.remaining ?? '?'}/${rate.limit ?? '?'}`);
    out();
    out('OK — the server is configured correctly.');
    return 0;
  } catch (err) {
    out(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    out();
    out('The token was found but ClickUp rejected it or could not be reached.');
    out('Check that the token is current (ClickUp → Settings → Apps) and that this machine');
    out('has network access to api.clickup.com.');
    return 1;
  }
}

async function main(): Promise<void> {
  if (process.argv.slice(2).some((a) => a === '--check' || a === '--doctor')) {
    process.exit(await runCheck());
  }

  let profile;
  try {
    profile = parseProfile(process.env.MCP_PROFILE);
  } catch (err) {
    log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // A misconfigured sandbox is fatal rather than ignored: silently falling back to "no
  // confinement" would leave the operator believing in a boundary that isn't there.
  let attachRoot: string | null = null;
  try {
    attachRoot = await resolveSandbox(process.env.CLICKUP_ATTACH_ROOT);
  } catch (err) {
    log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (envFile.source) {
    log(`config: ${envFile.applied.join(', ') || 'nothing'} from ${envFile.source}`);
  }

  const token = process.env.CLICKUP_API_TOKEN?.trim();

  // No token. In HTTP mode that is a deployment fault and dying loudly is right. In stdio mode
  // the process is being supervised by a desktop client that shows a crash as "server
  // disconnected" and buries the reason in a log file — so start, register the tools, and let
  // the first tool call deliver the explanation into the conversation where it will be read.
  if (!token) {
    const why = missingTokenMessage();
    if (httpMode) {
      for (const line of why.split('\n')) log(`FATAL: ${line}`);
      process.exit(1);
    }
    log('NOT CONFIGURED: CLICKUP_API_TOKEN is not set — tools will report how to fix it.');
    const ctx = buildContext({ token: '', profile, attachRoot, configError: why, log });
    await buildServerWithContext(ctx).connect(new StdioServerTransport());
    log('ready (stdio, unconfigured)');
    return;
  }

  // One context for the whole process: the workspace index, status cache and rate governor
  // are all per-token state that must outlive any single request.
  const ctx = buildContext({
    token,
    profile,
    attachRoot,
    workspaceId: process.env.CLICKUP_WORKSPACE_ID?.trim() || undefined,
    log,
  });

  try {
    const id = await discoverWorkspaceId(ctx);
    (ctx as { workspaceId: string }).workspaceId = id;
    log(`workspace ${id} · v${SERVER_VERSION}`);
    log(`profile: ${describeProfile(profile)}`);
    log(
      attachRoot
        ? `attachments: local reads confined to ${attachRoot}`
        : profile === 'agent'
          ? 'attachments: disabled (set CLICKUP_ATTACH_ROOT to enable `attach` under the agent profile)'
          : 'attachments: unconfined local reads (set CLICKUP_ATTACH_ROOT to restrict)',
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Same reasoning as the missing token: in stdio mode, dying here means a network blip at
    // launch looks identical to a broken install. Start, and say so on first use.
    if (httpMode) {
      log(`FATAL: could not reach ClickUp: ${detail}`);
      process.exit(1);
    }
    log(`NOT READY: could not reach ClickUp: ${detail}`);
    (ctx as { configError?: string }).configError =
      `Could not reach ClickUp when this server started: ${detail}\n` +
      'Fix: check that CLICKUP_API_TOKEN is current (ClickUp → Settings → Apps) and that this ' +
      'machine can reach api.clickup.com, then restart the MCP server. Run the server with ' +
      '--check to test the connection directly.';
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

  // Resolve OAuth first: whether a static secret is mandatory depends on whether there is
  // another way in. Discovery talks to the issuer, so a bad issuer fails here, at boot, rather
  // than on the first request from a real client.
  let oauth: OAuthConfig | null = null;
  try {
    const raw = oauthEnv();
    if (raw) {
      oauth = await resolveOAuthConfig(raw);
      log(`OAuth: resource server for ${oauth.resource}`);
      log(`OAuth: authorization server ${oauth.issuer} (keys: ${oauth.jwksUrl})`);
    }
  } catch (err) {
    for (const line of String(err instanceof Error ? err.message : err).split('\n')) {
      log(`FATAL: ${line}`);
    }
    process.exit(1);
  }

  const authToken = process.env.MCP_AUTH_TOKEN?.trim() ?? '';
  // A static secret is required only when it is the *only* way in. With an authorization
  // server configured, demanding one as well would force every deployment to keep a shared
  // password it does not use.
  if (!oauth && (!authToken || authToken.length < 16)) {
    log('FATAL: MCP_AUTH_TOKEN must be set to at least 16 characters in HTTP mode.');
    log('FATAL: this server can modify your workspace. Generate one:  openssl rand -hex 24');
    log('FATAL: or configure an authorization server with MCP_OAUTH_ISSUER + MCP_PUBLIC_URL.');
    process.exit(1);
  }
  if (authToken && authToken.length < 16) {
    log('FATAL: MCP_AUTH_TOKEN is set but shorter than 16 characters. Remove it or lengthen it.');
    process.exit(1);
  }
  const accessConfig = accessConfigFromEnv();
  const allowTokenInPath = process.env.MCP_ALLOW_TOKEN_IN_PATH === '1';
  const prmPaths = oauth ? new Set(metadataPaths(oauth.resource)) : new Set<string>();

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
          profile: ctx.profile,
          // Same inputs as the real registration, so /health can't disagree with what a
          // client is actually offered — the sandbox decides whether `attach` is among them.
          tools: toolsFor(allTools, ctx.profile, (t) => t, {
            hasSandbox: ctx.attachRoot !== null,
          }).length,
          attach_root: ctx.attachRoot,
          build: buildStamp(),
        }),
      );
      return;
    }

    // RFC 9728 Protected Resource Metadata. Unauthenticated by definition: a client fetches
    // this *because* it does not have a token yet and needs to be told where to get one.
    if (req.method === 'GET' && prmPaths.has(path) && oauth) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(JSON.stringify(protectedResourceMetadata(oauth)));
      return;
    }

    if (!path.startsWith('/mcp')) {
      res.writeHead(404).end();
      return;
    }

    const auth = await authorize(req, { authToken, allowTokenInPath, accessConfig, oauth });
    if (!auth.ok) {
      log(`401 ${req.method} ${path} from ${req.socket.remoteAddress} — ${auth.reason}`);
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="clickup-mcp", resource_metadata="${
          oauth ? metadataUrl(oauth.resource) : `${publicOrigin(req)}/.well-known/oauth-protected-resource`
        }"`,
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
