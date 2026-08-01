// Phase 1 tests: shared HTTP core (ClickUpClient, getAllPages).
// Runs against build/ output; uses a local mock HTTP server — no real API calls.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { ClickUpClient, ClickUpApiError, getAllPages, createClickUpClient } from '../build/clickup-client/index.js';

// ── Mock ClickUp server ────────────────────────────────────────────────
let server;
let baseUrl;
let hits = {};          // path → count
let lastRequest = {};   // captured details of most recent request

before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rawPath = url.pathname;
    const path = rawPath.replace(/^\/v3/, ''); // route v3-prefixed paths to same handlers
    hits[path] = (hits[path] || 0) + 1;

    let body = '';
    for await (const chunk of req) body += chunk;
    lastRequest = {
      method: req.method,
      path: rawPath,
      query: url.search,
      auth: req.headers['authorization'],
      contentType: req.headers['content-type'],
      body,
    };

    if (path === '/ok') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hello: 'world' }));
    } else if (path === '/empty') {
      res.writeHead(200);
      res.end('');
    } else if (path === '/error400') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ err: 'Bad input', ECODE: 'INPUT_005' }));
    } else if (path === '/flaky429') {
      // First two hits: 429. Third: success.
      if (hits[path] <= 2) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
        res.end(JSON.stringify({ err: 'Rate limit' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ recovered: true }));
      }
    } else if (path === '/flaky500') {
      // Odd hits: 500. Even: success. (Per-method counters via query key.)
      const key = '/flaky500:' + req.method;
      hits[key] = (hits[key] || 0) + 1;
      if (hits[key] % 2 === 1) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ err: 'transient' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ recovered: true }));
      }
    } else if (path === '/always429') {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
      res.end(JSON.stringify({ err: 'Rate limit forever', ECODE: 'RATE_001' }));
    } else if (path === '/lockout429') {
      // Simulates a rate-limit lockout demanding a long wait
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '3600' });
      res.end(JSON.stringify({ err: 'Locked out', ECODE: 'RATE_002' }));
    } else if (path === '/slow') {
      // Never responds within the test's timeout budget
      setTimeout(() => { res.writeHead(200); res.end('{}'); }, 5000);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ err: 'Route not found' }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const makeClient = (extra = {}) =>
  new ClickUpClient({ apiToken: 'pk_test_token', baseUrlV2: baseUrl, baseUrlV3: baseUrl + '/v3', maxRetries: 3, ...extra });

// ── Tests ──────────────────────────────────────────────────────────────

test('GET returns parsed JSON and sends Authorization header', async () => {
  const client = makeClient();
  const result = await client.get('/ok');
  assert.deepEqual(result, { hello: 'world' });
  assert.equal(lastRequest.auth, 'pk_test_token');
});

test('empty response body returns {}', async () => {
  const client = makeClient();
  const result = await client.get('/empty');
  assert.deepEqual(result, {});
});

test('query params are serialized; arrays use bracket syntax; null/undefined skipped', async () => {
  const client = makeClient();
  await client.get('/ok', { page: 2, flag: true, ids: [1, 2], skipme: undefined, alsoskip: null });
  assert.match(lastRequest.query, /page=2/);
  assert.match(lastRequest.query, /flag=true/);
  assert.match(lastRequest.query, /ids%5B%5D=1/);
  assert.match(lastRequest.query, /ids%5B%5D=2/);
  assert.doesNotMatch(lastRequest.query, /skipme|alsoskip/);
});

test('POST serializes JSON body with content-type', async () => {
  const client = makeClient();
  await client.post('/ok', { name: 'x' });
  assert.equal(lastRequest.method, 'POST');
  assert.equal(lastRequest.contentType, 'application/json');
  assert.deepEqual(JSON.parse(lastRequest.body), { name: 'x' });
});

test('v3 option routes to v3 base URL', async () => {
  const client = makeClient();
  await client.get('/ok', undefined, { api: 'v3' });
  assert.equal(lastRequest.path, '/v3/ok');
});

test('4xx throws ClickUpApiError with status, ECODE, and endpoint', async () => {
  const client = makeClient();
  await assert.rejects(
    () => client.get('/error400'),
    (err) => {
      assert.ok(err instanceof ClickUpApiError);
      assert.equal(err.status, 400);
      assert.equal(err.ecode, 'INPUT_005');
      assert.match(err.message, /Bad input/);
      assert.match(err.message, /error400/);
      return true;
    }
  );
});

