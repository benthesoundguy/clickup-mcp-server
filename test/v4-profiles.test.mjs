/**
 * Capability profiles.
 *
 * The claim being defended is: **under `agent`, nothing that already exists can be altered or
 * destroyed.** That is a claim about the HTTP chokepoint, not about which tools are registered
 * — so the central test here calls `core`-only handlers *directly* with an `agent` context,
 * bypassing the tool filter entirely, and asserts the request still never leaves.
 *
 * If that test passes, the guarantee survives a mistagged tool, a refactor, or a new endpoint
 * added by someone who never read profiles.ts.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildContext, allTools } from '../build/v4/server.js';
import { toolsFor, TOOL_PROFILES } from '../build/v4/tools/profiles.js';
import {
  POLICIES,
  checkPolicy,
  pattern,
  matches,
  parseProfile,
  PROFILES,
} from '../build/v4/core/policy.js';
import { updateTool, createTool, findTool } from '../build/v4/tools/tasks.js';
import { listsTool } from '../build/v4/tools/structure.js';
import { peopleTool, webhooksTool, checklistTool, goalsTool } from '../build/v4/tools/extended.js';
import { commentTool, timeTool, fieldsTool } from '../build/v4/tools/extras.js';
import { ClickUpToolError } from '../build/v4/core/errors.js';

const WS = '9001';

/** Records every request that actually reached the wire. */
function makeCtx(profile) {
  const sent = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/api\/v[23]/, '');
    sent.push({ method: init.method ?? 'GET', path: p });
    const j = (b, s = 200) =>
      new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

    if (p === '/team') return j({ teams: [{ id: WS, name: 'A', members: [{ user: { id: 1, username: 'Ben', email: 'b@e.com' } }] }] });
    if (p === `/team/${WS}/space`) return j({ spaces: [{ id: '900100000001', name: 'Eng' }] });
    if (p === `/team/${WS}/folder`) {
      return j({ folders: [{ id: '900200000001', name: 'F', space: { id: '900100000001', name: 'Eng' },
        lists: [{ id: '901400000001', name: 'Findings', task_count: 1, statuses: [{ status: 'to do' }] }] }] });
    }
    if (/^\/space\/\d+\/list$/.test(p)) return j({ lists: [] });
    if (p === '/user') return j({ user: { id: 1, username: 'Ben', email: 'b@e.com' } });
    if (/^\/task\/\w+$/.test(p)) {
      return j({ id: 't1', name: 'T', status: { status: 'to do' }, assignees: [], tags: [],
                 list: { id: '901400000001', name: 'Findings' }, checklists: [{ id: 'c1', name: 'CL', items: [{ id: 'i1', name: 'x' }] }] });
    }
    if (/^\/list\/\d+\/task$/.test(p)) {
      return j({ id: 'new1', name: 'a finding', status: { status: 'to do' }, assignees: [], tags: [] });
    }
    return j({});
  };
  const ctx = buildContext({ token: 'pk', workspaceId: WS, profile, fetchImpl });
  return { ctx, sent, writes: () => sent.filter((r) => r.method !== 'GET') };
}

// ----------------------------------------------------------------- pattern matching

describe('policy: matching is segment-exact', () => {
  test('create and move are distinguished by segment count', () => {
    // POST /list/{id}/task       = create   (append)
    // POST /list/{id}/task/{id}  = MOVE     (mutation)
    // A prefix match would grant the second while intending only the first.
    const create = pattern('POST /list/*/task');
    assert.ok(matches(create, 'POST', '/list/123/task'));
    assert.ok(!matches(create, 'POST', '/list/123/task/abc'),
      'the move endpoint must NOT match the create pattern');
  });

  test('a wildcard matches exactly one segment', () => {
    const p = pattern('POST /task/*/comment');
    assert.ok(matches(p, 'POST', '/task/abc/comment'));
    assert.ok(!matches(p, 'POST', '/task/abc/def/comment'));
    assert.ok(!matches(p, 'POST', '/task/comment'));
  });

  test('method must match', () => {
    const p = pattern('POST /task/*/comment');
    assert.ok(!matches(p, 'DELETE', '/task/abc/comment'));
  });

  test('encoded separators cannot smuggle a denied path past an allowlist', () => {
    // `/list/1%2Ftask%2Fvictim/task` reads as 3 segments to us and possibly 5 at the origin.
    // When the two readings can differ, the safe answer is no. This ALLOWed before the fix.
    assert.ok(checkPolicy(POLICIES.agent, 'POST', '/list/1%2Ftask%2Fvictim/task'));
    assert.equal(checkPolicy(POLICIES.agent, 'POST', '/list/1/task'), null, 'plain create still works');
  });

  test('encoded separators cannot evade a denylist either', () => {
    assert.ok(checkPolicy(POLICIES.core, 'POST', '/team/9001%2Fuser'),
      'deny rules are tested against the decoded form too');
  });

  test('a legitimately encoded value is still allowed where the profile permits writes', () => {
    // A tag literally named "a/b" arrives as a%2Fb. `core` allows writes broadly, so this must
    // not be collateral damage from the anti-smuggling rule.
    assert.equal(checkPolicy(POLICIES.core, 'POST', '/task/x/tag/a%2Fb'), null);
  });

  test('query strings never affect the decision', () => {
    assert.equal(checkPolicy(POLICIES.read, 'GET', '/team/9001/task'), null);
    assert.ok(checkPolicy(POLICIES.read, 'POST', '/list/1/task?foo=bar'));
  });
});

