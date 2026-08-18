/**
 * v4 core tests — resolver, errors, dates, text, formatting, rate governor.
 *
 * Everything runs against a stubbed fetch and a stubbed clock, so the suite is offline,
 * deterministic, and never spends the real ClickUp rate budget.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ClickUpHttp, qs } from '../build/v4/core/http.js';
import { TtlCache } from '../build/v4/core/cache.js';
import { Resolver, matchByPath, looksLikeTaskId, looksLikeContainerId } from '../build/v4/core/resolve.js';
import { ClickUpToolError, fromApiError, unresolved, ambiguous, badValue } from '../build/v4/core/errors.js';
import { parseDate, parseDueWindow } from '../build/v4/core/dates.js';
import { decodeEntities, rankCandidates, editDistance } from '../build/v4/core/text.js';
import { shapeTask, renderTaskTable, renderTaskDetail, sanitizeCell } from '../build/v4/core/format.js';
import { readFileSync } from 'node:fs';
import { SERVER_VERSION } from '../build/v4/core/version.js';

// --------------------------------------------------------------------------- fixtures

const WORKSPACE = {
  teams: [
    {
      id: '9001',
      name: 'Acme &amp; Co',
      members: [
        { user: { id: 1, username: 'Ben', email: 'ben@example.com' } },
        { user: { id: 2, username: 'Sam', email: 'sam@example.com' } },
      ],
    },
  ],
};

const SPACES = { spaces: [{ id: '900100000001', name: 'Engineering' }, { id: '900100000002', name: 'Ops' }] };

const FOLDERS = {
  folders: [
    {
      id: '900200000001',
      name: 'Cavalry',
      space: { id: '900100000001', name: 'Engineering' },
      lists: [
        {
          id: '901400000001',
          name: 'Findings',
          task_count: 3,
          statuses: [{ status: 'Open' }, { status: 'blocked' }, { status: 'resolved' }],
        },
        { id: '901400000002', name: 'Decisions', task_count: 1 },
      ],
    },
    {
      id: '900200000002',
      name: 'Knowledge &amp; Vault',
      space: { id: '900100000001', name: 'Engineering' },
      lists: [{ id: '901400000003', name: 'Findings', task_count: 7 }],
    },
  ],
};

const SPACE_LISTS = {
  '900100000001': { lists: [{ id: '901400000004', name: 'Inbox', task_count: 0 }] },
  '900100000002': { lists: [{ id: '901400000005', name: 'Runbooks', task_count: 2 }] },
};

/** Build a fetch stub with a call log. Unknown routes fail loudly rather than returning {}. */
function makeFetch(overrides = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/api\/v[23]/, '');
    calls.push({ method: init.method ?? 'GET', path: p, search: u.search });

    for (const [pattern, handler] of Object.entries(overrides)) {
      if (p === pattern || new RegExp(`^${pattern}$`).test(p)) {
        const r = typeof handler === 'function' ? handler(u, init) : handler;
        return jsonResponse(r.status ?? 200, r.body ?? r, r.headers);
      }
    }

    if (p === '/team') return jsonResponse(200, WORKSPACE);
    if (p === '/team/9001/space') return jsonResponse(200, SPACES);
    if (p === '/team/9001/folder') return jsonResponse(200, FOLDERS);
    const sl = /^\/space\/(\d+)\/list$/.exec(p);
    if (sl) return jsonResponse(200, SPACE_LISTS[sl[1]] ?? { lists: [] });
    if (p === '/user') return jsonResponse(200, { user: { id: 1, username: 'Ben', email: 'ben@example.com' } });
    if (/^\/space\/\d+$/.test(p)) return jsonResponse(200, { statuses: [{ status: 'to do' }, { status: 'complete' }] });
    if (/^\/list\/\d+$/.test(p)) {
      return jsonResponse(200, { statuses: [{ status: 'to do' }, { status: 'in progress' }, { status: 'done' }] });
    }
    return jsonResponse(404, { err: 'not stubbed: ' + p, ECODE: 'TEST_000' });
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeResolver(fetchImpl = makeFetch()) {
  const http = new ClickUpHttp({ token: 'pk_test', fetchImpl });
  const cache = new TtlCache(60_000);
  return { resolver: new Resolver(http, cache, '9001'), http, cache, fetchImpl };
}