test('4xx does NOT retry', async () => {
  const client = makeClient();
  const before = hits['/error400'] ?? 0;
  await assert.rejects(() => client.get('/error400'));
  assert.equal(hits['/error400'], before + 1);
});

test('429 retries with Retry-After and succeeds', async () => {
  hits['/flaky429'] = 0;
  const client = makeClient();
  const result = await client.get('/flaky429');
  assert.deepEqual(result, { recovered: true });
  assert.equal(hits['/flaky429'], 3);
});

test('persistent 429 exhausts retries then throws', async () => {
  hits['/always429'] = 0;
  const client = makeClient({ maxRetries: 2 });
  await assert.rejects(
    () => client.get('/always429'),
    (err) => err instanceof ClickUpApiError && err.status === 429
  );
  assert.equal(hits['/always429'], 3); // initial + 2 retries
});

test('LOCKOUT: huge Retry-After fails fast with the wait in the message, no hang', async () => {
  hits['/lockout429'] = 0;
  const client = makeClient();
  const started = Date.now();
  await assert.rejects(
    () => client.get('/lockout429'),
    (err) => {
      assert.equal(err.status, 429);
      assert.match(err.message, /retry after 3600s/);
      assert.match(err.message, /Do not retry immediately/);
      return true;
    }
  );
  assert.ok(Date.now() - started < 2000, 'must fail fast, not sleep out the Retry-After');
  assert.equal(hits['/lockout429'], 1, 'must not burn extra attempts during a lockout');
});

test('transient 500 retries for GET (idempotent) but NOT for POST', async () => {
  const client = makeClient();
  // GET: first hit 500, retry succeeds
  const got = await client.get('/flaky500');
  assert.deepEqual(got, { recovered: true });
  // POST: first hit 500 → throws immediately, no double-send
  hits['/flaky500:POST'] = 0;
  await assert.rejects(
    () => client.post('/flaky500', { x: 1 }),
    (err) => err instanceof ClickUpApiError && err.status === 500
  );
  assert.equal(hits['/flaky500:POST'], 1);
});

test('timeout aborts and reports a timeout error', async () => {
  const client = makeClient({ timeoutMs: 200, maxRetries: 0 });
  await assert.rejects(
    () => client.get('/slow'),
    (err) => err instanceof ClickUpApiError && /timed out/.test(err.message)
  );
});

test('missing token throws actionable config error at request time, not construction', async () => {
  const saved = process.env.CLICKUP_API_TOKEN;
  delete process.env.CLICKUP_API_TOKEN;
  try {
    const client = new ClickUpClient({ baseUrlV2: baseUrl }); // must not throw here
    await assert.rejects(
      () => client.get('/ok'),
      (err) => err instanceof ClickUpApiError && /CLICKUP_API_TOKEN/.test(err.message)
    );
  } finally {
    if (saved !== undefined) process.env.CLICKUP_API_TOKEN = saved;
  }
});

test('createClickUpClient returns a shared singleton and never throws at import time', () => {
  const a = createClickUpClient();
  const b = createClickUpClient();
  assert.equal(a, b);
});

// ── getAllPages ────────────────────────────────────────────────────────

test('getAllPages: single short page is complete', async () => {
  const result = await getAllPages(async () => ({ items: [1, 2, 3] }), { pageSize: 100 });
  assert.deepEqual(result.items, [1, 2, 3]);
  assert.equal(result.complete, true);
  assert.equal(result.pagesFetched, 1);
});

test('getAllPages: multiple full pages are concatenated in order', async () => {
  const pages = [
    Array.from({ length: 100 }, (_, i) => i),
    Array.from({ length: 100 }, (_, i) => 100 + i),
    [200, 201],
  ];
  const result = await getAllPages(async (p) => ({ items: pages[p] }), { pageSize: 100 });
  assert.equal(result.items.length, 202);
  assert.equal(result.items[0], 0);
  assert.equal(result.items[201], 201);
  assert.equal(result.complete, true);
  assert.equal(result.pagesFetched, 3);
});

test('getAllPages: respects explicit lastPage flag', async () => {
  const result = await getAllPages(
    async (p) => ({ items: Array.from({ length: 100 }, (_, i) => i), lastPage: p === 1 }),
    { pageSize: 100 }
  );
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.complete, true);
});

test('getAllPages: page cap marks result incomplete', async () => {
  const result = await getAllPages(
    async () => ({ items: Array.from({ length: 100 }, (_, i) => i) }),
    { pageSize: 100, maxPages: 3 }
  );
  assert.equal(result.items.length, 300);
  assert.equal(result.complete, false);
  assert.equal(result.pagesFetched, 3);
});