// ------------------------------------------------------------------- read profile

describe('policy: read', () => {
  test('permits every GET', () => {
    for (const p of ['/team', '/task/x', '/team/9001/task', '/workspaces/9001/docs']) {
      assert.equal(checkPolicy(POLICIES.read, 'GET', p), null, p);
    }
  });

  test('permits no write of any kind', () => {
    const attempts = [
      ['POST', '/list/1/task'], ['POST', '/task/1/comment'], ['PUT', '/task/1'],
      ['DELETE', '/task/1'], ['UPLOAD', '/task/1/attachment'],
      ['POST', '/workspaces/9001/chat/channels/c/messages'],
    ];
    for (const [m, p] of attempts) {
      const err = checkPolicy(POLICIES.read, m, p);
      assert.ok(err instanceof ClickUpToolError, `${m} ${p} should be blocked`);
      assert.match(err.message, /read-only/);
    }
  });
});

// ------------------------------------------------------------------ agent profile

describe('policy: agent is append-only', () => {
  const ALLOWED = [
    ['POST', '/list/901400000001/task', 'create a task'],
    ['POST', '/task/t1/comment', 'add a comment'],
    ['POST', '/task/t1/checklist', 'add a checklist'],
    ['POST', '/checklist/c1/checklist_item', 'add an item'],
    ['POST', '/team/9001/time_entries', 'log time'],
    ['POST', '/workspaces/9001/chat/channels/c1/messages', 'post a message'],
    ['UPLOAD', '/task/t1/attachment', 'upload a file'],
  ];

  for (const [m, p, what] of ALLOWED) {
    test(`allows ${what}`, () => {
      assert.equal(checkPolicy(POLICIES.agent, m, p), null, `${m} ${p}`);
    });
  }

  const BLOCKED = [
    ['PUT', '/task/t1', 'edit a task'],
    ['DELETE', '/task/t1', 'delete a task'],
    ['POST', '/list/1/task/t1', 'MOVE a task (looks like create)'],
    ['POST', '/task/t1/tag/urgent', 'tag an existing task'],
    ['POST', '/task/t1/dependency', 'rewrite a dependency'],
    ['POST', '/task/t1/link/t2', 'link two tasks'],
    ['POST', '/task/t1/field/f1', 'set a custom field'],
    ['POST', '/space/1/list', 'create a list'],
    ['POST', '/space/1/folder', 'create a folder'],
    ['POST', '/folder/1/list', 'create a list in a folder'],
    ['DELETE', '/list/1', 'delete a list'],
    ['POST', '/team/9001/goal', 'create a goal'],
    ['POST', '/team/9001/user', 'invite a user'],
    ['POST', '/team/9001/guest', 'invite a guest'],
    ['POST', '/guest/g1/list/l1', 'grant guest access'],
    ['POST', '/team/9001/webhook', 'create a webhook'],
    ['POST', '/team/9001/time_entries/start', 'start a timer'],
    ['POST', '/team/9001/time_entries/stop', 'stop a timer'],
    ['PUT', '/checklist/c1/checklist_item/i1', 'check an item'],
    ['DELETE', '/checklist/c1', 'delete a checklist'],
  ];

  for (const [m, p, what] of BLOCKED) {
    test(`blocks ${what}`, () => {
      const err = checkPolicy(POLICIES.agent, m, p);
      assert.ok(err instanceof ClickUpToolError, `${m} ${p} must be blocked`);
      assert.match(err.message, /only ADD new objects/);
    });
  }

  test('reads are unrestricted', () => {
    assert.equal(checkPolicy(POLICIES.agent, 'GET', '/team/9001/task'), null);
    assert.equal(checkPolicy(POLICIES.agent, 'GET', '/team/9001/seats'), null);
  });
});

// ------------------------------------------------------------------- core profile

describe('policy: core excludes administration', () => {
  test('allows ordinary mutation', () => {
    for (const [m, p] of [['PUT', '/task/t1'], ['DELETE', '/task/t1'], ['POST', '/space/1/list']]) {
      assert.equal(checkPolicy(POLICIES.core, m, p), null, `${m} ${p}`);
    }
  });

  test('blocks membership and webhook administration, reads included', () => {
    const blocked = [
      ['POST', '/team/9001/user'], ['DELETE', '/team/9001/user/2'], ['PUT', '/team/9001/user/2'],
      ['POST', '/team/9001/guest'], ['DELETE', '/guest/g/list/l'],
      ['POST', '/team/9001/webhook'], ['DELETE', '/webhook/w1'],
      ['GET', '/team/9001/seats'], ['GET', '/group'],
    ];
    for (const [m, p] of blocked) {
      assert.ok(checkPolicy(POLICIES.core, m, p), `${m} ${p} must be blocked under core`);
    }
  });
});

