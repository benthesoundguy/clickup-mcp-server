#!/usr/bin/env node
// Live smoke test: walks create→read→update→delete per domain against a real
// ClickUp workspace, exercising the COMPILED clients (build/) — the same code
// paths the MCP tools use.
//
// Sandbox strategy: everything writable happens inside a folder named
// "MCP-Smoke-<timestamp>" created in the first space, which is deleted at the
// end (cascade removes lists/tasks/views/docs inside). Workspace-level
// artifacts (tag, goal, chat channel) are individually deleted.
//
// Deliberately skipped (would affect real people/state):
//   - users/guests invite, webhook create (needs a public URL)
//   - timer start/stop (could kill an in-flight timer)
//   - reminders_create (API cannot delete reminders — verified create-only)
//
// Usage: CLICKUP_API_TOKEN=... node test/smoke.mjs   (or npm run smoke)

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Token: env first, then .env in repo root or its parent
if (!process.env.CLICKUP_API_TOKEN) {
  for (const p of [resolve(here, '../.env'), resolve(here, '../../.env')]) {
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf-8').match(/CLICKUP_API_TOKEN\s*=\s*(\S+)/);
      if (m) { process.env.CLICKUP_API_TOKEN = m[1]; break; }
    }
  }
}
if (!process.env.CLICKUP_API_TOKEN) {
  console.error('CLICKUP_API_TOKEN not set and no .env found — aborting.');
  process.exit(1);
}

const { createClickUpClient, getAllPages } = await import('../build/clickup-client/index.js');
const { createAuthClient } = await import('../build/clickup-client/auth.js');
const { createSpacesClient } = await import('../build/clickup-client/spaces.js');
const { createFoldersClient } = await import('../build/clickup-client/folders.js');
const { createListsClient } = await import('../build/clickup-client/lists.js');
const { createTasksClient } = await import('../build/clickup-client/tasks.js');
const { createCommentsClient } = await import('../build/clickup-client/comments.js');
const { createChecklistsClient } = await import('../build/clickup-client/checklists.js');
const { createDependenciesClient } = await import('../build/clickup-client/dependencies.js');
const { createTagsClient } = await import('../build/clickup-client/tags.js');
const { createCustomFieldsClient } = await import('../build/clickup-client/custom-fields.js');
const { createViewsClient } = await import('../build/clickup-client/views.js');
const { createTimeTrackingClient } = await import('../build/clickup-client/time-tracking.js');
const { createDocsClient } = await import('../build/clickup-client/docs.js');
const { createGoalsClient } = await import('../build/clickup-client/goals.js');
const { createGroupsClient } = await import('../build/clickup-client/groups.js');
const { createTemplatesClient } = await import('../build/clickup-client/templates.js');
const { createUsersClient } = await import('../build/clickup-client/users.js');
const { createWebhooksClient } = await import('../build/clickup-client/webhooks.js');
const { createChatClient } = await import('../build/clickup-client/chat.js');
const { createAttachmentsClient } = await import('../build/clickup-client/attachments.js');
const { createProjectIntelligenceClient } = await import('../build/clickup-client/project-intelligence.js');

const client = createClickUpClient();
const auth = createAuthClient(client);
const spaces = createSpacesClient(client);
const folders = createFoldersClient(client);
const lists = createListsClient(client);
const tasks = createTasksClient(client);
const comments = createCommentsClient(client);
const checklists = createChecklistsClient(client);
const deps = createDependenciesClient(client);
const tags = createTagsClient(client);
const fields = createCustomFieldsClient(client);
const views = createViewsClient(client);
const time = createTimeTrackingClient(client);
const docs = createDocsClient(client);
const goals = createGoalsClient(client);
const groups = createGroupsClient(client);
const templates = createTemplatesClient(client);
const users = createUsersClient(client);
const webhooks = createWebhooksClient(client);
const chat = createChatClient(client);
const attachments = createAttachmentsClient(client);
const pi = createProjectIntelligenceClient();

const results = [];
const pause = (ms = 250) => new Promise(r => setTimeout(r, ms));