// --------------------------------------------------------------------------- resolver

describe('resolver: index', () => {
  test('builds the whole workspace in 3 + S calls', async () => {
    const { resolver, fetchImpl } = makeResolver();
    const idx = await resolver.index();
    // /team, /team/space, /team/folder, then one /space/{id}/list per space
    assert.equal(fetchImpl.calls.length, 3 + SPACES.spaces.length);
    assert.equal(idx.lists.length, 5);
    assert.equal(idx.spaces.length, 2);
  });

  test('is cached — a second call costs nothing', async () => {
    const { resolver, fetchImpl } = makeResolver();
    await resolver.index();
    const after = fetchImpl.calls.length;
    await resolver.index();
    assert.equal(fetchImpl.calls.length, after);
  });

  test('concurrent callers share one build rather than stampeding', async () => {
    const { resolver, fetchImpl } = makeResolver();
    await Promise.all([resolver.index(), resolver.index(), resolver.index()]);
    assert.equal(fetchImpl.calls.length, 5, 'three concurrent builds must not triple the cost');
  });

  test('decodes HTML entities so names round-trip', async () => {
    const { resolver } = makeResolver();
    const idx = await resolver.index();
    assert.equal(idx.workspaceName, 'Acme & Co');
    assert.ok(idx.lists.some((l) => l.path === 'Engineering/Knowledge & Vault/Findings'));
    assert.ok(!idx.lists.some((l) => l.path.includes('&amp;')), 'no escaped entity may survive');
  });
});

describe('resolver: never guesses', () => {
  test('an ambiguous bare name raises and names every candidate', async () => {
    const { resolver } = makeResolver();
    await assert.rejects(
      () => resolver.list('Findings'),
      (err) => {
        assert.ok(err instanceof ClickUpToolError);
        assert.match(err.message, /matches 2 lists/);
        assert.equal(err.candidates.length, 2);
        assert.ok(err.candidates.every((c) => c.endsWith('/Findings')));
        return true;
      },
    );
  });

  test('a qualified path disambiguates', async () => {
    const { resolver } = makeResolver();
    assert.equal((await resolver.list('Cavalry/Findings')).id, '901400000001');
    assert.equal((await resolver.list('Knowledge & Vault/Findings')).id, '901400000003');
  });

  test('a unique bare name resolves', async () => {
    const { resolver } = makeResolver();
    assert.equal((await resolver.list('Runbooks')).id, '901400000005');
  });

  test('an unknown name raises with ranked candidates, never an empty result', async () => {
    const { resolver } = makeResolver();
    await assert.rejects(
      () => resolver.list('Findigs'),
      (err) => {
        assert.match(err.message, /^No list matches/);
        assert.ok(err.candidates.length > 0);
        assert.ok(
          err.candidates[0].endsWith('/Findings'),
          `nearest match should rank first, got ${err.candidates[0]}`,
        );
        return true;
      },
    );
  });

  test('an ID resolves without touching the name index', async () => {
    const { resolver } = makeResolver();
    assert.equal((await resolver.list('901400000002')).id, '901400000002');
  });

  test('exact match beats substring', async () => {
    const items = [{ p: 'A/Docs' }, { p: 'A/Docs archive' }];
    const hit = matchByPath('Docs', items, (i) => i.p);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].p, 'A/Docs');
  });
});

describe('resolver: members (the silent-empty-result guard)', () => {
  test('resolves by username and email', async () => {
    const { resolver } = makeResolver();
    assert.equal((await resolver.member('Sam')).id, 2);
    assert.equal((await resolver.member('ben@example.com')).id, 1);
  });

  test('"me" resolves to the token owner', async () => {
    const { resolver } = makeResolver();
    assert.equal((await resolver.member('me')).id, 1);
  });

  test('an unknown member RAISES rather than filtering to nothing', async () => {
    const { resolver } = makeResolver();
    await assert.rejects(
      () => resolver.member('Nobody'),
      (err) => {
        assert.ok(err instanceof ClickUpToolError);
        assert.match(err.message, /No workspace member matches/);
        assert.ok(err.candidates.length >= 2);
        return true;
      },
    );
  });

  test('an unknown numeric user ID raises, with the reason spelled out', async () => {
    const { resolver } = makeResolver();
    await assert.rejects(
      () => resolver.member('99999999'),
      (err) => {
        // This is the exact ClickUp behaviour being defended against.
        assert.match(err.fix, /empty result/i);
        return true;
      },
    );
  });
});

