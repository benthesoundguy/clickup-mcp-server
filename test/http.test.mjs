// HTTP transport tests: auth gate + streamable-HTTP handshake.
// Spawns the built server in HTTP mode; no ClickUp token needed
// (initialize and tools/list never hit the ClickUp API).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 39555;
const AUTH = 'unit-test-secret-token-42';
let proc;

before(async () => {
  proc = spawn('node', [resolve(here, '../build/index.js')], {
    env: { ...process.env, MCP_HTTP_PORT: String(PORT), MCP_AUTH_TOKEN: AUTH, CLICKUP_API_TOKEN: 'pk_unit_fake' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  // Wait for the listen line (or up to 5s)
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not start')), 5000);
    proc.stderr.on('data', (d) => {
      if (String(d).includes('listening on HTTP')) { clearTimeout(t); res(); }
    });
    proc.on('exit', (code) => rej(new Error('server exited early: ' + code)));
  });
});

after(() => proc?.kill());

const post = (path, body, headers = {}) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } };

async function parseStreamable(res) {
  const text = await res.text();
  // Streamable HTTP may answer as SSE ("data: {...}") or plain JSON
  const dataLine = text.split('\n').find(l => l.startsWith('data: '));
  return JSON.parse(dataLine ? dataLine.slice(6) : text);
}

test('health endpoint responds without auth', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
});

test('missing token → 401', async () => {
  const res = await post('/mcp', INIT);
  assert.equal(res.status, 401);
});

test('wrong token (path) → 401', async () => {
  const res = await post('/mcp/definitely-not-the-token00', INIT);
  assert.equal(res.status, 401);
});

test('wrong token (bearer) → 401', async () => {
  const res = await post('/mcp', INIT, { Authorization: 'Bearer nope-nope-nope-nope' });
  assert.equal(res.status, 401);
});

test('unknown path → 404', async () => {
  const res = await post('/other', INIT);
  assert.equal(res.status, 404);
});

test('initialize succeeds with path token', async () => {
  const res = await post(`/mcp/${AUTH}`, INIT);
  assert.equal(res.status, 200);
  const j = await parseStreamable(res);
  assert.equal(j.result.serverInfo.name, 'clickup-mcp-server');
});

test('tools/list works with bearer token — 88 tools', async () => {
  const res = await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { Authorization: `Bearer ${AUTH}` });
  assert.equal(res.status, 200);
  const j = await parseStreamable(res);
  assert.equal(j.result.tools.length, 88);
});

test('with no MCP_AUTH_TOKEN, server generates + persists one and reuses it', async () => {
  const { mkdtempSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const cwd = mkdtempSync(resolve(tmpdir(), 'mcp-tokentest-'));
  const spawnOnce = () => new Promise((res, rej) => {
    const p2 = spawn('node', [resolve(here, '../build/index.js')], {
      cwd,
      env: { ...process.env, MCP_HTTP_PORT: String(PORT + 1), MCP_AUTH_TOKEN: '', CLICKUP_API_TOKEN: 'pk_unit_fake' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    const t = setTimeout(() => rej(new Error('no start: ' + err)), 5000);
    p2.stderr.on('data', (d) => {
      err += d;
      if (err.includes('listening on HTTP')) { clearTimeout(t); res({ proc: p2, log: err }); }
    });
    p2.on('exit', (code) => rej(new Error(`exited ${code}: ${err}`)));
  });

  const run1 = await spawnOnce();
  run1.proc.kill();
  const tokenFile = resolve(cwd, '.mcp-auth-token');
  assert.ok(existsSync(tokenFile), 'token file should be created');
  const token1 = readFileSync(tokenFile, 'utf-8').trim();
  assert.ok(token1.length >= 32, 'generated token should be long');
  assert.match(run1.log, /generated one for you/);

  const run2 = await spawnOnce();
  run2.proc.kill();
  const token2 = readFileSync(tokenFile, 'utf-8').trim();
  assert.equal(token2, token1, 'restart must reuse the same token');
  assert.match(run2.log, /Using generated token from/);
});