async function step(name, fn) {
  await pause();
  try {
    const out = await fn();
    results.push({ name, ok: true });
    process.stdout.write(`  ✔ ${name}\n`);
    return out;
  } catch (err) {
    results.push({ name, ok: false, error: err?.message ?? String(err) });
    process.stdout.write(`  ✖ ${name} — ${err?.message ?? err}\n`);
    return undefined;
  }
}

// ClickUp's v3 (experimental) surfaces throw transient 500s. The client
// deliberately never retries POSTs (double-send risk), so flaky v3 creates
// get a bounded retry here in the harness where a duplicate is harmless.
async function retry500(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e?.status !== 500) throw e;
      await pause(1500);
    }
  }
  throw lastErr;
}

const STAMP = Date.now().toString(36);
const SANDBOX = `MCP-Smoke-${STAMP}`;

console.log(`\nClickUp MCP live smoke test — sandbox "${SANDBOX}"\n`);

// ── Auth & hierarchy (reads) ───────────────────────────────────────────
console.log('auth & hierarchy');
const ws = await step('workspaces_list', async () => {
  const r = await auth.getWorkspaces();
  if (!r.teams?.length) throw new Error('no workspaces');
  return r.teams[0];
});
if (!ws) { console.error('Cannot continue without a workspace.'); process.exit(1); }
const TEAM = ws.id;

await step('workspaces_seats_get', () => auth.getWorkspaceSeats(TEAM));
const spaceList = await step('spaces list', async () => {
  const r = await spaces.getSpacesFromWorkspace(TEAM);
  if (!r?.length) throw new Error('no spaces');
  return r;
});
if (!spaceList) { console.error('Cannot continue without a space.'); process.exit(1); }
const SPACE = spaceList[0].id;
await step('space get', () => spaces.getSpace(SPACE));

// ── Sandbox setup ──────────────────────────────────────────────────────
console.log('sandbox');
let folder, list;
folder = await step('folders_create', () => folders.createFolder(SPACE, { name: SANDBOX }));

let taskA, taskB, doc, view, channel, goal, timeEntry;