describe('id shape detection', () => {
  test('task ids and custom ids are recognised; names are not', () => {
    assert.ok(looksLikeTaskId('86bben08h'));
    assert.ok(looksLikeTaskId('ABC-123'));
    assert.ok(!looksLikeTaskId('My task name'));
    assert.ok(!looksLikeTaskId('Findings'.repeat(3)));
  });

  test('container ids are long digit strings', () => {
    assert.ok(looksLikeContainerId('901419124570'));
    assert.ok(!looksLikeContainerId('Findings'));
    assert.ok(!looksLikeContainerId('123'));
  });
});

// --------------------------------------------------------------------------- errors

describe('errors teach', () => {
  test('every constructed error carries an actionable fix', () => {
    const errs = [
      unresolved('list', 'x', ['a', 'b']),
      ambiguous('list', 'x', ['a', 'b']),
      badValue('status', 'x', ['a']),
      fromApiError(401, { err: 'Team not authorized', ECODE: 'OAUTH_027' }, { method: 'GET', path: '/task/1', subject: 'task 1' }),
      fromApiError(404, { err: 'List not found', ECODE: 'OAUTH_055' }, { method: 'GET', path: '/list/1' }),
      fromApiError(500, { err: 'Internal Server Error', ECODE: 'ITEMV2_003' }, { method: 'GET', path: '/x' }),
      fromApiError(429, { err: 'rate limit' }, { method: 'GET', path: '/x' }),
      fromApiError(418, { err: 'teapot' }, { method: 'GET', path: '/x' }),
    ];
    for (const e of errs) {
      assert.ok(e.fix, `missing fix on: ${e.message}`);
      assert.ok(e.toolMessage().includes('Fix:'), `rendered message lacks a fix: ${e.toolMessage()}`);
    }
  });

  test('OAUTH_027 is reported as "not found", not as a permissions problem', () => {
    // ClickUp returns 401 "Team not authorized" for a task that simply does not exist.
    // Passing that through makes an agent report a permissions failure for a typo.
    const e = fromApiError(401, { err: 'Team not authorized', ECODE: 'OAUTH_027' }, {
      method: 'GET', path: '/task/nope', subject: 'task nope',
    });
    assert.match(e.message, /not found/i);
    assert.ok(!/^Team not authorized/.test(e.message));
  });

  test('candidate lists are capped so an error cannot flood the context', () => {
    const many = Array.from({ length: 500 }, (_, i) => `list-${i}`);
    const rendered = unresolved('list', 'x', many).toolMessage();
    assert.ok(rendered.length < 1200, `error was ${rendered.length} bytes`);
    assert.match(rendered, /and \d+ more/);
  });
});

// --------------------------------------------------------------------------- dates

