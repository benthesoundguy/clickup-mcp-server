/**
 * OAuth 2.1 resource-server behaviour.
 *
 * The MCP spec makes an MCP server a *resource server*, not an authorization server, and gives
 * it two hard requirements: publish RFC 9728 Protected Resource Metadata naming the AS it
 * trusts, and reject tokens that were not issued for it. This file drives both against a real
 * signed-JWT flow — a local fake authorization server with a genuine RSA keypair — because the
 * interesting failures here are cryptographic and a mock would confirm whatever we assumed.
 *
 * The audience test is the one that matters most. Without it, a token minted for some other
 * service by the same issuer is accepted here, which is the exact replay the spec's audience
 * binding exists to prevent.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as http from 'node:http';
import { spawn } from 'node:child_process';

import {
  oauthEnv,
  resolveOAuthConfig,
  protectedResourceMetadata,
  metadataPaths,
  metadataUrl,
  looksLikeJwt,
  resetDiscoveryCache,
  OAuthConfigError,
} from '../build/v4/core/oauth.js';

const KID = 'test-key-1';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

const b64url = (b) => Buffer.from(b).toString('base64url');

/** Mint a token the way the fake authorization server would. */
function mint(payload, { key = privateKey, alg = 'RS256', kid = KID } = {}) {
  const header = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const input = `${header}.${body}`;
  if (alg === 'none') return `${input}.`;
  return `${input}.${b64url(crypto.createSign('RSA-SHA256').update(input).sign(key))}`;
}

let as, ISSUER, clickup, CLICKUP_BASE;

before(async () => {
  // A fake authorization server: discovery document + JWKS.
  as = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    const json = (b) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    if (p === '/.well-known/openid-configuration') {
      return json({ issuer: ISSUER, jwks_uri: `${ISSUER}/keys` });
    }
    if (p === '/keys') return json({ keys: [jwk] });
    res.writeHead(404).end();
  });
  await new Promise((r) => as.listen(0, '127.0.0.1', r));
  ISSUER = `http://127.0.0.1:${as.address().port}`;

  // A stub ClickUp, so the server under test can boot without touching the real API.
  clickup = http.createServer((req, res) => {
    const p = req.url.replace(/^\/api\/v[23]/, '').split('?')[0];
    const json = (b) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    if (p === '/team') {
      return json({ teams: [{ id: '9001', name: 'A', members: [{ user: { id: 1, username: 'B', email: 'b@e.com' } }] }] });
    }
    return json({});
  });
  await new Promise((r) => clickup.listen(0, '127.0.0.1', r));
  CLICKUP_BASE = `http://127.0.0.1:${clickup.address().port}/api/v2`;
});

after(() => {
  as?.close();
  clickup?.close();
});

