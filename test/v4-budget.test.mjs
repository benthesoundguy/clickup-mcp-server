/**
 * Budget tests — the goals from V4-PLAN.md, enforced as regression guards.
 *
 * Context cost is the whole reason v4 exists, so it is asserted rather than admired. These
 * numbers will drift upward the first time someone adds a tool without thinking about it,
 * and this file is what stops that.
 *
 * Token estimates use bytes/3.6, the same ratio used for every measurement in the plan.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildServer, allTools } from '../build/v4/server.js';
import { shapeTask, renderTaskTable } from '../build/v4/core/format.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BYTES_PER_TOKEN = 3.6;
const tokens = (bytes) => Math.round(bytes / BYTES_PER_TOKEN);

// Baselines measured on 2026-08-15. See V4-PLAN.md.
const V3_SCHEMA_TOKENS = 18_603; // real tools/list off the v3 server
// v3's tasks_list DEFAULTS to a shaped ("lean") response; this is that default, which is the
// honest thing to compare against. The raw API — and v3's opt-in detail:"full" — is 42,619.
const V3_LIST_TOKENS = 4_063;
const RAW_API_LIST_TOKENS = 42_619;

// Goal ceilings.
//
// G1 was 4,000 and G3 was 14 while v4 covered only the core. Closing the coverage gap against
// v3 (goals, chat, webhooks, attachments, checklists, membership admin, plus views/deps/links/
// tags/templates folded into existing tools) put the real figure at ~4,740 over 18 tools.
//
// Raised deliberately rather than met by trimming descriptions: thin descriptions cost tool
// selection accuracy, which is worth far more than a few hundred tokens. 5,000 leaves modest
// headroom and is still 73% below v3's 18,603 for strictly more capability.
const G1_MAX_SCHEMA_TOKENS = 5_000;
const G2_MAX_LIST_TOKENS = 1_500;
const G3_MAX_TOOLS = 18;

async function listTools() {
  // A real tools/list over an in-memory transport, so this measures what a client actually
  // receives — not what we think the schemas serialise to.
  // Explicitly `full`: the budget ceilings are about the widest surface a client can be
  // handed, not about whatever the default profile happens to be today.
  const { server } = buildServer({ token: 'pk_offline_test', profile: 'full' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'budget', version: '1' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const res = await client.listTools();
  await client.close();
  return res.tools;
}

describe('G1 — tool schema surface', () => {
  test(`fits in ${G1_MAX_SCHEMA_TOKENS} tokens`, async () => {
    const tools = await listTools();
    const wire = JSON.stringify(tools);
    const t = tokens(wire.length);
    assert.ok(
      t <= G1_MAX_SCHEMA_TOKENS,
      `tool schemas are ${t} tokens (${wire.length} bytes), budget is ${G1_MAX_SCHEMA_TOKENS}. ` +
        `This is paid on every single request — if a new tool pushed it over, shrink a ` +
        `description or fold the tool into an existing one.`,
    );
    console.log(
      `      G1: ${tools.length} tools, ${wire.length} B, ~${t} tok ` +
        `(v3 was ${V3_SCHEMA_TOKENS} tok → ${(100 * (1 - t / V3_SCHEMA_TOKENS)).toFixed(1)}% smaller)`,
    );
  });

  test(`is at most ${G3_MAX_TOOLS} tools`, async () => {
    const tools = await listTools();
    assert.ok(tools.length <= G3_MAX_TOOLS, `${tools.length} tools, budget ${G3_MAX_TOOLS}`);
    assert.equal(tools.length, allTools.length, 'registry and wire must agree');
  });

  test('every tool has a description that says when to use it', async () => {
    for (const t of await listTools()) {
      assert.ok(t.description, `${t.name} has no description`);
      assert.ok(
        t.description.length >= 40,
        `${t.name} description is too thin to guide selection: ${t.description}`,
      );
    }
  });

  test('no tool requires an ID the agent cannot know', async () => {
    // v3 made `workspace_id` a required argument on `spaces`, which an agent has no way to
    // supply without another call. Nothing in v4 may require an opaque identifier.
    for (const t of await listTools()) {
      const required = t.inputSchema?.required ?? [];
      for (const r of required) {
        assert.ok(
          !/^(workspace|team)_id$/.test(r),
          `${t.name} requires ${r}, which the agent cannot know — resolve it server-side`,
        );
      }
    }
  });
});

describe('G2 — response size', () => {
  const raw = JSON.parse(readFileSync(join(HERE, 'fixtures', 'tasks-100.json'), 'utf8'));

  test('the fixture is the real thing', () => {
    assert.equal(raw.tasks.length, 100);
    // Confirms the baseline this is measured against is genuine, not a strawman.
    const rawTokens = tokens(JSON.stringify(raw).length);
    assert.ok(rawTokens > 35_000, `fixture is only ${rawTokens} tokens; expected ~${RAW_API_LIST_TOKENS}`);
  });

  test(`100 tasks render in under ${G2_MAX_LIST_TOKENS} tokens`, () => {
    const shaped = raw.tasks.map((t) => shapeTask(t, 'compact'));
    const table = renderTaskTable(shaped, {
      header: 'agent_test/Folder/List — 100 matches',
      hideColumns: ['list'],
    });
    const t = tokens(table.length);
    assert.ok(
      t <= G2_MAX_LIST_TOKENS,
      `100 tasks rendered to ${t} tokens (${table.length} bytes), budget ${G2_MAX_LIST_TOKENS}`,
    );
    console.log(
      `      G2: ${table.length} B, ~${t} tok ` +
        `(raw was ${V3_LIST_TOKENS} tok → ${(100 * (1 - t / V3_LIST_TOKENS)).toFixed(1)}% smaller)`,
    );
  });

  test('every row still carries what an agent needs to act', () => {
    const shaped = raw.tasks.map((t) => shapeTask(t, 'compact'));
    for (const s of shaped) {
      assert.ok(s.id, 'an id is required to do anything downstream');
      assert.ok(typeof s.name === 'string');
      assert.ok(typeof s.status === 'string');
    }
  });

  test('the shaped form drops the known-useless fields', () => {
    const shaped = raw.tasks.map((t) => shapeTask(t, 'compact'));
    const serialised = JSON.stringify(shaped);
    for (const noise of ['sharing', 'watchers', 'orderindex', 'permission_level', 'profilePicture']) {
      assert.ok(!serialised.includes(noise), `${noise} survived shaping`);
    }
  });

  test('a full-detail single task is still cheap', () => {
    const one = shapeTask(raw.tasks[0], 'full');
    const t = tokens(JSON.stringify(one).length);
    assert.ok(t < 400, `one full task is ${t} tokens`);
  });
});

describe('G6 — errors teach', () => {
  test('no tool returns a bare API message', async () => {
    // Every error path in the server renders through ClickUpToolError.toolMessage(), which
    // always emits a "Fix:" line. This asserts the wrapper is actually wired up.
    const { server } = buildServer({
      token: 'pk_offline_test',
      profile: 'full',
      fetchImpl: async () =>
        new Response(JSON.stringify({ err: 'Team not authorized', ECODE: 'OAUTH_027' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'budget', version: '1' }, { capabilities: {} });
    await Promise.all([server.connect(st), client.connect(ct)]);

    const res = await client.callTool({ name: 'tree', arguments: {} });
    assert.equal(res.isError, true);
    const text = res.content[0].text;
    assert.match(text, /Fix:/, `error lacked a fix: ${text}`);
    assert.ok(!/^Team not authorized/.test(text), 'raw ClickUp wording leaked through');
    await client.close();
  });
});