describe('dates', () => {
  const NOW = new Date('2026-08-15T12:00:00').getTime(); // a Saturday

  test('parses ISO dates in local time', () => {
    const d = parseDate('2026-09-01', NOW);
    assert.equal(new Date(d.ms).getDate(), 1);
    assert.equal(d.hasTime, false);
  });

  test('detects an explicit time', () => {
    assert.equal(parseDate('2026-09-01 14:30', NOW).hasTime, true);
  });

  test('handles relative words', () => {
    assert.equal(parseDate('today', NOW).ms, new Date('2026-08-15T00:00:00').getTime());
    assert.equal(parseDate('tomorrow', NOW).ms, new Date('2026-08-16T00:00:00').getTime());
    assert.equal(parseDate('in 3 days', NOW).ms, new Date('2026-08-18T00:00:00').getTime());
  });

  test('"next friday" skips the coming one', () => {
    const thisFri = parseDate('friday', NOW).ms;
    const nextFri = parseDate('next friday', NOW).ms;
    assert.equal(new Date(thisFri).getDay(), 5);
    assert.equal(new Date(nextFri).getDay(), 5);
    assert.ok(nextFri > thisFri);
  });

  test('rejects an impossible date instead of rolling it over', () => {
    // new Date(2026,1,31) silently becomes March 3rd; a task quietly due on the wrong day
    // is a wrong answer that looks like a success.
    assert.throws(() => parseDate('2026-02-31', NOW), /Could not understand the date/);
  });

  test('rejects garbage rather than defaulting to now', () => {
    assert.throws(() => parseDate('sometime next quarter', NOW), ClickUpToolError);
    assert.throws(() => parseDate('', NOW), ClickUpToolError);
  });

  test('due windows', () => {
    assert.ok(parseDueWindow('overdue', NOW).lt <= NOW);
    assert.equal(parseDueWindow('none', NOW).none, true);
    const wk = parseDueWindow('week', NOW);
    assert.ok(wk.lt - wk.gt >= 7 * 86_400_000 - 1000);
    const range = parseDueWindow('2026-08-01..2026-08-31', NOW);
    assert.ok(range.gt < range.lt);
  });
});

// --------------------------------------------------------------------------- text

describe('text', () => {
  test('decodes the entities ClickUp actually emits', () => {
    assert.equal(decodeEntities('Civic &amp; Public'), 'Civic & Public');
    assert.equal(decodeEntities('a &lt;b&gt; c'), 'a <b> c');
    assert.equal(decodeEntities('&#39;quoted&#39;'), "'quoted'");
    assert.equal(decodeEntities('no entities here'), 'no entities here');
  });

  test('leaves unknown entities alone rather than mangling them', () => {
    assert.equal(decodeEntities('100 &widget; each'), '100 &widget; each');
  });

  test('ranks near-misses above alphabetical order', () => {
    const all = ['Zeta/Findings', 'Alpha/Backlog', 'Beta/Finding notes', 'Gamma/Archive'];
    const ranked = rankCandidates('Findigs', all);
    assert.equal(ranked[0], 'Zeta/Findings');
  });

  test('edit distance', () => {
    assert.equal(editDistance('kitten', 'sitting'), 3);
    assert.equal(editDistance('same', 'same'), 0);
  });
});

// --------------------------------------------------------------------------- formatting

describe('formatting', () => {
  const raw = {
    id: 'T1',
    name: 'Fix the &amp; thing',
    status: { status: 'in progress', type: 'custom' },
    assignees: [{ id: 1, username: 'Ben' }],
    tags: [{ name: 'urgent' }],
    priority: { id: 2, priority: 'high' },
    due_date: String(new Date('2026-08-20T00:00:00Z').getTime()),
    list: { id: '901400000001', name: 'Findings' },
    sharing: { public: false, token: null, seo_optimized: false },
    watchers: [{ id: 1, username: 'Ben' }],
    creator: { id: 1, username: 'Ben', profilePicture: 'https://…' },
    orderindex: '1.00000000000000000000',
  };

  test('drops the fields that are 45% of the payload', () => {
    const s = shapeTask(raw);
    assert.equal(s.sharing, undefined);
    assert.equal(s.watchers, undefined);
    assert.equal(s.creator, undefined);
    assert.equal(s.orderindex, undefined);
  });

  test('keeps everything an agent can act on', () => {
    const s = shapeTask(raw);
    assert.equal(s.id, 'T1');
    assert.equal(s.name, 'Fix the & thing');
    assert.equal(s.status, 'in progress');
    assert.deepEqual(s.assignees, ['Ben']);
    assert.equal(s.priority, 'high');
    assert.equal(s.due, '2026-08-20');
  });

  test('suppresses columns where every row is empty', () => {
    const bare = shapeTask({ id: 'T2', name: 'x', status: { status: 'to do' } });
    const table = renderTaskTable([bare]);
    assert.ok(!table.includes('assignees'), table);
    assert.ok(!table.includes('due'), table);
    assert.ok(table.includes('id\tstatus\tname'));
  });

  test('hoists the invariant list out of the rows', () => {
    const rows = [shapeTask(raw), shapeTask({ ...raw, id: 'T2' })];
    const table = renderTaskTable(rows, { header: 'Findings — 2 matches', hideColumns: ['list'] });
    assert.equal(table.split('\n').filter((l) => l.includes('Findings')).length, 1,
      'the list name must appear once in the header, not on every row');
  });

  test('a task name containing a tab or newline cannot forge a row', () => {
    const evil = shapeTask({
      id: 'T3',
      name: 'benign\textra-column\nT4\tfake\tforged row',
      status: { status: 'to do' },
    });
    const table = renderTaskTable([evil]);
    assert.equal(table.split('\n').length, 2, 'header + exactly one row');
    assert.ok(!table.includes('\n T4'));
  });

  test('sanitizeCell strips control characters', () => {
    assert.equal(sanitizeCell('a bc'), 'abc');
    assert.equal(sanitizeCell('a\tb\nc'), 'a b c');
  });

  test('detail view renders only the fields that exist', () => {
    const s = shapeTask(raw, 'full');
    const d = renderTaskDetail(s);
    assert.match(d, /^task: Fix the & thing \(T1\)/m);
    assert.ok(!d.includes('start:'), 'absent fields must not print empty rows');
  });
});

