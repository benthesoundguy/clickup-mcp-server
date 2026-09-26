/**
 * Regressions from driving v4 end to end against a stateful ClickUp stub (2026-09-26):
 *
 * - a POST that ClickUp committed and then answered with a 5xx was retried, so one `create`
 *   made two tasks (and one `comment` posted twice) while reporting a single success;
 * - `docs read` reported every doc as "no pages", because ClickUp answers with a bare array
 *   and the tool read `.pages` off it;
 * - `create` accepted `custom_fields`, dropped it, and reported "created 1/1".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { buildContext } from '../build/v4/server.js';
import { ClickUpHttp } from '../build/v4/core/http.js';
import { ClickUpToolError } from '../build/v4/core/errors.js';
import { createTool } from '../build/v4/tools/tasks.js';
import { docsTool } from '../build/v4/tools/extras.js';

const WS = '9001';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const noSleep = { now: () => 0, sleep: async () => {} };

// --------------------------------------------------------------------------- retries
describe('retries never replay a write that may have landed', () => {
  test('a POST answered with 500 is sent once, and the error says it may have applied', async () => {
    let calls = 0;
    const http = new ClickUpHttp({
      token: 'pk',
      clock: noSleep,
      fetchImpl: async () => { calls++; return json({ err: 'Internal Server Error' }, 500); },
    });
    await assert.rejects(
      () => http.post('/list/1/task', { name: 'Ship X' }),
      (err) => {
        assert.ok(err instanceof ClickUpToolError);
        assert.match(err.message, /may have applied/i);
        assert.match(err.fix ?? '', /duplicate/i);
        return true;
      },
    );
    assert.equal(calls, 1, 'replaying the POST is what created the second task');
  });

  test('502, 503 and 504 are not replayed on a POST either', async () => {
    for (const status of [502, 503, 504]) {
      let calls = 0;
      const http = new ClickUpHttp({
        token: 'pk',
        clock: noSleep,
        fetchImpl: async () => { calls++; return json({}, status); },
      });
      await assert.rejects(() => http.post('/task/abc/comment', { comment_text: 'x' }));
      assert.equal(calls, 1, `POST replayed after ${status}`);
    }
  });

  test('an upload answered with 5xx says it may have applied', async () => {
    let calls = 0;
    const http = new ClickUpHttp({
      token: 'pk',
      clock: noSleep,
      fetchImpl: async () => { calls++; return json({ err: 'Internal Server Error' }, 502); },
    });
    const form = new FormData();
    form.append('attachment', new Blob(['x']), 'x.txt');
    await assert.rejects(
      () => http.upload('/task/abc/attachment', form),
      (err) => {
        assert.match(err.message, /may have applied/i);
        return true;
      },
    );
    assert.equal(calls, 1);
  });

  test('a POST refused with 429 is still retried — ClickUp never processed it', async () => {
    let calls = 0;
    const http = new ClickUpHttp({
      token: 'pk',
      clock: noSleep,
      fetchImpl: async () => {
        calls++;
        return calls === 1 ? json({ err: 'rate limited' }, 429) : json({ id: 'new' });
      },
    });
    assert.deepEqual(await http.post('/list/1/task', { name: 'a' }), { id: 'new' });
    assert.equal(calls, 2);
  });

  test('idempotent methods still retry a 5xx', async () => {
    for (const method of ['get', 'put', 'delete']) {
      let calls = 0;
      const http = new ClickUpHttp({
        token: 'pk',
        clock: noSleep,
        fetchImpl: async () => { calls++; return calls === 1 ? json({}, 500) : json({ ok: true }); },
      });
      const res = method === 'put' ? await http.put('/task/abc', { status: 'done' }) : await http[method]('/task/abc');
      assert.deepEqual(res, { ok: true });
      assert.equal(calls, 2, `${method} should retry once after a 500`);
    }
  });

  test('a POST that times out says it may have applied, not "retry once"', async () => {
    const http = new ClickUpHttp({
      token: 'pk',
      clock: noSleep,
      timeoutMs: 5,
      fetchImpl: (_url, init) =>
        new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            rej(e);
          });
        }),
    });
    await assert.rejects(
      () => http.post('/list/1/task', { name: 'a' }),
      (err) => {
        assert.match(err.message, /may have applied/i);
        assert.doesNotMatch(err.fix ?? '', /^Retry once/);
        return true;
      },
    );
  });

  test('create reports a 5xx as a possible write, having sent exactly one POST', async () => {
    const posts = [];
    const { ctx } = stubWorld({
      onCreate: (body) => { posts.push(body); return json({ err: 'Internal Server Error' }, 500); },
    });
    const out = await createTool.handler({ list: 'Cavalry/Findings', tasks: [{ name: 'Ship X' }] }, ctx);
    assert.equal(posts.length, 1);
    assert.match(out, /created 0\/1/);
    assert.match(out, /may have applied/i);
  });
});

// --------------------------------------------------------------------------- docs read
describe('docs read', () => {
  function docsCtx(pagesBody) {
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      return json(pagesBody);
    };
    return { ctx: buildContext({ token: 'pk', workspaceId: WS, fetchImpl }), seen };
  }

  test('reads ClickUp\'s bare-array response, including nested sub-pages', async () => {
    const { ctx, seen } = docsCtx([
      { id: 'p1', name: 'Cascade', content: '1. capture\n2. triage', pages: [
        { id: 'p2', name: 'Claiming', content: 'set held_by' },
      ] },
      { id: 'p3', name: null, content: '' },
    ]);
    const out = await docsTool.handler({ action: 'read', id: 'd1' }, ctx);
    assert.doesNotMatch(out, /no pages/);
    assert.match(out, /^## Cascade\n1\. capture/m);
    assert.match(out, /^### Claiming\nset held_by/m, 'sub-pages are read and nested one level down');
    assert.match(out, /## \(untitled\)\n\(empty page\)/);
    assert.match(seen[0], /max_page_depth=-1/, 'without it ClickUp omits sub-pages');
    assert.match(seen[0], /content_format=text%2Fmd/);
  });

  test('an empty array is genuinely "no pages"', async () => {
    const { ctx } = docsCtx([]);
    assert.match(await docsTool.handler({ action: 'read', id: 'd1' }, ctx), /no pages/);
  });

  test('an unrecognised shape is an error, never "no pages"', async () => {
    const { ctx } = docsCtx({ data: [{ name: 'x', content: 'y' }] });
    await assert.rejects(() => docsTool.handler({ action: 'read', id: 'd1' }, ctx), ClickUpToolError);
  });
});

// --------------------------------------------------------------------------- create + fields
const FIELDS = [
  { id: 'cf-held', name: 'held_by', type: 'text' },
  { id: 'cf-att', name: 'attempts', type: 'text' },
  { id: 'cf-lane', name: 'lane', type: 'drop_down', type_config: { options: [
    { id: 'opt-infra', name: 'infra', orderindex: 0 },
    { id: 'opt-fac', name: 'factory', orderindex: 1 },
  ] } },
];

function stubWorld({ onCreate, onGetTask } = {}) {
  const creates = [];
  const fetchImpl = async (url, init = {}) => {
    const p = new URL(url).pathname.replace(/^\/api\/v[23]/, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (p === '/team') return json({ teams: [{ id: WS, name: 'Acme', members: [] }] });
    if (p === `/team/${WS}/space`) return json({ spaces: [{ id: 's1', name: 'Engineering' }] });
    if (p === `/team/${WS}/folder`) {
      return json({ folders: [{ id: 'f1', name: 'Cavalry', space: { id: 's1', name: 'Engineering' },
        lists: [{ id: '901', name: 'Findings', statuses: [{ status: 'to do' }] }] }] });
    }
    if (p === '/space/s1/list') return json({ lists: [] });
    if (p === '/list/901/field') return json({ fields: FIELDS });
    if (p === '/list/901/task' && method === 'POST') {
      creates.push(body);
      if (onCreate) return onCreate(body);
      const values = new Map((body.custom_fields ?? []).map((c) => [c.id, c.value]));
      return json({
        id: `86bb${creates.length}`,
        name: body.name,
        status: { status: 'to do', type: 'open' },
        list: { id: '901', name: 'Findings' },
        custom_fields: FIELDS.map((f) => ({ ...f, value: values.get(f.id) })),
      });
    }
    if (/^\/task\/\w+$/.test(p) && method === 'GET' && onGetTask) return onGetTask(p.split('/')[2]);
    return json({ err: `not stubbed: ${method} ${p}`, ECODE: 'TEST_000' }, 404);
  };
  return { ctx: buildContext({ token: 'pk', workspaceId: WS, profile: 'agent', fetchImpl }), creates };
}

describe('create with custom fields', () => {
  test('sets fields by name at creation — allowed under agent, since the task is new', async () => {
    const { ctx, creates } = stubWorld();
    const out = await createTool.handler(
      { list: 'Cavalry/Findings', tasks: [{ name: 'Claimable', fields: { held_by: 'night-shift', Lane: 'infra' } }] },
      ctx,
    );
    assert.match(out, /created 1\/1/);
    assert.doesNotMatch(out, /FIELDS NOT SET/);
    assert.deepEqual(creates[0].custom_fields, [
      { id: 'cf-held', value: 'night-shift' },
      { id: 'cf-lane', value: 'opt-infra' },
    ]);
  });

  test('an unknown field name fails before anything is written', async () => {
    const { ctx, creates } = stubWorld();
    await assert.rejects(
      () => createTool.handler(
        { list: 'Cavalry/Findings', tasks: [{ name: 'ok' }, { name: 'typo', fields: { helb_by: 'x' } }] },
        ctx,
      ),
      (err) => {
        assert.ok(err instanceof ClickUpToolError);
        assert.match(err.message, /helb_by/);
        return true;
      },
    );
    assert.equal(creates.length, 0, 'validation covers every entry before the first write');
  });

  test('a field ClickUp did not store is reported, not claimed', async () => {
    const { ctx } = stubWorld({
      onCreate: (body) => json({
        id: '86bbX', name: body.name, status: { status: 'to do' }, list: { id: '901', name: 'Findings' },
        custom_fields: FIELDS.map((f) => ({ ...f, value: undefined })),
      }),
    });
    const out = await createTool.handler(
      { list: 'Cavalry/Findings', tasks: [{ name: 'Claimable', fields: { held_by: 'night-shift' } }] },
      ctx,
    );
    assert.match(out, /FIELDS NOT SET/);
    assert.match(out, /86bbX.*held_by/);
  });

  // ClickUp's create reply can omit custom_fields; the tool then reads the task back.
  const replyWithoutFields = (body) => json({
    id: '86bbY', name: body.name, status: { status: 'to do' }, list: { id: '901', name: 'Findings' },
  });

  test('verifies by reading the task back when the create reply omits custom_fields', async () => {
    const reads = [];
    const { ctx } = stubWorld({
      onCreate: replyWithoutFields,
      onGetTask: (id) => {
        reads.push(id);
        return json({ id, custom_fields: [{ ...FIELDS[0], value: 'night-shift' }] });
      },
    });
    const out = await createTool.handler(
      { list: 'Cavalry/Findings', tasks: [{ name: 'Claimable', fields: { held_by: 'night-shift' } }] },
      ctx,
    );
    assert.deepEqual(reads, ['86bbY']);
    assert.match(out, /created 1\/1/);
    assert.doesNotMatch(out, /FIELDS NOT SET|FIELDS UNVERIFIED|FAILED/);
  });

  test('a failed read-back never lists the created task as FAILED', async () => {
    const { ctx } = stubWorld({
      onCreate: replyWithoutFields,
      onGetTask: () => json({ err: 'Internal Server Error' }, 500),
    });
    const out = await createTool.handler(
      { list: 'Cavalry/Findings', tasks: [{ name: 'Claimable', fields: { held_by: 'night-shift' } }] },
      ctx,
    );
    assert.match(out, /created 1\/1/);
    assert.doesNotMatch(out, /FAILED/, 'an agent reading FAILED re-creates the task — a duplicate');
    assert.match(out, /FIELDS UNVERIFIED[\s\S]*86bbY/);
    assert.match(out, /do not re-create/);
  });

  test('unknown keys on a task entry are refused, not silently dropped', () => {
    const schema = z.object(createTool.schema);
    const dropped = schema.safeParse({
      list: 'Cavalry/Findings',
      tasks: [{ name: 'x', custom_fields: [{ id: 'cf-held', value: 'y' }] }],
    });
    assert.equal(dropped.success, false, '`custom_fields` used to vanish and report success');
    assert.equal(schema.safeParse({ list: 'L', tasks: [{ name: 'x', fields: { held_by: 'y' } }] }).success, true);
  });
});
