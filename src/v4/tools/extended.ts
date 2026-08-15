/**
 * The long tail: goals, chat, webhooks, attach, checklist, people.
 *
 * These close the coverage gap against v3's remaining 39 tools. Same rules as everywhere else
 * — names not IDs, validate before writing, and never claim an outcome that wasn't verified.
 */

import { z } from 'zod';
import { basename } from 'node:path';
import type { Ctx, ToolDef } from './registry.js';
import { qs } from '../core/http.js';
import { ClickUpToolError, unresolved, ambiguous } from '../core/errors.js';
import { readLocalFile } from '../core/localfile.js';
import { parseDate } from '../core/dates.js';
import { renderTable, truncate } from '../core/format.js';
import { decodeEntities, rankCandidates } from '../core/text.js';

/** ClickUp caps attachments at 25MB; failing here beats a slow upload that 413s. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------- goals

interface RawGoal {
  id?: string;
  name?: string;
  due_date?: string | number | null;
  percent_completed?: number;
  owners?: { username?: string }[];
  key_results?: RawKeyResult[];
}
interface RawKeyResult {
  id?: string;
  name?: string;
  type?: string;
  steps_current?: unknown;
  steps_end?: unknown;
  percent_completed?: number;
}

async function resolveGoal(ctx: Ctx, locator: string): Promise<RawGoal> {
  const q = locator.trim();
  const res = await ctx.http.get<{ goals?: RawGoal[]; folders?: { goals?: RawGoal[] }[] }>(
    `/team/${ctx.workspaceId}/goal`,
    'the workspace goals',
  );
  const all = [...(res.goals ?? []), ...(res.folders ?? []).flatMap((f) => f.goals ?? [])];
  const byId = all.find((g) => g.id === q);
  if (byId) return byId;

  const lower = q.toLowerCase();
  const exact = all.filter((g) => decodeEntities(g.name ?? '').toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw ambiguous('goal', q, exact.map((g) => `${g.name} (${g.id})`));

  const partial = all.filter((g) => decodeEntities(g.name ?? '').toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw ambiguous('goal', q, partial.map((g) => `${g.name} (${g.id})`));

  throw unresolved('goal', q, rankCandidates(q, all.map((g) => decodeEntities(g.name ?? ''))));
}

export const goalsTool: ToolDef = {
  name: 'goals',
  description:
    'Read or manage ClickUp Goals and their key results (the measurable targets under a goal). ' +
    'Goals belong to the workspace rather than to a list, and are addressed by name. Run the ' +
    'list action before creating — duplicate goal names are easy to make and impossible to ' +
    'tell apart afterwards.',
  schema: {
    action: z.enum(['list', 'get', 'create', 'update', 'delete']),
    goal: z.string().optional().describe('Goal name or ID — required for get/update/delete'),
    name: z.string().optional().describe('Goal name, for create or rename'),
    due: z.string().optional().describe('YYYY-MM-DD, "next friday", "in 2 weeks"'),
    owners: z.array(z.string()).optional().describe('Usernames or "me"'),
    description: z.string().optional(),
    key_results: z
      .array(
        z.object({
          name: z.string(),
          type: z.enum(['number', 'currency', 'boolean', 'percentage']).optional(),
          target: z.number().optional(),
          current: z.number().optional(),
        }),
      )
      .optional()
      .describe('Targets to add under this goal'),
    confirm: z.boolean().optional().describe('Required for delete'),
  },
  async handler(args, ctx) {
    const action = args.action as string;

    if (action === 'list') {
      const res = await ctx.http.get<{ goals?: RawGoal[]; folders?: { goals?: RawGoal[] }[] }>(
        `/team/${ctx.workspaceId}/goal`,
        'the workspace goals',
      );
      const all = [...(res.goals ?? []), ...(res.folders ?? []).flatMap((f) => f.goals ?? [])];
      if (!all.length) return 'no goals in this workspace';
      return renderTable(
        all.map((g) => ({
          id: g.id ?? '',
          pct: g.percent_completed === undefined ? '' : `${Math.round(g.percent_completed)}%`,
          due: g.due_date ? new Date(Number(g.due_date)).toISOString().slice(0, 10) : '',
          owners: (g.owners ?? []).map((o) => o.username ?? '').filter(Boolean).join(','),
          name: decodeEntities(g.name ?? ''),
        })),
        ['id', 'pct', 'due', 'owners', 'name'],
        `goals (${all.length}):`,
      );
    }

    if (action === 'create') {
      const name = String(args.name ?? '').trim();
      if (!name) throw new ClickUpToolError({ what: 'No goal name given.', fix: 'Pass name: "…".' });
      const body: Record<string, unknown> = { name, multiple_owners: true };
      if (args.description) body.description = args.description;
      if (args.due) body.due_date = parseDate(String(args.due), ctx.now()).ms;
      if (Array.isArray(args.owners) && args.owners.length) {
        const ids: number[] = [];
        for (const o of args.owners as string[]) ids.push((await ctx.resolver.member(o)).id);
        body.owners = ids;
      }
      const created = await ctx.http.post<{ goal?: RawGoal }>(
        `/team/${ctx.workspaceId}/goal`,
        body,
        'the workspace goals',
      );
      const id = created.goal?.id;
      const added = await addKeyResults(ctx, id, args.key_results as KeyResultSpec[] | undefined);
      return `created goal "${name}" (${id})${added ? `\n${added}` : ''}`;
    }

    const goalRef = String(args.goal ?? '').trim();
    if (!goalRef) {
      throw new ClickUpToolError({
        what: `No goal given for ${action}.`,
        fix: 'Pass goal: "<name or id>". Run goals(action:"list") to see them.',
      });
    }
    const goal = await resolveGoal(ctx, goalRef);

    if (action === 'get') {
      const full = await ctx.http.get<{ goal?: RawGoal }>(`/goal/${goal.id}`, `goal ${goal.name}`);
      const g = full.goal ?? goal;
      const lines = [
        `goal: ${decodeEntities(g.name ?? '')} (${g.id})`,
        g.percent_completed !== undefined ? `progress: ${Math.round(g.percent_completed)}%` : '',
        g.due_date ? `due: ${new Date(Number(g.due_date)).toISOString().slice(0, 10)}` : '',
        (g.owners ?? []).length ? `owners: ${(g.owners ?? []).map((o) => o.username).join(', ')}` : '',
      ].filter(Boolean);
      const krs = g.key_results ?? [];
      if (krs.length) {
        lines.push(
          renderTable(
            krs.map((k) => ({
              id: k.id ?? '',
              pct: k.percent_completed === undefined ? '' : `${Math.round(k.percent_completed)}%`,
              progress: `${fmtStep(k.steps_current)}/${fmtStep(k.steps_end)}`,
              name: decodeEntities(k.name ?? ''),
            })),
            ['id', 'pct', 'progress', 'name'],
            `\nkey results (${krs.length}):`,
          ),
        );
      }
      return lines.join('\n');
    }

    if (action === 'update') {
      const body: Record<string, unknown> = {};
      if (args.name) body.name = String(args.name);
      if (args.description !== undefined) body.description = args.description;
      if (args.due) body.due_date = parseDate(String(args.due), ctx.now()).ms;
      if (Array.isArray(args.owners) && args.owners.length) {
        const ids: number[] = [];
        for (const o of args.owners as string[]) ids.push((await ctx.resolver.member(o)).id);
        body.add_owners = ids;
      }
      const added = await addKeyResults(ctx, goal.id, args.key_results as KeyResultSpec[] | undefined);
      if (!Object.keys(body).length && !added) {
        throw new ClickUpToolError({
          what: 'Nothing to change on this goal.',
          fix: 'Pass at least one of: name, description, due, owners, key_results.',
        });
      }
      if (Object.keys(body).length) {
        await ctx.http.put(`/goal/${goal.id}`, body, `goal ${goal.name}`);
      }
      return `updated goal "${decodeEntities(goal.name ?? '')}"${added ? `\n${added}` : ''}`;
    }

    // delete
    if (args.confirm !== true) {
      throw new ClickUpToolError({
        what: `Deleting goal "${decodeEntities(goal.name ?? '')}" also destroys its key results, permanently.`,
        fix: 'Re-run with confirm: true if that is genuinely intended.',
      });
    }
    await ctx.http.delete(`/goal/${goal.id}`, `goal ${goal.name}`);
    return `deleted goal "${decodeEntities(goal.name ?? '')}"`;
  },
};

interface KeyResultSpec {
  name: string;
  type?: string;
  target?: number;
  current?: number;
}

async function addKeyResults(
  ctx: Ctx,
  goalId: string | undefined,
  specs: KeyResultSpec[] | undefined,
): Promise<string> {
  if (!goalId || !specs?.length) return '';
  const done: string[] = [];
  for (const k of specs) {
    await ctx.http.post(
      `/goal/${goalId}/key_result`,
      {
        name: k.name,
        type: k.type ?? 'number',
        steps_start: 0,
        steps_end: k.target ?? 1,
        unit: k.type === 'currency' ? 'USD' : undefined,
      },
      `goal ${goalId}`,
    );
    done.push(k.name);
  }
  return `added ${done.length} key result${done.length === 1 ? '' : 's'}: ${done.join(', ')}`;
}

function fmtStep(v: unknown): string {
  if (v === null || v === undefined) return '0';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 20);
  return String(v);
}

// ----------------------------------------------------------------------------- chat

interface RawChannel {
  id?: string;
  name?: string;
  archived?: boolean;
}
interface RawMessage {
  id?: string;
  text_content?: string;
  content?: string;
  date?: string | number;
  user_id?: string | number;
  userId?: string | number;
}

async function resolveChannel(ctx: Ctx, locator: string): Promise<RawChannel> {
  const q = locator.trim();
  const res = await ctx.http.get<{ data?: RawChannel[] }>(
    `/workspaces/${ctx.workspaceId}/chat/channels`,
    'the chat channels',
    'v3',
  );
  const all = (res.data ?? []).filter((c) => !c.archived);
  const byId = all.find((c) => c.id === q);
  if (byId) return byId;
  const lower = q.toLowerCase();
  const exact = all.filter((c) => decodeEntities(c.name ?? '').toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw ambiguous('channel', q, exact.map((c) => `${c.name} (${c.id})`));
  const partial = all.filter((c) => decodeEntities(c.name ?? '').toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw ambiguous('channel', q, partial.map((c) => `${c.name} (${c.id})`));
  throw unresolved('channel', q, rankCandidates(q, all.map((c) => decodeEntities(c.name ?? ''))));
}

export const chatTool: ToolDef = {
  name: 'chat',
  description:
    'Read or post in ClickUp Chat channels, addressed by name. Posting is visible to everyone ' +
    'in the channel and cannot be unsent through this tool, so treat it as publishing rather ' +
    'than as a note to self.',
  schema: {
    action: z.enum(['channels', 'read', 'post', 'members']),
    channel: z.string().optional().describe('Channel name or ID — required except for `channels`'),
    text: z.string().optional().describe('Message to post'),
    limit: z.number().optional().describe('Messages to read, default 30'),
  },
  async handler(args, ctx) {
    const action = args.action as string;
    const ws = ctx.workspaceId;

    if (action === 'channels') {
      const res = await ctx.http.get<{ data?: RawChannel[] }>(
        `/workspaces/${ws}/chat/channels`,
        'the chat channels',
        'v3',
      );
      const all = (res.data ?? []).filter((c) => !c.archived);
      if (!all.length) return 'no chat channels';
      return renderTable(
        all.map((c) => ({ id: c.id ?? '', name: decodeEntities(c.name ?? '') })),
        ['id', 'name'],
        `chat channels (${all.length}):`,
      );
    }

    const channel = await resolveChannel(ctx, String(args.channel ?? ''));

    if (action === 'members') {
      const res = await ctx.http.get<{ data?: { id?: string; username?: string; email?: string }[] }>(
        `/workspaces/${ws}/chat/channels/${channel.id}/members`,
        `channel ${channel.name}`,
        'v3',
      );
      const m = res.data ?? [];
      return renderTable(
        m.map((x) => ({ id: String(x.id ?? ''), name: x.username ?? '', email: x.email ?? '' })),
        ['id', 'name', 'email'],
        `members of ${decodeEntities(channel.name ?? '')} (${m.length}):`,
      );
    }

    if (action === 'post') {
      const text = String(args.text ?? '').trim();
      if (!text) {
        throw new ClickUpToolError({
          what: 'No message text given.',
          fix: 'Pass text: "…". Posting an empty message is never what was meant.',
        });
      }
      await ctx.http.post(
        `/workspaces/${ws}/chat/channels/${channel.id}/messages`,
        { type: 'message', content: text },
        `channel ${channel.name}`,
        'v3',
      );
      return `posted to ${decodeEntities(channel.name ?? '')}`;
    }

    const limit = Math.min(Math.max(Number(args.limit ?? 30), 1), 100);
    const res = await ctx.http.get<{ data?: RawMessage[] }>(
      `/workspaces/${ws}/chat/channels/${channel.id}/messages${qs({ limit })}`,
      `channel ${channel.name}`,
      'v3',
    );
    const msgs = res.data ?? [];
    if (!msgs.length) return `${decodeEntities(channel.name ?? '')}: no messages`;
    const lines = msgs.slice(0, limit).map((m) => {
      const when = m.date ? new Date(Number(m.date)).toISOString().slice(0, 16).replace('T', ' ') : '';
      const who = String(m.user_id ?? m.userId ?? '?');
      const body = (m.text_content ?? m.content ?? '').replace(/\s+/g, ' ').trim();
      return `- ${who} ${when}: ${truncate(body, 400)}`;
    });
    return `${decodeEntities(channel.name ?? '')} — ${msgs.length} message${msgs.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
  },
};

// ------------------------------------------------------------------------- webhooks

export const webhooksTool: ToolDef = {
  name: 'webhooks',
  description:
    'List, create, or delete workspace webhooks. Creating one starts delivering every matching ' +
    'event to the endpoint immediately — list the existing ones first, because duplicates are ' +
    'silent and double-deliver.',
  schema: {
    action: z.enum(['list', 'create', 'delete']),
    endpoint: z.string().optional().describe('HTTPS URL to deliver to'),
    events: z
      .array(z.string())
      .optional()
      .describe('e.g. ["taskCreated","taskStatusUpdated"]. Omit for all events.'),
    scope: z.string().optional().describe('Restrict to a space, folder or list, by name'),
    id: z.string().optional().describe('Webhook ID, for delete'),
    confirm: z.boolean().optional().describe('Required for delete'),
  },
  async handler(args, ctx) {
    const action = args.action as string;

    if (action === 'list') {
      const res = await ctx.http.get<{ webhooks?: RawWebhook[] }>(
        `/team/${ctx.workspaceId}/webhook`,
        'the workspace webhooks',
      );
      const all = res.webhooks ?? [];
      if (!all.length) return 'no webhooks configured';
      return renderTable(
        all.map((w) => ({
          id: w.id ?? '',
          status: w.health?.status ?? '',
          fails: String(w.health?.fail_count ?? ''),
          events: Array.isArray(w.events) ? w.events.join(',') : String(w.events ?? 'all'),
          endpoint: w.endpoint ?? '',
        })),
        ['id', 'status', 'fails', 'events', 'endpoint'],
        `webhooks (${all.length}):`,
      );
    }

    if (action === 'create') {
      const endpoint = String(args.endpoint ?? '').trim();
      if (!/^https:\/\//i.test(endpoint)) {
        throw new ClickUpToolError({
          what: endpoint ? `${JSON.stringify(endpoint)} is not an HTTPS URL.` : 'No endpoint given.',
          fix: 'ClickUp only delivers to https:// endpoints. Pass endpoint: "https://…".',
        });
      }
      const body: Record<string, unknown> = { endpoint };
      const events = args.events as string[] | undefined;
      body.events = events?.length ? events : '*';

      if (typeof args.scope === 'string' && args.scope.trim()) {
        const raw = args.scope.trim();
        const idx = await ctx.resolver.index();
        const space = idx.spaces.find((s) => s.name.toLowerCase() === raw.toLowerCase());
        if (space) body.space_id = space.id;
        else {
          const list = await ctx.resolver.list(raw);
          body.list_id = list.id;
        }
      }

      const created = await ctx.http.post<{ id?: string; webhook?: { id?: string } }>(
        `/team/${ctx.workspaceId}/webhook`,
        body,
        'the workspace webhooks',
      );
      const id = created.webhook?.id ?? created.id;
      return `created webhook ${id} → ${endpoint} (events: ${events?.length ? events.join(',') : 'all'})`;
    }

    const id = String(args.id ?? '').trim();
    if (!id) {
      throw new ClickUpToolError({
        what: 'No webhook ID given.',
        fix: 'Run webhooks(action:"list") and pass the id.',
      });
    }
    if (args.confirm !== true) {
      throw new ClickUpToolError({
        what: `Deleting webhook ${id} stops all deliveries to its endpoint.`,
        fix: 'Re-run with confirm: true.',
      });
    }
    await ctx.http.delete(`/webhook/${id}`, `webhook ${id}`);
    return `deleted webhook ${id}`;
  },
};

interface RawWebhook {
  id?: string;
  endpoint?: string;
  events?: string[] | string;
  health?: { status?: string; fail_count?: number };
}

// --------------------------------------------------------------------------- attach

export const attachTool: ToolDef = {
  name: 'attach',
  description:
    'Upload a local file to a task as an attachment (max 25MB). To SEE a task\'s existing ' +
    'attachments use `task` — ClickUp has no endpoint that lists them (GET returns 405), so ' +
    'they are only visible on the task object itself.',
  schema: {
    task: z.string().describe('Task ID'),
    file_path: z.string().describe('Absolute path to a local file'),
    name: z.string().optional().describe('Override the stored filename'),
  },
  async handler(args, ctx) {
    const task = String(args.task ?? '').trim();
    const filePath = String(args.file_path ?? '').trim();
    if (!task || !filePath) {
      throw new ClickUpToolError({
        what: 'attach needs both a task and a file_path.',
        fix: 'attach(task:"86bben08h", file_path:"/abs/path/to/file.pdf")',
      });
    }

    // Goes through the filesystem chokepoint rather than `readFile`, so the sandbox applies
    // however this tool is reached — including a direct handler call that bypassed the registry.
    const { bytes: buf } = await readLocalFile(filePath, ctx.attachRoot);
    if (buf.length > MAX_UPLOAD_BYTES) {
      throw new ClickUpToolError({
        what: `${filePath} is ${Math.round(buf.length / 1048576)}MB.`,
        fix: 'ClickUp caps attachments at 25MB. Compress it or link to it instead.',
      });
    }

    const fileName = String(args.name ?? '').trim() || basename(filePath);
    const form = new FormData();
    form.append('attachment', new Blob([new Uint8Array(buf)]), fileName);

    const res = await ctx.http.upload<{ id?: string; title?: string }>(
      `/task/${encodeURIComponent(task)}/attachment`,
      form,
      `task ${task}`,
    );
    return `attached ${fileName} (${Math.max(1, Math.round(buf.length / 1024))}KB) to ${task}${res.id ? ` — ${res.id}` : ''}`;
  },
};

// ------------------------------------------------------------------------ checklist

interface RawChecklist {
  id?: string;
  name?: string;
  items?: { id?: string; name?: string; resolved?: boolean }[];
}

async function taskChecklists(ctx: Ctx, taskId: string): Promise<RawChecklist[]> {
  const t = await ctx.http.get<{ checklists?: RawChecklist[] }>(
    `/task/${encodeURIComponent(taskId)}`,
    `task ${taskId}`,
  );
  return t.checklists ?? [];
}

export const checklistTool: ToolDef = {
  name: 'checklist',
  description:
    'Manage the checklists inside a task — the sub-steps of one task, which are different from ' +
    'subtasks (subtasks are their own tasks; checklist items are not). Checklists and items ' +
    'are addressed by their text, so wording must match what is already there.',
  schema: {
    task: z.string().describe('Task ID'),
    action: z.enum(['list', 'add', 'add_item', 'rename', 'remove', 'check', 'uncheck']),
    checklist: z.string().optional().describe('Checklist name'),
    item: z.string().optional().describe('Item text'),
    new_text: z.string().optional().describe('Replacement text, for rename'),
    assignee: z.string().optional().describe('Assign an item, by username'),
  },
  async handler(args, ctx) {
    const task = String(args.task ?? '').trim();
    if (!task) throw new ClickUpToolError({ what: 'No task given.', fix: 'Pass task: "<id>".' });
    const action = args.action as string;
    const lists = await taskChecklists(ctx, task);

    if (action === 'list') {
      if (!lists.length) return `task ${task}: no checklists`;
      const out: string[] = [];
      for (const c of lists) {
        const items = c.items ?? [];
        const done = items.filter((i) => i.resolved).length;
        out.push(`${decodeEntities(c.name ?? '')} (${done}/${items.length})`);
        for (const i of items) {
          out.push(`  [${i.resolved ? 'x' : ' '}] ${decodeEntities(i.name ?? '')}`);
        }
      }
      return out.join('\n');
    }

    if (action === 'add') {
      const name = String(args.checklist ?? '').trim();
      if (!name) {
        throw new ClickUpToolError({ what: 'No checklist name given.', fix: 'Pass checklist: "…".' });
      }
      const r = await ctx.http.post<{ checklist?: { id?: string } }>(
        `/task/${encodeURIComponent(task)}/checklist`,
        { name },
        `task ${task}`,
      );
      return `added checklist "${name}" to ${task}${r.checklist?.id ? ` (${r.checklist.id})` : ''}`;
    }

    const target = findChecklist(lists, String(args.checklist ?? ''));

    if (action === 'add_item') {
      const text = String(args.item ?? '').trim();
      if (!text) throw new ClickUpToolError({ what: 'No item text given.', fix: 'Pass item: "…".' });
      const body: Record<string, unknown> = { name: text };
      if (typeof args.assignee === 'string' && args.assignee.trim()) {
        body.assignee = (await ctx.resolver.member(args.assignee.trim())).id;
      }
      await ctx.http.post(`/checklist/${target.id}/checklist_item`, body, `checklist ${target.name}`);
      return `added "${text}" to ${decodeEntities(target.name ?? '')}`;
    }

    if (action === 'remove' && !args.item) {
      await ctx.http.delete(`/checklist/${target.id}`, `checklist ${target.name}`);
      return `deleted checklist "${decodeEntities(target.name ?? '')}" from ${task}`;
    }

    if (action === 'rename' && !args.item) {
      const nn = String(args.new_text ?? '').trim();
      if (!nn) throw new ClickUpToolError({ what: 'No new_text given.', fix: 'Pass new_text: "…".' });
      await ctx.http.put(`/checklist/${target.id}`, { name: nn }, `checklist ${target.name}`);
      return `renamed checklist to "${nn}"`;
    }

    const item = findItem(target, String(args.item ?? ''));

    if (action === 'remove') {
      await ctx.http.delete(
        `/checklist/${target.id}/checklist_item/${item.id}`,
        `item ${item.name}`,
      );
      return `removed "${decodeEntities(item.name ?? '')}"`;
    }

    const body: Record<string, unknown> = {};
    if (action === 'check') body.resolved = true;
    if (action === 'uncheck') body.resolved = false;
    if (action === 'rename') {
      const nn = String(args.new_text ?? '').trim();
      if (!nn) throw new ClickUpToolError({ what: 'No new_text given.', fix: 'Pass new_text: "…".' });
      body.name = nn;
    }
    if (typeof args.assignee === 'string' && args.assignee.trim()) {
      body.assignee = (await ctx.resolver.member(args.assignee.trim())).id;
    }
    await ctx.http.put(
      `/checklist/${target.id}/checklist_item/${item.id}`,
      body,
      `item ${item.name}`,
    );
    return `${action}ed "${decodeEntities(item.name ?? '')}"`;
  },
};

function findChecklist(lists: RawChecklist[], q: string): RawChecklist {
  if (!lists.length) {
    throw new ClickUpToolError({
      what: 'This task has no checklists.',
      fix: 'Create one first with checklist(action:"add", checklist:"…").',
    });
  }
  const t = q.trim();
  if (!t) {
    if (lists.length === 1) return lists[0];
    throw ambiguous('checklist', '(none given)', lists.map((c) => decodeEntities(c.name ?? '')));
  }
  const lower = t.toLowerCase();
  const hit = lists.filter((c) => decodeEntities(c.name ?? '').toLowerCase() === lower);
  if (hit.length === 1) return hit[0];
  const partial = lists.filter((c) => decodeEntities(c.name ?? '').toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw ambiguous('checklist', t, partial.map((c) => decodeEntities(c.name ?? '')));
  }
  throw unresolved('checklist', t, lists.map((c) => decodeEntities(c.name ?? '')));
}

function findItem(c: RawChecklist, q: string): { id?: string; name?: string } {
  const items = c.items ?? [];
  const t = q.trim();
  if (!t) {
    throw new ClickUpToolError({
      what: 'No item given.',
      fix: `Pass item: "…". Items in "${decodeEntities(c.name ?? '')}": ${items.map((i) => decodeEntities(i.name ?? '')).join(', ') || '(none)'}`,
    });
  }
  const lower = t.toLowerCase();
  const hit = items.filter((i) => decodeEntities(i.name ?? '').toLowerCase() === lower);
  if (hit.length === 1) return hit[0];
  const partial = items.filter((i) => decodeEntities(i.name ?? '').toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw ambiguous('checklist item', t, partial.map((i) => decodeEntities(i.name ?? '')));
  }
  throw unresolved('checklist item', t, items.map((i) => decodeEntities(i.name ?? '')));
}

// --------------------------------------------------------------------------- people

/**
 * Membership administration.
 *
 * Inviting or removing a member changes billing: paid workspaces charge per member seat, and
 * removing someone can reassign or orphan their work. Every mutating action therefore requires
 * `confirm: true` and reports the seat position first. That is a deliberate speed bump, not a
 * refusal — the caller can always confirm.
 */
