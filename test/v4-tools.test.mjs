/**
 * Tool-level tests, including regressions for every bug found by live probing.
 *
 * The move bug in particular is why these exist: it was invisible to a mocked test that
 * returned 200, and only a read-back against the real API exposed it. These stubs therefore
 * model what ClickUp *actually does* — including the endpoints that return 200 and lie.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildContext } from '../build/v4/server.js';
import { findTool, createTool, updateTool, taskTool } from '../build/v4/tools/tasks.js';
import { listsTool, metaTool, treeTool } from '../build/v4/tools/structure.js';
import { ClickUpToolError } from '../build/v4/core/errors.js';

const WORKSPACE_ID = '9001';

const SPACES = { spaces: [{ id: '900100000001', name: 'Engineering' }] };
const FOLDERS = {
  folders: [
    {
      id: '900200000001',
      name: 'Cavalry',
      space: { id: '900100000001', name: 'Engineering' },
      lists: [
        { id: '901400000001', name: 'Findings', task_count: 2 },
        { id: '901400000002', name: 'Archive', task_count: 0 },
      ],
    },
  ],
};

function task(id, over = {}) {
  return {
    id,
    name: `Task ${id}`,
    status: { status: 'to do', type: 'open' },
    assignees: [],
    tags: [],
    list: { id: '901400000001', name: 'Findings' },
    ...over,
  };
}

/**
 * A ClickUp stub. `world` holds mutable state so writes can be observed, and the move
 * endpoint deliberately reproduces the real silent no-op.
 */
function makeCtx(opts = {}) {
  const world = {
    tasks: opts.tasks ?? [task('t1'), task('t2')],
    posts: [],
    puts: [],
    deletes: [],
    /** Set true to simulate the "Tasks in Multiple Lists" ClickApp being enabled. */
    moveWorks: opts.moveWorks ?? false,
    pageCount: opts.pageCount ?? 1,
  };

  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/api\/v[23]/, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;

    if (p === '/team') {
      return json({ teams: [{ id: WORKSPACE_ID, name: 'Acme', members: [{ user: { id: 1, username: 'Ben', email: 'ben@example.com' } }] }] });
    }
    if (p === `/team/${WORKSPACE_ID}/space`) return json(SPACES);
    if (p === `/team/${WORKSPACE_ID}/folder`) return json(FOLDERS);
    if (/^\/space\/\d+\/list$/.test(p)) return json({ lists: [] });
    if (p === '/user') return json({ user: { id: 1, username: 'Ben', email: 'ben@example.com' } });

    if (/^\/list\/\d+$/.test(p) && method === 'GET') {
      return json({ statuses: [{ status: 'to do' }, { status: 'done' }] });
    }

    // Task query. Paginates like ClickUp: always 100 per page, `last_page` on the tail.
    if (p === `/team/${WORKSPACE_ID}/task`) {
      const page = Number(u.searchParams.get('page') ?? 0);
      if (world.pageCount > 1) {
        const full = Array.from({ length: 100 }, (_, i) => task(`p${page}-${i}`));
        return json({ tasks: full, last_page: page >= world.pageCount - 1 });
      }
      return json({ tasks: world.tasks, last_page: true });
    }

    if (/^\/list\/\d+\/task$/.test(p) && method === 'GET') {
      return json({ tasks: world.tasks, last_page: true });
    }

    if (/^\/list\/\d+\/task$/.test(p) && method === 'POST') {
      const created = task(`new${world.tasks.length + 1}`, { name: body.name, status: { status: body.status ?? 'to do', type: 'open' } });
      world.tasks.push(created);
      world.posts.push({ p, body });
      return json(created);
    }

    // The move endpoint. Real ClickUp returns 200 {} and does nothing when the ClickApp is
    // off — that behaviour is the point of this stub.
    const move = /^\/list\/(\d+)\/task\/(\w+)$/.exec(p);
    if (move && method === 'POST') {
      world.posts.push({ p, body });
      if (world.moveWorks) {
        const t = world.tasks.find((x) => x.id === move[2]);
        if (t) t.list = { id: move[1], name: 'Archive' };
      }
      return json({});
    }

    const one = /^\/task\/(\w+)$/.exec(p);
    if (one) {
      const t = world.tasks.find((x) => x.id === one[1]);
      if (!t) return json({ err: 'Team not authorized', ECODE: 'OAUTH_027' }, 401);
      if (method === 'PUT') {
        world.puts.push({ id: one[1], body });
        Object.assign(t, body.status ? { status: { status: body.status, type: 'open' } } : {});
        return json(t);
      }
      if (method === 'DELETE') {
        world.deletes.push(one[1]);
        return json({});
      }
      return json(t);
    }

    if (/^\/task\/\w+\/comment$/.test(p)) return json({ comments: [] });
    if (/^\/list\/\d+\/field$/.test(p)) return json({ fields: [] });
    if (/^\/folder\/\d+\/list$/.test(p) && method === 'POST') return json({ id: '901400000009', name: body.name });
    if (/^\/list\/\d+$/.test(p) && method === 'DELETE') { world.deletes.push(p); return json({}); }

    return json({ err: 'not stubbed: ' + method + ' ' + p, ECODE: 'TEST_000' }, 404);
  };

  const ctx = buildContext({ token: 'pk_test', workspaceId: WORKSPACE_ID, profile: 'full', fetchImpl });
  return { ctx, world };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// --------------------------------------------------------------------- move (regression)

