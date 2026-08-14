// Phase 4 tests: response shaping and bulk-op normalization.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { trimTask, shapeTaskList, ok, fail, toolHandler, coerceDate, coerceDuration, normalizeTaskDates } from '../build/tools/helpers.js';
import { ClickUpClient } from '../build/clickup-client/index.js';
import { TasksClient } from '../build/clickup-client/tasks.js';

const RAW_TASK = {
  id: 't1',
  name: 'Fix the thing',
  status: { status: 'in progress', color: '#ff0', type: 'custom', orderindex: 1 },
  priority: { id: '2', priority: 'high', color: '#f00', orderindex: '2' },
  assignees: [
    { id: 7, username: 'ben', email: 'b@x.com', color: '#0f0', initials: 'B', profilePicture: 'http://x/y.png' },
    { id: 8, email: 'no-name@x.com' }
  ],
  due_date: '1720000000000',
  date_updated: '1719000000000',
  url: 'https://app.clickup.com/t/t1',
  tags: [{ name: 'bug', tag_fg: '#fff', tag_bg: '#000' }],
  creator: { id: 7, username: 'ben', profilePicture: 'x' },
  watchers: [], checklists: [], custom_fields: [{ id: 'f', value: 1 }],
  team_id: '999', permission_level: 'create', list: { id: 'l1' }, project: { id: 'p1' },
  folder: { id: 'f1' }, space: { id: 's1' }, sharing: { public: false },
  description: 'long text '.repeat(200),
};

test('trimTask keeps lean fields and flattens status/priority/assignees/tags', () => {
  const lean = trimTask(RAW_TASK);
  assert.equal(lean.id, 't1');
  assert.equal(lean.status, 'in progress');
  assert.equal(lean.priority, 'high');
  assert.deepEqual(lean.assignees, ['ben', 'no-name@x.com']);
  assert.deepEqual(lean.tags, ['bug']);
  assert.equal(lean.url, 'https://app.clickup.com/t/t1');
  // noise dropped
  assert.equal(lean.creator, undefined);
  assert.equal(lean.description, undefined);
  assert.equal(lean.custom_fields, undefined);
  assert.equal(lean.permission_level, undefined);
});

test('trimTask honors a custom field list', () => {
  const picked = trimTask(RAW_TASK, ['id', 'description']);
  assert.deepEqual(Object.keys(picked).sort(), ['description', 'id']);
});

test('lean shaping is dramatically smaller than raw', () => {
  const tasks = Array.from({ length: 50 }, () => RAW_TASK);
  const rawBytes = JSON.stringify({ tasks }).length;
  const leanBytes = JSON.stringify(shapeTaskList(tasks)).length;
  assert.ok(leanBytes < rawBytes / 5, `lean ${leanBytes} should be <20% of raw ${rawBytes}`);
});

test('shapeTaskList full detail returns raw objects and no note', () => {
  const shaped = shapeTaskList([RAW_TASK], { detail: 'full' });
  assert.equal(shaped.tasks[0].creator.username, 'ben');
  assert.equal(shaped.note, undefined);
  assert.equal(shaped.count, 1);
});

test('shapeTaskList marks incomplete results', () => {
  const shaped = shapeTaskList([RAW_TASK], { complete: false });
  assert.equal(shaped.data_complete, false);
  assert.match(shaped.note, /truncated/);
});

test('ok() emits compact JSON; fail() sets isError', () => {
  const res = ok({ a: 1 });
  assert.equal(res.content[0].text, '{"a":1}');
  const err = fail('TestCtx', new Error('boom'));
  assert.equal(err.isError, true);
  assert.match(err.content[0].text, /TestCtx: boom/);
});

test('toolHandler wraps success and failure', async () => {
  const good = toolHandler('Ctx', async () => ({ x: 1 }));
  assert.equal((await good({})).content[0].text, '{"x":1}');
  const bad = toolHandler('Ctx', async () => { throw new Error('nope'); });
  const res = await bad({});
  assert.equal(res.isError, true);
});