// --------------------------------------------------------------------------- rate governor

describe('rate-limit governor', () => {
  function stubClock() {
    let t = 1_000_000;
    const slept = [];
    return {
      now: () => t,
      sleep: async (ms) => { slept.push(ms); t += ms; },
      slept,
      advance: (ms) => { t += ms; },
    };
  }

  test('reads the live budget off the response headers', async () => {
    const clock = stubClock();
    const fetchImpl = async () => jsonResponse(200, { ok: true }, {
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '42',
      'x-ratelimit-reset': String(Math.floor(clock.now() / 1000) + 30),
    });
    const http = new ClickUpHttp({ token: 'pk', fetchImpl, clock });
    await http.get('/team');
    const s = http.rateState();
    assert.equal(s.limit, 100);
    assert.equal(s.remaining, 42);
    assert.ok(s.resetAt > clock.now());
  });

  test('holds when the budget is nearly spent, instead of running it to zero', async () => {
    const clock = stubClock();
    let n = 0;
    const fetchImpl = async () => {
      n++;
      return jsonResponse(200, { ok: true }, {
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': n === 1 ? '2' : '99',
        'x-ratelimit-reset': String(Math.floor(clock.now() / 1000) + 20),
      });
    };
    const http = new ClickUpHttp({ token: 'pk', fetchImpl, clock, reserve: 5 });
    await http.get('/a');
    await http.get('/b');
    assert.equal(http.throttleWaits, 1, 'should have waited once for the window to reset');
    assert.ok(clock.slept[0] >= 20_000, `slept ${clock.slept[0]}ms, expected ~20s`);
  });

  test('retries a 429 and honours retry-after', async () => {
    const clock = stubClock();
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) return jsonResponse(429, { err: 'rate limited' }, { 'retry-after': '3' });
      return jsonResponse(200, { ok: true });
    };
    const http = new ClickUpHttp({ token: 'pk', fetchImpl, clock });
    const res = await http.get('/a');
    assert.deepEqual(res, { ok: true });
    assert.equal(calls, 2);
    assert.ok(clock.slept[0] >= 3000, `slept ${clock.slept[0]}ms`);
  });

  test('gives up after maxRetries and returns a teaching error', async () => {
    const clock = stubClock();
    const fetchImpl = async () => jsonResponse(429, { err: 'rate limited' }, { 'retry-after': '1' });
    const http = new ClickUpHttp({ token: 'pk', fetchImpl, clock, maxRetries: 2 });
    await assert.rejects(
      () => http.get('/a'),
      (err) => {
        assert.ok(err instanceof ClickUpToolError);
        assert.match(err.message, /rate limit/i);
        assert.ok(err.fix);
        return true;
      },
    );
  });

  test('does not retry a 4xx that will never succeed', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return jsonResponse(404, { err: 'List not found', ECODE: 'OAUTH_055' }); };
    const http = new ClickUpHttp({ token: 'pk', fetchImpl, clock: stubClock() });
    await assert.rejects(() => http.get('/list/x'));
    assert.equal(calls, 1, 'a 404 must not be retried');
  });

  test('a network failure becomes a teaching error, not a raw stack', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
    const http = new ClickUpHttp({ token: 'pk', fetchImpl, clock: stubClock() });
    await assert.rejects(
      () => http.get('/team'),
      (err) => {
        assert.ok(err instanceof ClickUpToolError);
        assert.ok(err.fix);
        return true;
      },
    );
  });
});