describe('update: move verification (regression — shipped as a silent lie)', () => {
  test('raises when ClickUp accepts the move and does not perform it', async () => {
    // The endpoint returns HTTP 200 with an empty body and leaves the task where it was.
    // v4 originally reported "updated + moved: 1/1" while printing the old list one line below.
    const { ctx } = makeCtx({ moveWorks: false });
    await assert.rejects(
      () => updateTool.handler({ ids: ['t1'], move_to: 'Archive' }, ctx),
      (err) => {
        assert.ok(err instanceof ClickUpToolError);
        assert.match(err.message, /NOT moved/);
        assert.match(err.message, /t1/);
        assert.match(err.fix, /Tasks in Multiple Lists/);
        return true;
      },
    );
  });

  test('succeeds quietly when the move genuinely takes', async () => {
    const { ctx } = makeCtx({ moveWorks: true });
    const out = await updateTool.handler({ ids: ['t1'], move_to: 'Archive' }, ctx);
    assert.match(out, /moved to Engineering\/Cavalry\/Archive/);
  });

  test('reports that other field changes still applied', async () => {
    const { ctx, world } = makeCtx({ moveWorks: false });
    await assert.rejects(
      () => updateTool.handler({ ids: ['t1'], move_to: 'Archive', status: 'done' }, ctx),
      (err) => {
        assert.match(err.message, /field changes in this call were applied/);
        return true;
      },
    );
    assert.equal(world.puts.length, 1, 'the status write really did happen');
    assert.equal(world.puts[0].body.status, 'done');
  });
});

// --------------------------------------------------------------- counts (regression)

