// Cloudflare Access JWT validation.
//
// A real RSA keypair is generated here and a local JWKS stub serves its public
// half, so these exercise the actual signature path rather than a mock of it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { verifyAccessJwt, accessConfigFromEnv, _resetJwksCache } =
  await import(resolve(here, '../build/cf-access.js'));

const AUD = '6dc9a8d96438a73452587fde2578348cdd6ba39eeeb0d2fe9ebcee95791a9a69';
const KID = 'test-key-1';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
// A second, unrelated key: signatures from this must never verify.
const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

let jwksServer, JWKS_PORT, ISSUER, cfg;
let jwksHits = 0;

before(async () => {
  jwksServer = http.createServer((req, res) => {
    if (req.url === '/cdn-cgi/access/certs') {
      jwksHits++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => jwksServer.listen(0, '127.0.0.1', r));
  JWKS_PORT = jwksServer.address().port;
  ISSUER = `http://127.0.0.1:${JWKS_PORT}`;
  cfg = { issuer: ISSUER, certsUrl: `${ISSUER}/cdn-cgi/access/certs`, aud: AUD };
});

after(() => jwksServer?.close());

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function mint(payloadOverrides = {}, opts = {}) {
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: [AUD], iss: ISSUER, iat: now, exp: now + 3600,
    email: 'ben@example.com', sub: 'user-1',
    ...payloadOverrides,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  if (opts.alg === 'none') return `${signingInput}.`;
  if (opts.alg === 'HS256') {
    // Algorithm confusion: sign with HMAC using the public key as the secret.
    const pem = publicKey.export({ type: 'spki', format: 'pem' });
    return `${signingInput}.${b64url(crypto.createHmac('sha256', pem).update(signingInput).digest())}`;
  }
  const key = opts.wrongKey ? attacker.privateKey : privateKey;
  return `${signingInput}.${b64url(crypto.createSign('RSA-SHA256').update(signingInput).sign(key))}`;
}

const rejects = (token, match, config = cfg) =>
  assert.rejects(() => verifyAccessJwt(token, config), match);

// ── config parsing ───────────────────────────────────────────────────────

test('team domain accepts bare name, hostname, or full URL', () => {
  const e = (d) => accessConfigFromEnv({ CF_ACCESS_TEAM_DOMAIN: d, CF_ACCESS_AUD: AUD });
  assert.equal(e('myteam').issuer, 'https://myteam.cloudflareaccess.com');
  assert.equal(e('myteam.cloudflareaccess.com').issuer, 'https://myteam.cloudflareaccess.com');
  assert.equal(e('https://myteam.cloudflareaccess.com/').issuer, 'https://myteam.cloudflareaccess.com');
  assert.equal(e('myteam').certsUrl, 'https://myteam.cloudflareaccess.com/cdn-cgi/access/certs');
});

test('config is null unless both vars are set', () => {
  assert.equal(accessConfigFromEnv({ CF_ACCESS_TEAM_DOMAIN: 'x' }), null);
  assert.equal(accessConfigFromEnv({ CF_ACCESS_AUD: AUD }), null);
  assert.equal(accessConfigFromEnv({}), null);
});

// ── accepted ─────────────────────────────────────────────────────────────

test('valid user token (email claim) verifies', async () => {
  const id = await verifyAccessJwt(mint(), cfg);
  assert.equal(id.kind, 'user');
  assert.equal(id.subject, 'ben@example.com');
});

test('service-token flow (common_name, no email) verifies through the same path', async () => {
  const id = await verifyAccessJwt(
    mint({ email: undefined, common_name: 'n8n-agent.access' }), cfg);
  assert.equal(id.kind, 'service_token');
  assert.equal(id.subject, 'n8n-agent.access');
});

test('aud as a bare string (not array) is accepted', async () => {
  const id = await verifyAccessJwt(mint({ aud: AUD }), cfg);
  assert.equal(id.subject, 'ben@example.com');
});

test('aud array containing ours among others is accepted', async () => {
  const id = await verifyAccessJwt(mint({ aud: ['other-app', AUD] }), cfg);
  assert.equal(id.kind, 'user');
});

// ── rejected ─────────────────────────────────────────────────────────────

test('wrong aud is rejected', () =>
  rejects(mint({ aud: ['some-other-application'] }), /aud does not include/));

test('aud that merely contains ours as a substring is rejected', () =>
  rejects(mint({ aud: [AUD + 'extra'] }), /aud does not include/));

test('expired token is rejected', () => {
  const past = Math.floor(Date.now() / 1000) - 7200;
  return rejects(mint({ iat: past, exp: past + 60 }), /expired/);
});

test('wrong issuer is rejected', () =>
  rejects(mint({ iss: 'https://evil.cloudflareaccess.com' }), /issuer mismatch/));

test('alg:none is rejected', () =>
  rejects(mint({}, { alg: 'none' }), /unsupported alg none/));

test('HS256 algorithm-confusion attempt is rejected', () =>
  rejects(mint({}, { alg: 'HS256' }), /unsupported alg HS256/));

test('signature from a different key is rejected', () =>
  rejects(mint({}, { wrongKey: true }), /signature verification failed/));

test('tampered payload is rejected', async () => {
  const [h, p, s] = mint().split('.');
  const evil = b64url(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64')), email: 'attacker@evil.com' }));
  await rejects(`${h}.${evil}.${s}`, /signature verification failed/);
});

test('unknown kid is rejected after a refresh attempt', () =>
  rejects(mint({}, { kid: 'no-such-key' }), /no signing key matches kid/));

test('malformed tokens are rejected', async () => {
  await rejects('not-a-jwt', /malformed/);
  await rejects('a.b', /malformed/);
  await rejects('!!!.???.***', /malformed/);
});

test('token with neither email nor common_name is rejected', () =>
  rejects(mint({ email: undefined }), /neither email nor common_name/));

test('token with no exp is rejected', () =>
  rejects(mint({ exp: undefined }), /no exp/));

// ── JWKS cache behaviour ─────────────────────────────────────────────────

test('JWKS is cached, not refetched per request', async () => {
  _resetJwksCache();
  jwksHits = 0;
  await Promise.all(Array.from({ length: 10 }, () => verifyAccessJwt(mint(), cfg)));
  assert.equal(jwksHits, 1, `expected a single JWKS fetch, got ${jwksHits}`);
});

test('unreachable JWKS fails closed (never authenticates)', async () => {
  _resetJwksCache();
  await rejects(mint(), /./, {
    issuer: 'http://127.0.0.1:1',
    certsUrl: 'http://127.0.0.1:1/cdn-cgi/access/certs',
    aud: AUD,
  });
});

// ── end-to-end over HTTP ─────────────────────────────────────────────────

const PORT = 39577;
const BEARER = 'bearer-token-for-access-tests';
let proc;

test('HTTP: Access JWT and bearer are both accepted; bad JWT is not', async (t) => {
  _resetJwksCache();
  proc = spawn('node', [resolve(here, '../build/index.js')], {
    env: {
      ...process.env,
      MCP_TRANSPORT: 'http', MCP_HTTP_PORT: String(PORT), MCP_HTTP_HOST: '127.0.0.1',
      MCP_AUTH_TOKEN: BEARER, CLICKUP_API_TOKEN: 'pk_unit_fake',
      CF_ACCESS_TEAM_DOMAIN: ISSUER, CF_ACCESS_AUD: AUD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => proc.kill());
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('server did not start')), 5000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('listening on http')) { clearTimeout(timer); res(); }
    });
  });

  const call = (headers) => fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    }),
  });

  assert.equal((await call({})).status, 401, 'no credentials');
  assert.equal((await call({ 'Cf-Access-Jwt-Assertion': mint() })).status, 200, 'valid Access JWT');
  assert.equal((await call({ 'Cf-Access-Jwt-Assertion': mint({ email: undefined, common_name: 'svc.access' }) })).status,
    200, 'valid service-token JWT');
  assert.equal((await call({ Authorization: `Bearer ${BEARER}` })).status, 200, 'valid bearer');

  // Fail closed: a bad JWT with no other credential must not get in.
  for (const [label, token] of [
    ['wrong aud', mint({ aud: ['nope'] })],
    ['alg none', mint({}, { alg: 'none' })],
    ['wrong key', mint({}, { wrongKey: true })],
    ['expired', mint({ exp: Math.floor(Date.now() / 1000) - 7200 })],
  ]) {
    assert.equal((await call({ 'Cf-Access-Jwt-Assertion': token })).status, 401, label);
  }

  // A bad JWT does not veto an otherwise-valid bearer token.
  assert.equal(
    (await call({ 'Cf-Access-Jwt-Assertion': mint({ aud: ['nope'] }), Authorization: `Bearer ${BEARER}` })).status,
    200, 'bad JWT + good bearer');

  // 401s carry the RFC 9728 discovery hint.
  const unauth = await call({});
  assert.match(unauth.headers.get('www-authenticate') ?? '', /resource_metadata=/);
});