describe('policy: full is unrestricted', () => {
  test('permits everything the other profiles block', () => {
    for (const [m, p] of [['DELETE', '/team/9001/user/2'], ['POST', '/team/9001/webhook'], ['DELETE', '/list/1']]) {
      assert.equal(checkPolicy(POLICIES.full, m, p), null, `${m} ${p}`);
    }
  });
});

// ============================================================================
// THE LOAD-BEARING TEST
// ============================================================================

describe('the guarantee survives the tool filter being bypassed', () => {
  /**
   * Every one of these handlers is absent from the `agent` tool list. Calling them directly
   * simulates the failure that matters: a tool mistagged in profiles.ts, or a new one added
   * without tagging. The chokepoint must stop them regardless.
   */
  const ESCAPES = [
    ['update a task', (c) => updateTool.handler({ ids: ['t1'], status: 'done' }, c)],
    ['delete tasks', (c) => updateTool.handler({ ids: ['t1'], delete: true }, c)],
    ['move a task', (c) => updateTool.handler({ ids: ['t1'], move_to: 'Findings' }, c)],
    ['tag a task', (c) => updateTool.handler({ ids: ['t1'], tags_add: ['x'] }, c)],
    ['delete a list', (c) => listsTool.handler({ action: 'delete', target: 'Findings', confirm: true }, c)],
    ['create a list', (c) => listsTool.handler({ action: 'create', name: 'X', parent: 'Eng' }, c)],
    ['invite a member', (c) => peopleTool.handler({ action: 'invite', email: 'a@b.com', confirm: true }, c)],
    ['remove a member', (c) => peopleTool.handler({ action: 'remove', who: 'Ben', confirm: true }, c)],
    ['create a webhook', (c) => webhooksTool.handler({ action: 'create', endpoint: 'https://x.example' }, c)],
    ['create a goal', (c) => goalsTool.handler({ action: 'create', name: 'G' }, c)],
    ['check a checklist item', (c) => checklistTool.handler({ task: 't1', action: 'check', checklist: 'CL', item: 'x' }, c)],
    ['set a custom field', (c) => fieldsTool.handler({ task: 't1', field: 'f', value: 'v' }, c)],
    ['start a timer', (c) => timeTool.handler({ action: 'start', task: 't1' }, c)],
  ];

  for (const [what, run] of ESCAPES) {
    test(`agent cannot ${what}, even calling the handler directly`, async () => {
      const { ctx, writes } = makeCtx('agent');
      let threw = null;
      try {
        await run(ctx);
      } catch (err) {
        threw = err;
      }
      assert.ok(threw, `${what} should have been refused, but it succeeded`);
      assert.equal(writes().length, 0, `${what} must not have reached the wire: ${JSON.stringify(writes())}`);
    });
  }

  test('read cannot even append', async () => {
    const { ctx, writes } = makeCtx('read');
    await assert.rejects(() => createTool.handler({ list: 'Findings', tasks: [{ name: 'x' }] }, ctx));
    assert.equal(writes().length, 0);
  });

  test('agent CAN do the things it is meant to', async () => {
    const { ctx, writes } = makeCtx('agent');
    await createTool.handler({ list: 'Findings', tasks: [{ name: 'a finding' }] }, ctx);
    await commentTool.handler({ task: 't1', text: 'a note' }, ctx);
    const paths = writes().map((w) => w.path);
    assert.ok(paths.includes('/list/901400000001/task'), 'task creation must work');
    assert.ok(paths.includes('/task/t1/comment'), 'commenting must work');
  });

  test('agent reads are unimpeded', async () => {
    const { ctx } = makeCtx('agent');
    await assert.doesNotReject(() => findTool.handler({ scope: 'Findings' }, ctx));
  });
});

// ------------------------------------------------------------------ table consistency

describe('profiles table', () => {
  test('every registered tool is tagged', () => {
    for (const t of allTools) {
      assert.ok(TOOL_PROFILES[t.name], `${t.name} is missing from TOOL_PROFILES — it would be full-only`);
    }
  });

  test('an untagged tool fails closed', () => {
    const fake = { name: 'ghost', description: 'x', schema: {}, handler: async () => '' };
    for (const p of ['read', 'agent', 'core']) {
      assert.equal(toolsFor([fake], p, (t) => t).length, 0, `untagged tool leaked into ${p}`);
    }
    assert.equal(toolsFor([fake], 'full', (t) => t).length, 1);
  });

  test('profiles are strictly nested', () => {
    let prev = 0;
    for (const p of PROFILES) {
      const n = toolsFor(allTools, p, (t) => t).length;
      assert.ok(n >= prev, `${p} exposes fewer tools than the profile below it`);
      prev = n;
    }
  });

  test('parseProfile rejects nonsense rather than defaulting silently', () => {
    assert.equal(parseProfile(undefined), 'full');
    assert.equal(parseProfile('agent'), 'agent');
    assert.throws(() => parseProfile('admin'), /not valid/);
  });
});