describe('query building', () => {
  test('expands arrays into ClickUp bracket form and drops empties', () => {
    assert.equal(qs({ a: 1, b: undefined, c: '', d: [1, 2] }), '?a=1&d[]=1&d[]=2');
  });
  test('encodes values', () => {
    assert.equal(qs({ q: 'a b&c' }), '?q=a%20b%26c');
  });
});

// --------------------------------------------------------------------------- cache

describe('cache', () => {
  test('expires on TTL', () => {
    let t = 0;
    const c = new TtlCache(100, () => t);
    c.set('k', 'v');
    assert.equal(c.get('k'), 'v');
    t = 101;
    assert.equal(c.get('k'), undefined);
  });

  test('remember() shares one in-flight build', async () => {
    const c = new TtlCache(1000);
    let builds = 0;
    const build = async () => { builds++; await new Promise((r) => setTimeout(r, 5)); return 'x'; };
    await Promise.all([c.remember('k', build), c.remember('k', build), c.remember('k', build)]);
    assert.equal(builds, 1);
  });

  test('a failed build is not cached', async () => {
    const c = new TtlCache(1000);
    await assert.rejects(() => c.remember('k', async () => { throw new Error('boom'); }));
    assert.equal(await c.remember('k', async () => 'ok'), 'ok');
  });
});

// ------------------------------------------------------- status vocabulary (regression)

describe('status vocabulary', () => {
  test('lists that override their space are included', async () => {
    // Real workspaces do this constantly: "blocked", "ready", "accepted — no action" exist on
    // lists while the parent space declares only "to do"/"complete". Validating against space
    // defaults alone rejected perfectly valid queries.
    const { resolver } = makeResolver();
    const known = await resolver.knownStatuses();
    for (const s of ['Open', 'blocked', 'resolved']) {
      assert.ok(known.includes(s), `list-level status "${s}" missing from the vocabulary`);
    }
  });

  test('space defaults are included too, for folderless lists', async () => {
    const { resolver } = makeResolver();
    const known = await resolver.knownStatuses();
    assert.ok(known.includes('to do'));
    assert.ok(known.includes('complete'));
  });

  test('a folder list\'s statuses cost no extra API call', async () => {
    const { resolver, fetchImpl } = makeResolver();
    await resolver.index();
    const before = fetchImpl.calls.length;
    const st = await resolver.listStatuses('901400000001');
    assert.deepEqual(st, ['Open', 'blocked', 'resolved']);
    assert.equal(fetchImpl.calls.length, before, 'the folder index already carried these');
  });

  test('a folderless list still resolves its statuses, by fetching', async () => {
    const { resolver, fetchImpl } = makeResolver();
    await resolver.index();
    const before = fetchImpl.calls.length;
    await resolver.listStatuses('901400000005');
    assert.ok(fetchImpl.calls.length > before, 'folderless lists are not in the index');
  });
});

/**
 * The version the server reports must be the version that was packaged.
 *
 * `SERVER_VERSION` is a hand-maintained constant and `package.json` is bumped separately, so
 * nothing stopped them drifting. That matters more here than in most projects: `whoami` and
 * `--check` print this string, and the documented first move when a fix appears not to have
 * taken effect is to compare it against what you expect. A stale constant turns that
 * diagnostic into a liar and sends people hunting for a host holding an old process.
 */
describe('version', () => {
  test('SERVER_VERSION matches package.json', async () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    assert.equal(SERVER_VERSION, pkg.version);
  });
});