try {
  if (folder) {
    await step('folders_update', () => folders.updateFolder(folder.id, { name: SANDBOX }));
    list = await step('lists_create (in folder)', () => lists.createListInFolder(folder.id, { name: `${SANDBOX}-list` }));
  }

  if (list) {
    console.log('lists');
    await step('lists_get', () => lists.getList(list.id));
    await step('lists_update', () => lists.updateList(list.id, { name: `${SANDBOX}-list` }));
    await step('lists_search (folder)', () => folders.getListsFromFolder(folder.id));
    await step('lists_members_list', () => lists.getListMembers(list.id));

    // ── Statuses (the one surface we could not probe non-destructively) ─
    console.log('statuses (sandbox list)');
    await step('statuses read', () => lists.getStatuses(list.id));
    await step('statuses set (override)', async () => {
      // ClickUp requires exactly one status of type "open"
      const custom = [
        { status: 'smoke todo', color: '#d3d3d3', type: 'open' },
        { status: 'smoke doing', color: '#4194f6', type: 'custom' },
        { status: 'smoke done', color: '#6bc950', type: 'closed' },
      ];
      await lists.setStatuses(list.id, custom, true);
      const after = await lists.getStatuses(list.id);
      const names = (after ?? []).map(s => s.status?.toLowerCase?.() ?? s.status);
      if (!names.some(n => String(n).includes('smoke'))) {
        throw new Error(`statuses not applied; list still has: ${JSON.stringify(names)}`);
      }
    });

    // ── Tasks ──────────────────────────────────────────────────────────
    console.log('tasks');
    taskA = await step('tasks_create', () => tasks.createTask(list.id, { name: 'Smoke task A', description: 'created by smoke test' }));
    taskB = await step('tasks_create (B)', () => tasks.createTask(list.id, { name: 'Smoke task B' }));
    if (taskA) {
      await step('tasks_get', () => tasks.getTask(taskA.id));
      await step('tasks_update', () => tasks.updateTask(taskA.id, { description: 'updated by smoke test' }));
      await step('tasks_members_list', () => tasks.getTaskMembers(taskA.id));
    }
    await step('tasks_create_bulk (3)', async () => {
      const r = await tasks.bulkCreateTasks(list.id, [{ name: 'bulk 1' }, { name: 'bulk 2' }, { name: 'bulk 3' }], true);
      if (r.succeeded !== 3) throw new Error(`expected 3 created, got ${r.succeeded} (${JSON.stringify(r.results)})`);
    });
    await step('tasks_list (paginated)', async () => {
      const paged = await getAllPages(async p => ({ items: (await tasks.getTasksFromList(list.id, { page: p })).tasks ?? [] }));
      if (paged.items.length < 5) throw new Error(`expected ≥5 tasks, got ${paged.items.length}`);
    });
    await step('tasks_update_bulk', async () => {
      if (!taskA || !taskB) throw new Error('no tasks');
      const r = await tasks.bulkUpdateTasks([
        { task_id: taskA.id, priority: 2 },
        { task_id: taskB.id, priority: 3 },
      ], true);
      if (r.succeeded !== 2) throw new Error(`expected 2 updated, got ${r.succeeded}`);
    });

    // ── Dependencies ───────────────────────────────────────────────────
    console.log('dependencies');
    if (taskA && taskB) {
      await step('dependencies create', () => deps.addDependency(taskA.id, taskB.id));
      await step('dependencies get', async () => {
        const d = await deps.getTaskDependencies(taskA.id);
        if (!d.length) throw new Error('dependency not visible on task');
      });
      await step('dependencies delete', () => deps.removeDependency(taskA.id, taskB.id));
    }

    // ── Comments ───────────────────────────────────────────────────────
    console.log('comments');
    if (taskA) {
      const comment = await step('tasks_comments_create', () => comments.createTaskComment(taskA.id, { comment_text: 'smoke comment' }));
      await step('tasks_comments_list', () => comments.getTaskComments(taskA.id));
      if (comment?.id) {
        await step('comments_update', () => comments.updateComment(String(comment.id), { comment_text: 'smoke comment (edited)' }));
        const reply = await step('comments_replies_create', () => comments.createThreadedComment(String(comment.id), { comment_text: 'smoke reply' }));
        await step('comments_replies_list', () => comments.getThreadedComments(String(comment.id)));
        void reply;
        await step('comments_delete', () => comments.deleteComment(String(comment.id)));
      }
      await step('lists_comments_create+list', async () => {
        const c = await comments.createListComment(list.id, { comment_text: 'smoke list comment' });
        await comments.getListComments(list.id);
        if (c?.id) await comments.deleteComment(String(c.id));
      });
    }

    // ── Checklists ─────────────────────────────────────────────────────
    console.log('checklists');
    if (taskA) {
      const checklist = await step('checklists_create', async () => {
        const r = await checklists.createChecklist(taskA.id, { name: 'smoke checklist' });
        return r.checklist ?? r;
      });
      if (checklist?.id) {
        const item = await step('checklists_items_create', async () => {
          const r = await checklists.createChecklistItem(checklist.id, { name: 'smoke item' });
          return r.checklist?.items?.[0] ?? r;
        });
        if (item?.id) {
          await step('checklists_items_update', () => checklists.updateChecklistItem(checklist.id, item.id, { resolved: true }));
        }
        await step('checklists_delete', () => checklists.deleteChecklist(checklist.id));
      }
    }

    // ── Tags ───────────────────────────────────────────────────────────
    console.log('tags');
    const TAG = `mcp-smoke-${STAMP}`;
    await step('tags_create (space)', () => tags.createSpaceTag(SPACE, TAG, '#ff6b6b', '#ffffff'));
    await step('tags_list (space)', async () => {
      // Tag creation is eventually consistent; poll briefly
      for (let i = 0; i < 5; i++) {
        const r = await tags.getSpaceTags(SPACE);
        if ((r ?? []).some(t => t.name === TAG)) return;
        await pause(800);
      }
      throw new Error('created tag not in list after 5 polls');
    });
    if (taskA) {
      await step('tags_assign', () => tags.addTagToTask(taskA.id, TAG));
      await step('tags_unassign', () => tags.removeTagFromTask(taskA.id, TAG));
    }
    await step('tags_delete (space)', () => tags.deleteSpaceTag(SPACE, TAG));

    // ── Custom fields ──────────────────────────────────────────────────
    console.log('custom fields');
    const field = await step('custom_fields create', async () => {
      const r = await fields.createField(list.id, { name: `smoke-field-${STAMP}`, type: 'text' });
      return r.field ?? r;
    });
    await step('custom_fields list', async () => {
      const r = await fields.getListFields(list.id);
      if (!r?.length) throw new Error('no fields returned');
    });
    if (field?.id && taskA) {
      await step('custom_fields_values set', () => fields.setTaskFieldValue(taskA.id, field.id, 'smoke value'));
      await step('custom_fields_values get', async () => {
        const vals = await fields.getTaskFieldValues(taskA.id);
        const f = (vals ?? []).find(v => v.id === field.id);
        if (!f || f.value !== 'smoke value') throw new Error(`value not set: ${JSON.stringify(f)}`);
      });
      await step('custom_fields_values remove', () => fields.removeTaskFieldValue(taskA.id, field.id));
    }

    // ── Views ──────────────────────────────────────────────────────────
    console.log('views');
    view = await step('views create', () => views.createListView(list.id, `smoke-view-${STAMP}`, 1));
    await step('views list', () => views.getListViews(list.id));
    if (view?.id) {
      await step('views get', () => views.getView(view.id));
      await step('views update (read-modify-write)', async () => {
        const updated = await views.updateView(view.id, { name: `smoke-view-${STAMP}-renamed` });
        if (updated?.name && !updated.name.includes('renamed')) throw new Error(`rename not applied: ${updated.name}`);
      });
      await step('views view_tasks', () => views.getViewTasks(view.id));
      await step('views delete', () => views.deleteView(view.id));
      view = undefined;
    }

    // ── Time tracking (manual entry CRUD on plural paths) ──────────────
    console.log('time tracking');
    if (taskA) {
      timeEntry = await step('time_entry_create', async () => {
        const r = await time.createTimeEntry(TEAM, {
          description: 'smoke entry',
          start: String(Date.now() - 3600_000),
          duration: String(600_000),
          task_id: taskA.id,
        });
        return r.data ?? r;
      });
      await step('time_entries_list', () => time.getTimeEntries(TEAM, {}));
      if (timeEntry?.id) {
        await step('time_entry_update', () => time.updateTimeEntry(TEAM, String(timeEntry.id), { description: 'smoke entry (edited)' }));
        await step('time_entry_delete', () => time.deleteTimeEntry(TEAM, String(timeEntry.id)));
        timeEntry = undefined;
      }
    }

    // ── Docs (v3) ──────────────────────────────────────────────────────
    console.log('docs');
    doc = await step('docs create (in list)', async () => {
      const r = await retry500(() => docs.createDocInList(TEAM, list.id, `smoke-doc-${STAMP}`));
      return r.doc ?? r;
    });
    if (doc?.id) {
      await step('docs pages_list', () => docs.getDocPages(TEAM, doc.id));
      const page = await step('docs pages_create', () => docs.createDocPage(TEAM, doc.id, 'smoke page', 'page content'));
      if (page?.id) {
        await step('docs pages_update', () => docs.updateDocPage(TEAM, doc.id, page.id, 'smoke page (edited)', 'edited content'));
      }
      await step('docs list (workspace)', () => docs.getDocsFromWorkspace(TEAM, { limit: 5 }));
      await step('docs search', () => docs.searchDocs(TEAM, { query: 'smoke-doc' }));
    }

    // ── Project intelligence on the sandbox list ───────────────────────
    console.log('project intelligence');
    await step('pi health', async () => {
      const h = await pi.health(list.id);
      if (typeof h.total_tasks !== 'number' || h.data_complete !== true) throw new Error(JSON.stringify(h).slice(0, 120));
    });
    await step('pi bottlenecks', () => pi.bottlenecks(list.id));
    await step('pi velocity', () => pi.velocity(list.id));
    await step('pi dependencies', () => pi.dependencyAnalysis(list.id));
    await step('pi sprint', () => pi.sprintReadiness(list.id));
    await step('pi workload', () => pi.workload(list.id));
    await step('pi risk', () => pi.risk(list.id));
    await step('pi time_report', () => pi.timeReport(list.id));

    // ── Attachments ────────────────────────────────────────────────────
    console.log('attachments');
    if (taskA) {
      await step('attachments upload (binary-safe)', async () => {
        const payload = Buffer.from('smoke attachment \x00\x01\x02 binary bytes', 'utf-8').toString('base64');
        await attachments.uploadFile(taskA.id, payload, 'smoke.txt');
      });
      await step('attachments list', async () => {
        const t = await tasks.getTask(taskA.id);
        if (!(t.attachments ?? []).length) throw new Error('uploaded attachment not on task');
      });
    }

    // ── Task delete ────────────────────────────────────────────────────
    if (taskB) {
      await step('tasks_delete', () => tasks.deleteTask(taskB.id));
      taskB = undefined;
    }
  }

  // ── Workspace-level reads ────────────────────────────────────────────
  console.log('workspace reads');
  await step('users_list', () => users.getUsers(TEAM));
  await step('groups list', () => groups.getGroups(TEAM));
  await step('templates list', () => templates.getTaskTemplates(TEAM, 0));
  await step('webhooks list', () => webhooks.getWebhooks(TEAM));

  // ── Goals ────────────────────────────────────────────────────────────
  console.log('goals');
  goal = await step('goals_create', async () => {
    const r = await goals.createGoal(TEAM, `smoke-goal-${STAMP}`);
    return r.goal ?? r;
  });
  if (goal?.id) {
    await step('goals_get', () => goals.getGoal(goal.id));
    await step('goals_update', () => goals.updateGoal(goal.id, `smoke-goal-${STAMP}-edited`));
    const kr = await step('goals_key_results_create', async () => {
      const r = await goals.createKeyResult(goal.id, 'smoke kr', 'number', { stepsStart: 0, stepsEnd: 10, unit: 'items' });
      return r.key_result ?? r;
    });
    void kr;
  }

  // ── Chat (v3) ────────────────────────────────────────────────────────
  console.log('chat (v3)');
  await step('channels list', () => chat.getChannels(TEAM));
  channel = await step('channels create', async () => {
    const r = await retry500(() => chat.createChannel(TEAM, { name: `mcp-smoke-${STAMP}` }));
    return r.data ?? r;
  });
  if (channel?.id) {
    await pause(1500); // let the new channel provision (experimental API)
    await step('channels get', () => chat.getChannel(TEAM, channel.id));
    await step('channels update (topic)', () => chat.updateChannel(TEAM, channel.id, { topic: 'smoke topic' }));
    await step('channels_members list', () => chat.getChannelMembers(TEAM, channel.id));
    const msg = await step('messages send', async () => {
      const r = await retry500(() => chat.sendMessage(TEAM, channel.id, { content: 'smoke message' }));
      return r.data ?? r;
    });
    await step('messages list', () => chat.getChannelMessages(TEAM, channel.id, { limit: 10 }));
    if (msg?.id) {
      await step('messages update', () => chat.updateMessage(TEAM, msg.id, 'smoke message (edited)'));
      const reply = await step('replies create', async () => {
        const r = await retry500(() => chat.createReply(TEAM, msg.id, { content: 'smoke reply' }));
        return r.data ?? r;
      });
      void reply;
      await step('replies list', () => chat.getMessageReplies(TEAM, msg.id));
      await step('reactions create', () => chat.createMessageReaction(TEAM, msg.id, 'heart'));
      await step('reactions list', () => chat.getMessageReactions(TEAM, msg.id));
      await step('reactions delete', () => chat.deleteMessageReaction(TEAM, msg.id, 'heart'));
      await step('messages delete', () => chat.deleteMessage(TEAM, msg.id));
    }
  }
} finally {
  // ── Cleanup ──────────────────────────────────────────────────────────
  console.log('cleanup');
  if (channel?.id) await step('cleanup: delete chat channel', () => chat.deleteChannel(TEAM, channel.id));
  if (goal?.id) await step('cleanup: delete goal', () => goals.deleteGoal(goal.id));
  if (folder?.id) await step('cleanup: delete sandbox folder (cascades)', () => folders.deleteFolder(folder.id));
}

// ── Report ─────────────────────────────────────────────────────────────
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok);
console.log(`\n${'─'.repeat(60)}\nSMOKE RESULT: ${passed}/${results.length} passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ✖ ${f.name}: ${f.error}`);
  process.exit(1);
}
console.log('All smoke steps green.');