describe('configuration', () => {
  test('absent unless an issuer is set', () => {
    assert.equal(oauthEnv({}), null);
  });

  test('an http issuer is refused', () => {
    assert.throws(() => oauthEnv({ MCP_OAUTH_ISSUER: 'http://insecure.example' }), OAuthConfigError);
  });

  test('SECURITY: OAuth without a canonical URI is refused, not guessed', async () => {
    // The audience a token must match cannot come from the request: the Host header is set by
    // the caller, so deriving it would let a caller choose what their own token has to match.
    await assert.rejects(
      () => resolveOAuthConfig({ issuer: 'https://as.example', scopes: [] }),
      (e) => e instanceof OAuthConfigError && /canonical URI/.test(e.message),
    );
  });

  test('discovers jwks_uri from the issuer', async () => {
    resetDiscoveryCache();
    const cfg = await resolveOAuthConfig({
      issuer: ISSUER,
      resource: 'https://mcp.example.com',
      scopes: [],
    });
    assert.equal(cfg.jwksUrl, `${ISSUER}/keys`);
  });

  test('a discovery document claiming a different issuer is rejected', async () => {
    resetDiscoveryCache();
    const liar = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ issuer: 'https://somewhere.else', jwks_uri: 'https://evil/keys' }));
    });
    await new Promise((r) => liar.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${liar.address().port}`;
    await assert.rejects(
      () => resolveOAuthConfig({ issuer: url, resource: 'https://mcp.example.com', scopes: [] }),
      (e) => /issuer mismatch/.test(e.message),
    );
    liar.close();
  });

  test('an explicit JWKS URL skips discovery entirely', async () => {
    const cfg = await resolveOAuthConfig({
      issuer: 'https://as.example',
      jwksUrl: 'https://as.example/custom-keys',
      resource: 'https://mcp.example.com',
      scopes: [],
    });
    assert.equal(cfg.jwksUrl, 'https://as.example/custom-keys');
  });
});

describe('RFC 9728 metadata', () => {
  const cfg = {
    issuer: 'https://as.example',
    jwksUrl: 'https://as.example/keys',
    resource: 'https://mcp.example.com/mcp',
    scopes: ['clickup.read'],
  };

  test('names the authorization server, which is the whole point', () => {
    const doc = protectedResourceMetadata(cfg);
    assert.deepEqual(doc.authorization_servers, ['https://as.example']);
    assert.equal(doc.resource, 'https://mcp.example.com/mcp');
    assert.deepEqual(doc.bearer_methods_supported, ['header']);
    assert.deepEqual(doc.scopes_supported, ['clickup.read']);
  });

  test('the well-known segment goes BEFORE the resource path', () => {
    // https://host/mcp is described at https://host/.well-known/oauth-protected-resource/mcp —
    // not at https://host/mcp/.well-known/... Getting it backwards 404s a correct client.
    assert.equal(
      metadataUrl('https://mcp.example.com/mcp'),
      'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
    );
    assert.equal(
      metadataUrl('https://mcp.example.com'),
      'https://mcp.example.com/.well-known/oauth-protected-resource',
    );
  });

  test('both path forms are served, most specific first', () => {
    assert.deepEqual(metadataPaths('https://h/mcp'), [
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-protected-resource',
    ]);
  });
});

describe('credential shape', () => {
  test('a JWT is distinguished from a static secret', () => {
    assert.equal(looksLikeJwt(mint({ sub: 'x' })), true);
    assert.equal(looksLikeJwt('a-long-static-shared-secret'), false);
    assert.equal(looksLikeJwt('a.b'), false);
    assert.equal(looksLikeJwt('a..c'), false);
  });
});

describe('end to end over HTTP', () => {
  let proc, PORT, RESOURCE;

  before(async () => {
    PORT = 21000 + Math.floor(Math.random() * 2000);
    RESOURCE = `http://127.0.0.1:${PORT}`;
    proc = spawn('node', ['build/v4/index.js'], {
      env: {
        ...process.env,
        CLICKUP_API_TOKEN: 'pk_stub',
        CLICKUP_API_BASE: CLICKUP_BASE,
        CLICKUP_WORKSPACE_ID: '9001',
        MCP_NO_ENV_FILE: '1',
        MCP_TRANSPORT: 'http',
        MCP_HTTP_PORT: String(PORT),
        MCP_OAUTH_ISSUER: ISSUER,
        MCP_PUBLIC_URL: RESOURCE,
        MCP_AUTH_TOKEN: '', // OAuth-only: no static secret at all
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Wait for readiness rather than sleeping a fixed amount.
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('server did not start')), 15000);
      proc.stdout.on('data', (d) => {
        if (String(d).includes('ready')) {
          clearTimeout(t);
          resolve();
        }
      });
      proc.on('exit', (c) => reject(new Error(`server exited ${c}`)));
    });
  });

  after(() => proc?.kill());

  const call = (headers = {}) =>
    fetch(`${RESOURCE}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });

  const validClaims = (over = {}) => ({
    iss: ISSUER,
    aud: RESOURCE,
    sub: 'user-42',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...over,
  });

  test('an OAuth-only server starts with no static secret', () => {
    assert.ok(proc.exitCode === null, 'server should still be running');
  });

  test('no credential → 401 pointing at the metadata document', async () => {
    const res = await call();
    assert.equal(res.status, 401);
    const wa = res.headers.get('www-authenticate');
    assert.match(wa, /resource_metadata="/);
    const url = /resource_metadata="([^"]+)"/.exec(wa)[1];
    assert.equal(url, `${RESOURCE}/.well-known/oauth-protected-resource`);
  });

  test('the advertised metadata URL actually serves the document, unauthenticated', async () => {
    const res = await fetch(`${RESOURCE}/.well-known/oauth-protected-resource`);
    assert.equal(res.status, 200);
    const doc = await res.json();
    assert.deepEqual(doc.authorization_servers, [ISSUER]);
    assert.equal(doc.resource, RESOURCE);
  });

  test('a valid token authenticates', async () => {
    const res = await call({ authorization: `Bearer ${mint(validClaims())}` });
    assert.equal(res.status, 200);
  });

  test('SECURITY: a token for a DIFFERENT audience is rejected', async () => {
    // Same issuer, same signature, correct in every way except who it was minted for. This is
    // the replay that audience binding exists to stop.
    const res = await call({
      authorization: `Bearer ${mint(validClaims({ aud: 'https://some-other-service.example' }))}`,
    });
    assert.equal(res.status, 401);
  });

  test('SECURITY: alg=none is rejected', async () => {
    const res = await call({
      authorization: `Bearer ${mint(validClaims(), { alg: 'none' })}`,
    });
    assert.equal(res.status, 401);
  });

  test('SECURITY: a token signed by the wrong key is rejected', async () => {
    const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const res = await call({
      authorization: `Bearer ${mint(validClaims(), { key: attacker.privateKey })}`,
    });
    assert.equal(res.status, 401);
  });

  test('an expired token is rejected', async () => {
    const res = await call({
      authorization: `Bearer ${mint(validClaims({ exp: Math.floor(Date.now() / 1000) - 3600 }))}`,
    });
    assert.equal(res.status, 401);
  });

  test('a token from another issuer is rejected', async () => {
    const res = await call({
      authorization: `Bearer ${mint(validClaims({ iss: 'https://evil.example' }))}`,
    });
    assert.equal(res.status, 401);
  });

  test('SECURITY: an empty credential does not match an unset static secret', async () => {
    // `timingSafeEq('', '')` is true, so an OAuth-only server must never fall through to a
    // static-secret comparison it has no secret for.
    const res = await call({ authorization: 'Bearer ' });
    assert.equal(res.status, 401);
  });

  test('/health stays unauthenticated', async () => {
    const res = await fetch(`${RESOURCE}/health`);
    assert.equal(res.status, 200);
  });
});