export const peopleTool: ToolDef = {
  name: 'people',
  description:
    'Workspace membership: list members and guests, check seat usage, invite or remove people, ' +
    'and grant or revoke a guest\'s access to a specific task, list or folder. ' +
    'WARNING: on paid plans, inviting consumes a billable seat and removing someone can orphan ' +
    'their assigned work — every mutating action requires confirm: true and reports seat usage ' +
    'first. Read-only actions (list, seats, groups) are free of that.',
  schema: {
    action: z.enum([
      'list',
      'seats',
      'groups',
      'invite',
      'remove',
      'set_admin',
      'guest_invite',
      'guest_remove',
      'guest_grant',
      'guest_revoke',
    ]),
    email: z.string().optional().describe('For invite / guest_invite'),
    who: z.string().optional().describe('Existing member or guest: username, email, or ID'),
    admin: z.boolean().optional().describe('For set_admin'),
    target: z
      .string()
      .optional()
      .describe('For guest_grant/guest_revoke: a task ID, or a list or folder by name'),
    permission: z
      .enum(['read', 'comment', 'edit', 'create'])
      .optional()
      .describe('Guest permission level, default read'),
    confirm: z.boolean().optional().describe('Required for every mutating action'),
  },
  async handler(args, ctx) {
    const action = args.action as string;
    const ws = ctx.workspaceId;

    const seats = async () =>
      ctx.http.get<RawSeats>(`/team/${ws}/seats`, 'the workspace seats');

    if (action === 'seats') {
      const s = await seats();
      return [
        `member seats: ${s.members?.filled_members_seats ?? '?'} used of ${s.members?.total_member_seats ?? '?'} (${s.members?.empty_member_seats ?? '?'} free)`,
        `guest seats: ${s.guests?.filled_guest_seats ?? '?'} used of ${s.guests?.total_guest_seats ?? '?'} (${s.guests?.empty_guest_seats ?? '?'} free)`,
      ].join('\n');
    }

    if (action === 'list') {
      const idx = await ctx.resolver.index();
      const s = await seats().catch(() => null);
      const table = renderTable(
        idx.members.map((m) => ({ id: String(m.id), name: m.username, email: m.email })),
        ['id', 'name', 'email'],
        `members (${idx.members.length}):`,
      );
      return s
        ? `${table}\n\nseats: ${s.members?.filled_members_seats ?? '?'}/${s.members?.total_member_seats ?? '?'} member, ${s.guests?.filled_guest_seats ?? '?'}/${s.guests?.total_guest_seats ?? '?'} guest`
        : table;
    }

    if (action === 'groups') {
      const r = await ctx.http.get<{ groups?: { id?: string; name?: string; members?: unknown[] }[] }>(
        `/group${qs({ team_id: ws })}`,
        'the user groups',
      );
      const g = r.groups ?? [];
      if (!g.length) return 'no user groups (teams) in this workspace';
      return renderTable(
        g.map((x) => ({
          id: x.id ?? '',
          members: String((x.members ?? []).length),
          name: decodeEntities(x.name ?? ''),
        })),
        ['id', 'members', 'name'],
        `user groups (${g.length}):`,
      );
    }

    // Everything below mutates membership, and therefore billing.
    if (args.confirm !== true) {
      const s = await seats().catch(() => null);
      const seatLine = s
        ? ` Current usage: ${s.members?.filled_members_seats ?? '?'}/${s.members?.total_member_seats ?? '?'} member seats, ${s.guests?.filled_guest_seats ?? '?'}/${s.guests?.total_guest_seats ?? '?'} guest seats.`
        : '';
      throw new ClickUpToolError({
        what: `"${action}" changes who can access this workspace, and on a paid plan that changes billing.${seatLine}`,
        fix: 'Re-run with confirm: true if that is genuinely intended. Removing a member can also orphan the tasks assigned to them.',
      });
    }

    if (action === 'invite') {
      const email = requireEmail(args.email);
      await ctx.http.post(`/team/${ws}/user`, { email, admin: args.admin === true }, 'the workspace');
      ctx.resolver.invalidate();
      return `invited ${email} as ${args.admin === true ? 'admin' : 'member'} — this consumes a member seat`;
    }

    if (action === 'guest_invite') {
      const email = requireEmail(args.email);
      await ctx.http.post(`/team/${ws}/guest`, { email }, 'the workspace');
      return `invited guest ${email} — this consumes a guest seat`;
    }

    if (action === 'remove') {
      const m = await ctx.resolver.member(String(args.who ?? ''));
      await ctx.http.delete(`/team/${ws}/user/${m.id}`, `member ${m.username}`);
      ctx.resolver.invalidate();
      return `removed ${m.username} <${m.email}> from the workspace — their assigned tasks are now unassigned`;
    }

    if (action === 'set_admin') {
      const m = await ctx.resolver.member(String(args.who ?? ''));
      await ctx.http.put(
        `/team/${ws}/user/${m.id}`,
        { admin: args.admin === true },
        `member ${m.username}`,
      );
      return `${m.username} is now ${args.admin === true ? 'an admin' : 'a regular member'}`;
    }

    if (action === 'guest_remove') {
      const id = String(args.who ?? '').trim();
      if (!id) throw new ClickUpToolError({ what: 'No guest given.', fix: 'Pass who: "<guest id>".' });
      await ctx.http.delete(`/team/${ws}/guest/${id}`, `guest ${id}`);
      return `removed guest ${id}`;
    }

    // guest_grant / guest_revoke
    const guestId = String(args.who ?? '').trim();
    const targetRaw = String(args.target ?? '').trim();
    if (!guestId || !targetRaw) {
      throw new ClickUpToolError({
        what: 'guest_grant/guest_revoke need both who (guest ID) and target.',
        fix: 'target is a task ID, or a list or folder by name.',
      });
    }
    const { kind, id } = await resolveGuestTarget(ctx, targetRaw);
    const perm = (args.permission as string) ?? 'read';
    if (action === 'guest_grant') {
      await ctx.http.post(
        `/guest/${guestId}/${kind}/${id}`,
        { permission_level: perm },
        `${kind} ${targetRaw}`,
      );
      return `granted guest ${guestId} ${perm} access to ${kind} ${targetRaw}`;
    }
    await ctx.http.delete(`/guest/${guestId}/${kind}/${id}`, `${kind} ${targetRaw}`);
    return `revoked guest ${guestId}'s access to ${kind} ${targetRaw}`;
  },
};