// ── Date coercion ──────────────────────────────────────────────────────

test('coerceDate passes numbers through', () => {
  assert.deepEqual(coerceDate(1720000000000), { ms: 1720000000000, hasTime: true });
});

test('coerceDate: date-only string lands on the right calendar day, no time', () => {
  const { ms, hasTime } = coerceDate('2026-08-15');
  const d = new Date(ms);
  assert.equal(hasTime, false);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 15);
  assert.equal(d.getHours(), 12); // noon local keeps the date stable across TZs
});

test('coerceDate: date+time string parses as local time', () => {
  const { ms, hasTime } = coerceDate('2026-08-15 09:30');
  const d = new Date(ms);
  assert.equal(hasTime, true);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
});

test('coerceDate rejects garbage with an actionable message', () => {
  assert.throws(() => coerceDate('next tuesday'), /Unparseable date/);
});

test('normalizeTaskDates converts strings and sets *_time flags', () => {
  const p = normalizeTaskDates({ due_date: '2026-08-15', start_date: '2026-08-14 08:00' });
  assert.equal(typeof p.due_date, 'number');
  assert.equal(p.due_date_time, false);
  assert.equal(typeof p.start_date, 'number');
  assert.equal(p.start_date_time, true);
});

test('normalizeTaskDates leaves explicit flags and numeric dates alone', () => {
  const p = normalizeTaskDates({ due_date: 1720000000000, due_date_time: false });
  assert.equal(p.due_date, 1720000000000);
  assert.equal(p.due_date_time, false);
});

test('coerceDuration parses ms, and human forms', () => {
  assert.equal(coerceDuration(600000), 600000);
  assert.equal(coerceDuration('600000'), 600000);
  assert.equal(coerceDuration('90m'), 90 * 60000);
  assert.equal(coerceDuration('1h 30m'), 90 * 60000);
  assert.equal(coerceDuration('1.5h'), 90 * 60000);
  assert.equal(coerceDuration('45s'), 45000);
  assert.throws(() => coerceDuration('a while'), /Unparseable duration/);
});

// ── Bulk normalization against a mock server ───────────────────────────

let server, baseUrl;
let failNames = new Set();

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const parsed = body ? JSON.parse(body) : {};
    if (req.method === 'POST' && /\/list\/l1\/task$/.test(req.url)) {
      if (failNames.has(parsed.name)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ err: 'bad task', ECODE: 'INPUT_001' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'id_' + parsed.name, name: parsed.name }));
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ err: 'route' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('bulkCreateTasks: continue_on_error collects failures, never throws', async () => {
  failNames = new Set(['b']);
  const client = new ClickUpClient({ apiToken: 't', baseUrlV2: baseUrl, maxRetries: 0 });
  const tasksClient = new TasksClient(client);
  const out = await tasksClient.bulkCreateTasks('l1', [{ name: 'a' }, { name: 'b' }, { name: 'c' }], true);
  assert.equal(out.succeeded, 2);
  assert.equal(out.failed, 1);
  assert.equal(out.results.length, 3);
  assert.equal(out.results[1].status, 'failed');
  assert.match(out.results[1].error, /bad task/);
});

test('bulkCreateTasks: stop-on-first-failure marks remainder skipped', async () => {
  failNames = new Set(['b']);
  const client = new ClickUpClient({ apiToken: 't', baseUrlV2: baseUrl, maxRetries: 0 });
  const tasksClient = new TasksClient(client);
  const out = await tasksClient.bulkCreateTasks('l1', [{ name: 'a' }, { name: 'b' }, { name: 'c' }], false);
  assert.equal(out.stopped_early, true);
  assert.deepEqual(out.results.map(r => r.status), ['created', 'failed', 'skipped']);
  assert.equal(out.succeeded, 1);
  assert.equal(out.failed, 1);
});
