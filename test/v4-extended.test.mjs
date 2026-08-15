/**
 * The long-tail tools: goals, chat, webhooks, attach, checklist, people — plus the params
 * folded into find/update/lists.
 *
 * The membership write paths are tested ONLY here, against stubs. They consume billable seats
 * and change a real person's access, so they are never exercised against the live API.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildContext } from '../build/v4/server.js';
import { updateTool, findTool } from '../build/v4/tools/tasks.js';
import {
  goalsTool,
  chatTool,
  webhooksTool,
  attachTool,
  checklistTool,
  peopleTool,
} from '../build/v4/tools/extended.js';
import { shapeTask } from '../build/v4/core/format.js';
import { ClickUpToolError } from '../build/v4/core/errors.js';

const WS = '9001';

function makeCtx(over = {}) {
  const world = {
    posts: [],
    puts: [],
    deletes: [],
    goals: over.goals ?? [],
    channels: over.channels ?? [{ id: 'ch1', name: 'General' }, { id: 'ch2', name: 'Random' }],
    checklists: over.checklists ?? [],
    seats: { members: { filled_members_seats: 1, total_member_seats: 5, empty_member_seats: 4 },
             guests: { filled_guest_seats: 0, total_guest_seats: 10, empty_guest_seats: 10 } },
    uploads: [],
  };

  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/api\/v[23]/, '');
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const rec = { p, body, search: u.search };
    if (method === 'POST') world.posts.push(rec);
    if (method === 'PUT') world.puts.push(rec);
    if (method === 'DELETE') world.deletes.push(rec);

    const j = (b, s = 200) =>
      new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

    if (p === '/team') {
      return j({ teams: [{ id: WS, name: 'Acme', members: [
        { user: { id: 1, username: 'Ben', email: 'ben@example.com' } },
        { user: { id: 2, username: 'Sam', email: 'sam@example.com' } },
      ] }] });
    }
    if (p === `/team/${WS}/space`) return j({ spaces: [{ id: '900100000001', name: 'Eng' }] });
    if (p === `/team/${WS}/folder`) {
      return j({ folders: [{ id: '900200000001', name: 'F', space: { id: '900100000001', name: 'Eng' },
        lists: [{ id: '901400000001', name: 'Findings', task_count: 1, statuses: [{ status: 'to do' }] }] }] });
    }
    if (/^\/space\/\d+\/list$/.test(p)) return j({ lists: [] });
    if (p === '/user') return j({ user: { id: 1, username: 'Ben', email: 'ben@example.com' } });
    if (p === `/team/${WS}/seats`) return j(world.seats);
    if (p === '/group') return j({ groups: [] });
    if (new RegExp(`^/team/${WS}/(user|guest)(/.*)?$`).test(p)) return j({ team: { id: WS } });
    if (/^\/guest\//.test(p)) return j({});
    if (p === `/team/${WS}/goal`) {
      if (method === 'POST') return j({ goal: { id: 'g-new', name: body.name } });
      return j({ goals: world.goals, folders: [] });
    }
    if (/^\/goal\/[\w-]+$/.test(p)) {
      if (method === 'GET') return j({ goal: world.goals.find((g) => p.endsWith(g.id)) ?? {} });
      return j({});
    }
    if (/^\/goal\/[\w-]+\/key_result$/.test(p)) return j({ key_result: { id: 'kr1' } });
    if (p === `/workspaces/${WS}/chat/channels`) return j({ data: world.channels });
    if (/^\/workspaces\/.+\/messages$/.test(p)) return j({ data: [] });
    if (p === `/team/${WS}/webhook`) {
      if (method === 'POST') return j({ id: 'wh1' });
      return j({ webhooks: [] });
    }
    if (/^\/task\/\w+$/.test(p)) {
      return j({ id: 't1', name: 'T', status: { status: 'to do' }, assignees: [], tags: [],
                 list: { id: '901400000001', name: 'Findings' }, checklists: world.checklists });
    }
    if (/^\/task\/\w+\/attachment$/.test(p)) { world.uploads.push(rec); return j({ id: 'att1' }); }
    if (/^\/task\/\w+\/checklist$/.test(p)) return j({ checklist: { id: 'cl-new' } });
    if (/^\/checklist\//.test(p)) return j({});
    if (/^\/task\/\w+\/(tag|dependency|link)/.test(p)) return j({});
    return j({ err: 'not stubbed: ' + method + ' ' + p, ECODE: 'TEST_000' }, 404);
  };

  return { ctx: buildContext({ token: 'pk', workspaceId: WS, fetchImpl }), world };
}

// ------------------------------------------------------------------ people (billing safety)

describe('people: membership writes are gated', () => {
  const MUTATING = ['invite', 'remove', 'set_admin', 'guest_invite', 'guest_remove', 'guest_grant', 'guest_revoke'];

  for (const action of MUTATING) {
    test(`${action} refuses without confirm, and writes nothing`, async () => {
      const { ctx, world } = makeCtx();
      await assert.rejects(
        () => peopleTool.handler({ action, email: 'a@b.com', who: 'Sam', target: 'Findings' }, ctx),
        (err) => {
          assert.ok(err instanceof ClickUpToolError);
          assert.match(err.message, /changes who can access this workspace/);
          return true;
        },
      );
      assert.equal(world.posts.length + world.puts.length + world.deletes.length, 0,
        `${action} must not write anything before confirmation`);
    });
  }

  test('the refusal reports current seat usage, so the cost is visible', async () => {
    const { ctx } = makeCtx();
    await assert.rejects(
      () => peopleTool.handler({ action: 'invite', email: 'a@b.com' }, ctx),
      (err) => {
        assert.match(err.message, /1\/5 member seats/);
        assert.match(err.message, /0\/10 guest seats/);
        return true;
      },
    );
  });

  test('read-only actions need no confirmation', async () => {
    const { ctx, world } = makeCtx();
    assert.match(await peopleTool.handler({ action: 'seats' }, ctx), /member seats: 1 used of 5/);
    assert.match(await peopleTool.handler({ action: 'list' }, ctx), /Ben/);
    assert.match(await peopleTool.handler({ action: 'groups' }, ctx), /no user groups/);
    assert.equal(world.posts.length + world.puts.length + world.deletes.length, 0);
  });

  test('with confirm, invite hits the right endpoint', async () => {
    const { ctx, world } = makeCtx();
    const out = await peopleTool.handler({ action: 'invite', email: 'new@example.com', confirm: true }, ctx);
    assert.match(out, /consumes a member seat/);
    assert.equal(world.posts[0].p, `/team/${WS}/user`);
    assert.equal(world.posts[0].body.email, 'new@example.com');
  });

  test('an invalid email is rejected before any call', async () => {
    const { ctx, world } = makeCtx();
    await assert.rejects(
      () => peopleTool.handler({ action: 'invite', email: 'not-an-email', confirm: true }, ctx),
      /not a valid email/,
    );
    assert.equal(world.posts.length, 0);
  });

  test('removing a member warns that their work is orphaned', async () => {
    const { ctx } = makeCtx();
    const out = await peopleTool.handler({ action: 'remove', who: 'Sam', confirm: true }, ctx);
    assert.match(out, /now unassigned/);
  });
});

// ----------------------------------------------------------------- dependency direction

describe('dependency direction (regression — type is always 1)', () => {
  test('task_id/depends_on decides direction, not `type`', () => {
    // Verified live: both {depends_on:X} and {dependency_of:X} come back with type === 1.
    // Keying off `type` labelled every edge "blocking" and inverted half of them.
    const shaped = shapeTask({
      id: 'A',
      name: 'A',
      status: { status: 'to do' },
      dependencies: [
        { task_id: 'A', depends_on: 'B', type: 1 }, // A waits on B
        { task_id: 'C', depends_on: 'A', type: 1 }, // C waits on A, so A blocks C
      ],
    }, 'full');
    assert.deepEqual(shaped.waitingOn, ['B']);
    assert.deepEqual(shaped.blocking, ['C']);
  });
});

// ------------------------------------------------------------------- folded relations

describe('update: folded relations', () => {
  test('waits_on and blocks send different keys', async () => {
    const { ctx, world } = makeCtx();
    await updateTool.handler({ ids: ['t1'], waits_on: ['B'], blocks: ['C'] }, ctx);
    const deps = world.posts.filter((r) => r.p.endsWith('/dependency'));
    assert.equal(deps.length, 2);
    assert.deepEqual(deps[0].body, { depends_on: 'B' });
    assert.deepEqual(deps[1].body, { dependency_of: 'C' });
  });

  test('tags add and remove hit tag endpoints', async () => {
    const { ctx, world } = makeCtx();
    await updateTool.handler({ ids: ['t1'], tags_add: ['red'], tags_remove: ['blue'] }, ctx);
    assert.ok(world.posts.some((r) => r.p === '/task/t1/tag/red'));
    assert.ok(world.deletes.some((r) => r.p === '/task/t1/tag/blue'));
  });

  test('links are separate from dependencies', async () => {
    const { ctx, world } = makeCtx();
    await updateTool.handler({ ids: ['t1'], link_to: ['X'] }, ctx);
    assert.ok(world.posts.some((r) => r.p === '/task/t1/link/X'));
    assert.ok(!world.posts.some((r) => r.p.endsWith('/dependency')));
  });

  test('relations alone are enough — no "nothing to change"', async () => {
    const { ctx } = makeCtx();
    await assert.doesNotReject(() => updateTool.handler({ ids: ['t1'], tags_add: ['x'] }, ctx));
  });

  test('the row shown is re-read after relation writes', async () => {
    // The PUT response predates the tag write, so rendering it would show the tag you just
    // removed still attached — reading as a failed write.
    const { ctx, world } = makeCtx();
    await updateTool.handler({ ids: ['t1'], tags_add: ['red'] }, ctx);
    const reads = world.posts.filter((r) => r.p === '/task/t1/tag/red');
    assert.equal(reads.length, 1, 'tag write happened');
  });
});

describe('find: views are a separate query path', () => {
  test('combining a view with filters is refused, not silently resolved', async () => {
    const { ctx } = makeCtx();
    await assert.rejects(
      () => findTool.handler({ view: 'My View', status: ['to do'] }, ctx),
      (err) => {
        assert.match(err.message, /already defines its own filters/);
        assert.match(err.fix, /looks filtered but is not/);
        return true;
      },
    );
  });
});

// ------------------------------------------------------------------------- long tail

describe('goals', () => {
  test('an unknown goal name raises with candidates', async () => {
    const { ctx } = makeCtx({ goals: [{ id: 'g1', name: 'Ship v4' }] });
    await assert.rejects(() => goalsTool.handler({ action: 'get', goal: 'Nope' }, ctx), /No goal matches/);
  });

  test('an ambiguous goal name raises rather than picking', async () => {
    const { ctx } = makeCtx({ goals: [{ id: 'g1', name: 'Ship' }, { id: 'g2', name: 'Ship' }] });
    await assert.rejects(() => goalsTool.handler({ action: 'get', goal: 'Ship' }, ctx), /matches 2 goals/);
  });

  test('delete requires confirmation', async () => {
    const { ctx, world } = makeCtx({ goals: [{ id: 'g1', name: 'Ship v4' }] });
    await assert.rejects(
      () => goalsTool.handler({ action: 'delete', goal: 'Ship v4' }, ctx),
      /destroys its key results/,
    );
    assert.equal(world.deletes.length, 0);
  });

  test('create posts key results too', async () => {
    const { ctx, world } = makeCtx();
    const out = await goalsTool.handler(
      { action: 'create', name: 'G', key_results: [{ name: 'kr', target: 3 }] }, ctx);
    assert.match(out, /added 1 key result/);
    assert.ok(world.posts.some((r) => r.p.endsWith('/key_result')));
  });
});

describe('chat', () => {
  test('posting an empty message is refused', async () => {
    const { ctx } = makeCtx();
    await assert.rejects(
      () => chatTool.handler({ action: 'post', channel: 'General', text: '  ' }, ctx),
      /No message text/,
    );
  });

  test('an unknown channel raises with candidates', async () => {
    const { ctx } = makeCtx();
    await assert.rejects(() => chatTool.handler({ action: 'read', channel: 'Nope' }, ctx), /No channel matches/);
  });
});

describe('webhooks', () => {
  test('a non-HTTPS endpoint is rejected before any call', async () => {
    const { ctx, world } = makeCtx();
    await assert.rejects(
      () => webhooksTool.handler({ action: 'create', endpoint: 'http://insecure.example' }, ctx),
      /not an HTTPS URL/,
    );
    assert.equal(world.posts.length, 0);
  });

  test('delete requires confirmation', async () => {
    const { ctx, world } = makeCtx();
    await assert.rejects(() => webhooksTool.handler({ action: 'delete', id: 'wh1' }, ctx), /stops all deliveries/);
    assert.equal(world.deletes.length, 0);
  });
});

describe('attach', () => {
  test('a missing file raises before any upload', async () => {
    const { ctx, world } = makeCtx();
    await assert.rejects(
      () => attachTool.handler({ task: 't1', file_path: '/definitely/not/here.txt' }, ctx),
      /Could not read/,
    );
    assert.equal(world.uploads.length, 0);
  });

  test('the description does not promise a listing ClickUp cannot do', () => {
    // GET /task/{id}/attachment is 405 — there is no list endpoint.
    assert.match(attachTool.description, /no endpoint that lists them/);
  });
});

describe('checklist', () => {
  test('a task with no checklists says so instead of erroring obscurely', async () => {
    const { ctx } = makeCtx({ checklists: [] });
    assert.match(await checklistTool.handler({ task: 't1', action: 'list' }, ctx), /no checklists/);
  });

  test('an ambiguous checklist name raises', async () => {
    const { ctx } = makeCtx({ checklists: [
      { id: 'c1', name: 'Steps A', items: [] },
      { id: 'c2', name: 'Steps B', items: [] },
    ] });
    await assert.rejects(
      () => checklistTool.handler({ task: 't1', action: 'add_item', checklist: 'Steps', item: 'x' }, ctx),
      /matches 2 checklists/,
    );
  });

  test('an unknown item lists what is actually there', async () => {
    const { ctx } = makeCtx({ checklists: [
      { id: 'c1', name: 'Steps', items: [{ id: 'i1', name: 'real item', resolved: false }] },
    ] });
    await assert.rejects(
      () => checklistTool.handler({ task: 't1', action: 'check', checklist: 'Steps', item: 'ghost' }, ctx),
      /No checklist item matches/,
    );
  });
});