interface RawSeats {
  members?: {
    filled_members_seats?: number;
    total_member_seats?: number;
    empty_member_seats?: number;
  };
  guests?: {
    filled_guest_seats?: number;
    total_guest_seats?: number;
    empty_guest_seats?: number;
  };
}

function requireEmail(v: unknown): string {
  const e = String(v ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
    throw new ClickUpToolError({
      what: e ? `${JSON.stringify(e)} is not a valid email address.` : 'No email given.',
      fix: 'Pass email: "person@example.com". Invites are addressed by email, not username.',
    });
  }
  return e;
}

async function resolveGuestTarget(
  ctx: Ctx,
  raw: string,
): Promise<{ kind: 'task' | 'list' | 'folder'; id: string }> {
  // A task ID is unambiguous by shape; otherwise try list then folder.
  if (/^[0-9a-z]{6,12}$/i.test(raw) && !/\s/.test(raw)) return { kind: 'task', id: raw };
  try {
    const l = await ctx.resolver.list(raw);
    return { kind: 'list', id: l.id };
  } catch {
    const f = await ctx.resolver.folder(raw);
    return { kind: 'folder', id: f.id };
  }
}

export const extendedTools: ToolDef[] = [
  goalsTool,
  chatTool,
  webhooksTool,
  attachTool,
  checklistTool,
  peopleTool,
];
