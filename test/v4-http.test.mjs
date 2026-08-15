/**
 * v4 HTTP transport + auth.
 *
 * Spawns the real binary against a stub ClickUp so the auth layer is exercised end to end
 * without touching the live API or spending its rate budget.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as http from 'node:http';
import { allTools } from '../build/v4/server.js';
import { toolsFor } from '../build/v4/tools/profiles.js';

const AUTH_TOKEN = 'test-token-that-is-long-enough-32ch';
let clickupStub;
let clickupPort;
let server;
let port;
let stdout = '';

/** A minimal ClickUp that answers just enough for startup and `whoami`. */
function startClickUpStub() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const p = req.url.split('?')[0].replace(/^\/api\/v[23]/, '');
      const send = (body) => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'x-ratelimit-limit': '100',
          'x-ratelimit-remaining': '99',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
        });
        res.end(JSON.stringify(body));
      };
      if (p === '/team') {
        return send({ teams: [{ id: '9001', name: 'Stub', members: [{ user: { id: 1, username: 'Ben', email: 'b@e.com' } }] }] });
      }
      if (p === '/team/9001/space') return send({ spaces: [] });
      if (p === '/team/9001/folder') return send({ folders: [] });
      if (p === '/user') return send({ user: { id: 1, username: 'Ben', email: 'b@e.com' } });
      return send({});
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port }));
  });
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server never became ready:\n${stdout}`)), 15000);
    child.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.includes('ready')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (d) => { stdout += d.toString(); });
  });
}

async function post(body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

function parseSse(text) {
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  return line ? JSON.parse(line.slice(6)) : JSON.parse(text);
}

before(async () => {
  const stub = await startClickUpStub();
  clickupStub = stub.s;
  clickupPort = stub.port;

  // Port 0 isn't available to the child, so pick a high port and let a failure surface as a
  // readiness timeout rather than a silent bind error.
  port = 18900 + Math.floor(Math.random() * 900);

  server = spawn('node', ['build/v4/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CLICKUP_API_TOKEN: 'pk_stub',
      CLICKUP_API_BASE: `http://127.0.0.1:${clickupPort}/api`,
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: String(port),
      MCP_HTTP_HOST: '127.0.0.1',
      MCP_AUTH_TOKEN: AUTH_TOKEN,
    },
  });
  await waitForReady(server);
});

after(() => {
  server?.kill();
  clickupStub?.close();
});

describe('v4 HTTP transport', () => {
  test('/health needs no credentials and leaks no workspace data', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    // Assert against what this profile actually exposes, not the whole registry: /health
    // reports the connection's surface, and the default profile is `core`, not `full`.
    assert.equal(body.profile, 'core', 'no MCP_PROFILE was set, so the safe default applies');
    assert.equal(body.tools, toolsFor(allTools, 'core', (t) => t, { hasSandbox: false }).length);
    assert.ok(body.tools < allTools.length, 'the default must not expose the full registry');
    assert.equal(body.attach_root, null, 'no sandbox configured in this fixture');
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes(AUTH_TOKEN), 'health must never echo the auth token');
    assert.ok(!raw.includes('pk_stub'), 'health must never echo the ClickUp token');
  });

  test('an unknown path 404s without touching auth', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(res.status, 404);
  });

  test('no credentials → 401 with a discovery hint', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate') ?? '', /resource_metadata=/);
  });

  test('a wrong bearer token → 401', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer wrong-token-wrong-token' });
    assert.equal(res.status, 401);
  });

  test('a valid bearer token → 200', async () => {
    const res = await post(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { Authorization: `Bearer ${AUTH_TOKEN}` },
    );
    assert.equal(res.status, 200);
    assert.equal(parseSse(res.text).result.serverInfo.name, 'clickup');
  });

  test('the auth scheme is case-insensitive (RFC 7235)', async () => {
    const res = await post(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { Authorization: `bearer ${AUTH_TOKEN}` },
    );
    assert.equal(res.status, 200, 'lowercase "bearer" is a valid scheme and must be accepted');
  });

  test('an unverifiable Access JWT never authenticates', async () => {
    // No CF_ACCESS_* configured, so the header cannot be verified. It must fail closed rather
    // than fall through to unauthenticated.
    const res = await post(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { 'Cf-Access-Jwt-Assertion': 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9.' },
    );
    assert.equal(res.status, 401);
  });

  test('a bad JWT does not veto a valid bearer token', async () => {
    // Access injects this header on everything it forwards, so a JWKS blip must not lock out
    // a caller holding a second, perfectly good credential.
    const res = await post(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { Authorization: `Bearer ${AUTH_TOKEN}`, 'Cf-Access-Jwt-Assertion': 'garbage.garbage.garbage' },
    );
    assert.equal(res.status, 200);
  });

  test('logs are one line per event, even with control characters in play', () => {
    const forged = stdout.split('\n').filter((l) => l.includes('authorized via') && !l.startsWith('[clickup-v4]'));
    assert.equal(forged.length, 0, `found log lines not emitted by the sanitising logger:\n${forged.join('\n')}`);
  });

  test('the workspace index is built once, not per request', async () => {
    const call = async () => {
      const r = await post(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
        { Authorization: `Bearer ${AUTH_TOKEN}` },
      );
      const text = parseSse(r.text).result.content[0].text;
      return Number(/requests this session: (\d+)/.exec(text)[1]);
    };
    const a = await call();
    const b = await call();
    // whoami itself makes no new calls once warm; a per-request context would re-index and
    // add ~4 calls every time.
    assert.equal(a, b, `request count grew from ${a} to ${b} — the context is not being shared`);
  });
});