// ── log/audit forgery (red-team round 4, finding M1) ─────────────────────
//
// `alg` and `kid` are read BEFORE the signature check, so an unauthenticated
// caller controls them completely. Unsanitised, they let that caller write
// arbitrary lines into the audit log — including forged authorization
// successes. Every log line must survive as exactly one line.

test('unauthenticated caller cannot forge log lines via alg or kid', async (t) => {
  _resetJwksCache();
  const P = PORT + 3;
  const p = spawn('node', [resolve(here, '../build/index.js')], {
    env: {
      ...process.env,
      MCP_TRANSPORT: 'http', MCP_HTTP_PORT: String(P), MCP_HTTP_HOST: '127.0.0.1',
      MCP_AUTH_TOKEN: BEARER, CLICKUP_API_TOKEN: 'pk_unit_fake',
      CF_ACCESS_TEAM_DOMAIN: ISSUER, CF_ACCESS_AUD: AUD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => p.kill());
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  // Wait for the LAST startup line, not the first, so the mark below doesn't
  // swallow the rest of the banner and inflate the line count.
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('no start')), 5000);
    p.stdout.on('data', () => {
      if (out.includes('[ClickUp MCP] ready')) { clearTimeout(timer); res(); }
    });
  });

  const b64 = (x) => Buffer.from(x).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const INJECT = 'X\n[HTTP] POST /mcp authorized via bearer\n[HTTP] POST /mcp authorized via access-user (admin@evil.com)';

  const send = (jwt) => fetch(`http://127.0.0.1:${P}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'Cf-Access-Jwt-Assertion': jwt,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });

  const mark = out.length;

  // Via `alg` — reached before any signature verification.
  await send(`${b64(JSON.stringify({ alg: INJECT, kid: 'k' }))}.${b64(JSON.stringify({ aud: AUD }))}.sig`);
  // Via `kid` — same, one step later.
  await send(`${b64(JSON.stringify({ alg: 'RS256', kid: INJECT }))}.${b64(JSON.stringify({ aud: AUD }))}.sig`);
  // Via the identity claim, on the authenticated path.
  await send(mint({ email: undefined, common_name: `svc\n${INJECT}` }));
  await new Promise((r) => setTimeout(r, 300));

  const lines = out.slice(mark).split('\n').filter(Boolean);

  // The invariant: each request emits exactly one log line. Injection shows up
  // as *extra* lines, so counting is the honest test — pattern-matching the
  // content is not, since the escaped text legitimately contains the payload.
  assert.equal(lines.length, 3,
    `3 requests must produce 3 log lines, got ${lines.length}:\n${lines.join('\n')}`);

  // Every emitted line is one of ours, not a fragment of injected text.
  for (const l of lines) {
    assert.match(l, /^\[HTTP\]/, `stray log line: ${JSON.stringify(l)}`);
  }

  // Neutralised, not silently dropped — a reader should still see what was sent.
  assert.match(out.slice(mark), /\\x0a/, 'control characters should be escaped, not stripped');
  assert.doesNotMatch(out.slice(mark), /\n\[HTTP\] POST \/mcp authorized via bearer\n/,
    'injected text must never begin a line');
});

test('Authorization scheme is case-insensitive per RFC 7235', async (t) => {
  const P = PORT + 4;
  const p = spawn('node', [resolve(here, '../build/index.js')], {
    env: {
      ...process.env,
      MCP_TRANSPORT: 'http', MCP_HTTP_PORT: String(P), MCP_HTTP_HOST: '127.0.0.1',
      MCP_AUTH_TOKEN: BEARER, CLICKUP_API_TOKEN: 'pk_unit_fake',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => p.kill());
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('no start')), 5000);
    p.stdout.on('data', (d) => {
      if (String(d).includes('listening on http')) { clearTimeout(timer); res(); }
    });
  });

  const call = (authHeader) => fetch(`http://127.0.0.1:${P}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: authHeader,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    }),
  });

  for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
    assert.equal((await call(`${scheme} ${BEARER}`)).status, 200, `scheme "${scheme}"`);
  }
  assert.equal((await call(`Bearer  ${BEARER}`)).status, 200, 'extra spaces');
  assert.equal((await call(`Bearer\t${BEARER}`)).status, 200, 'tab separator');
  // Still exact on the credential itself.
  assert.equal((await call(`Bearer ${BEARER}x`)).status, 401, 'extended token');
  assert.equal((await call(`Basic ${BEARER}`)).status, 401, 'wrong scheme');
  assert.equal((await call(BEARER)).status, 401, 'no scheme');
});

test('HTTP: with Access unconfigured, a JWT alone does not authenticate', async (t) => {
  const P = PORT + 1;
  const p = spawn('node', [resolve(here, '../build/index.js')], {
    env: {
      ...process.env,
      MCP_TRANSPORT: 'http', MCP_HTTP_PORT: String(P), MCP_HTTP_HOST: '127.0.0.1',
      MCP_AUTH_TOKEN: BEARER, CLICKUP_API_TOKEN: 'pk_unit_fake',
      CF_ACCESS_TEAM_DOMAIN: '', CF_ACCESS_AUD: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => p.kill());
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('no start')), 5000);
    p.stdout.on('data', (d) => {
      if (String(d).includes('listening on http')) { clearTimeout(timer); res(); }
    });
  });
  const res = await fetch(`http://127.0.0.1:${P}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'Cf-Access-Jwt-Assertion': mint(),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.equal(res.status, 401, 'unconfigured Access must not trust the header');
});