describe('find: never overstates the result count', () => {
  test('an exhausted query reports an exact count', async () => {
    const { ctx } = makeCtx();
    const out = await findTool.handler({ scope: 'Findings' }, ctx);
    assert.match(out, /2 matches/);
    assert.ok(!out.includes('+ matches'), out);
  });

  test('a truncated query reports a floor, not a total', async () => {
    // Originally printed "100 matches" after fetching exactly one page of a larger set.
    const { ctx } = makeCtx({ pageCount: 5 });
    const out = await findTool.handler({ limit: 3 }, ctx);
    assert.match(out, /\+ matches \(more exist/);
    assert.ok(!/— 100 matches/.test(out), 'must not present a page size as a total');
  });

  test('client-side filtering always states what was scanned', async () => {
    const { ctx } = makeCtx();
    const out = await findTool.handler({ scope: 'Findings', text: 'Task t1' }, ctx);
    assert.match(out, /scanned \d+ tasks?, complete/);
  });

  test('a page-limited client-side filter warns that the answer is incomplete', async () => {
    const { ctx } = makeCtx({ pageCount: 50 });
    const out = await findTool.handler({ text: 'nothing-matches-this' }, ctx);
    assert.match(out, /HIT PAGE LIMIT/);
    assert.match(out, /NOT a complete answer/);
  });
});

// ------------------------------------------------------------------- validate-before-write

describe('writes validate before touching anything', () => {
  test('an invalid status on any entry aborts the whole batch', async () => {
    const { ctx, world } = makeCtx();
    const before = world.tasks.length;
    await assert.rejects(
      () =>
        createTool.handler(
          { list: 'Findings', tasks: [{ name: 'ok' }, { name: 'bad', status: 'nope' }] },
          ctx,
        ),
      /not a valid status/,
    );
    assert.equal(world.tasks.length, before, 'nothing may be created when a later entry is invalid');
  });

  test('a nameless entry aborts before any write', async () => {
    const { ctx, world } = makeCtx();
    const before = world.tasks.length;
    await assert.rejects(
      () => createTool.handler({ list: 'Findings', tasks: [{ name: 'ok' }, { description: 'x' }] }, ctx),
      /has no name/,
    );
    assert.equal(world.tasks.length, before);
  });

  test('an unresolvable assignee aborts before any write', async () => {
    const { ctx, world } = makeCtx();
    await assert.rejects(
      () => createTool.handler({ list: 'Findings', tasks: [{ name: 'x', assignees: ['Ghost'] }] }, ctx),
      /No workspace member matches/,
    );
    assert.equal(world.posts.length, 0);
  });

  test('update refuses a no-op instead of pretending', async () => {
    const { ctx } = makeCtx();
    await assert.rejects(() => updateTool.handler({ ids: ['t1'] }, ctx), /Nothing to change/);
  });
});

// ---------------------------------------------------------------------- destructive gating

describe('destructive actions are gated', () => {
  test('deleting a list requires confirmation and reports a live count', async () => {
    const { ctx, world } = makeCtx();
    await assert.rejects(
      () => listsTool.handler({ action: 'delete', target: 'Findings' }, ctx),
      (err) => {
        assert.match(err.message, /permanently/);
        // The count must come from a live read, not the cached index task_count (which was 2
        // in the folder fixture and has been observed disagreeing with reality).
        assert.match(err.message, /\(2 tasks\)/);
        return true;
      },
    );
    assert.equal(world.deletes.length, 0, 'nothing may be deleted without confirm');
  });

  test('confirm: true actually deletes', async () => {
    const { ctx, world } = makeCtx();
    await listsTool.handler({ action: 'delete', target: 'Findings', confirm: true }, ctx);
    assert.equal(world.deletes.length, 1);
  });

  test('task delete goes through update with an explicit flag', async () => {
    const { ctx, world } = makeCtx();
    const out = await updateTool.handler({ ids: ['t1', 't2'], delete: true }, ctx);
    assert.match(out, /deleted 2\/2/);
    assert.deepEqual(world.deletes, ['t1', 't2']);
  });
});

// ------------------------------------------------------------------------------ misc

describe('tool ergonomics', () => {
  test('task rejects a name where an ID belongs, rather than 404ing confusingly', async () => {
    const { ctx } = makeCtx();
    await assert.rejects(
      () => taskTool.handler({ id: 'My important task' }, ctx),
      /does not look like a task ID/,
    );
  });

  test('meta reports the statuses a list accepts', async () => {
    const { ctx } = makeCtx();
    const out = await metaTool.handler({ scope: 'Findings' }, ctx);
    assert.match(out, /statuses accepted by/);
    assert.match(out, /to do/);
    assert.match(out, /done/);
  });

  test('tree lists paths an agent can paste straight back in', async () => {
    const { ctx } = makeCtx();
    const out = await treeTool.handler({}, ctx);
    assert.match(out, /Engineering\/Cavalry\/Findings/);
  });

  test('an empty result is phrased as empty, not as an error', async () => {
    const { ctx } = makeCtx({ tasks: [] });
    const out = await findTool.handler({ scope: 'Findings' }, ctx);
    assert.match(out, /no tasks matched/);
  });
});
