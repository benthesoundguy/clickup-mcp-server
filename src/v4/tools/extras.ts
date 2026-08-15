/**
 * comment, time, fields, docs.
 */

import { z } from 'zod';
import type { Ctx, ToolDef } from './registry.js';
import { qs } from '../core/http.js';
import { badValue, ClickUpToolError, unresolved } from '../core/errors.js';
import { parseDate } from '../core/dates.js';
import { renderTable, truncate, type RawCustomField } from '../core/format.js';

export const commentTool: ToolDef = {
  name: 'comment',
  description:
    'Read the comment thread on a task, or post a new comment. Omit `text` to read; supply it ' +
    'to post. Comments are where the reasoning behind a task usually lives, so read them ' +
    'before concluding a task is unclear or stale.',
  schema: {
    task: z.string().describe('Task ID'),
    text: z.string().optional().describe('Comment to post. Omit to read existing comments.'),
    assign_to: z.string().optional().describe('Assign the comment to a user, by name'),
    limit: z.number().optional().describe('Max comments to read, default 30'),
  },
  async handler(args, ctx) {
    const task = String(args.task ?? '').trim();
    if (!task) throw new ClickUpToolError({ what: 'No task given.', fix: 'Pass task: "<id>".' });

    if (typeof args.text === 'string' && args.text.trim()) {
      const body: Record<string, unknown> = { comment_text: args.text.trim(), notify_all: false };
      if (typeof args.assign_to === 'string' && args.assign_to.trim()) {
        body.assignee = (await ctx.resolver.member(args.assign_to.trim())).id;
      }
      const r = await ctx.http.post<{ id?: string }>(
        `/task/${encodeURIComponent(task)}/comment`,
        body,
        `task ${task}`,
      );
      return `comment posted on ${task}${r.id ? ` (${r.id})` : ''}`;
    }

    const limit = Math.min(Math.max(Number(args.limit ?? 30), 1), 100);
    const res = await ctx.http.get<{ comments?: RawComment[] }>(
      `/task/${encodeURIComponent(task)}/comment`,
      `task ${task}`,
    );
    const all = res.comments ?? [];
    if (!all.length) return `task ${task}: no comments`;
    const shown = all.slice(0, limit);
    const lines = shown.map((c) => {
      const who = c.user?.username ?? 'unknown';
      const when = c.date ? new Date(Number(c.date)).toISOString().slice(0, 16).replace('T', ' ') : '';
      return `- ${who} ${when}: ${truncate((c.comment_text ?? '').replace(/\s+/g, ' ').trim(), 600)}`;
    });
    const more = all.length > shown.length ? `\n… ${all.length - shown.length} older` : '';
    return `task ${task} — ${all.length} comment${all.length === 1 ? '' : 's'}:\n${lines.join('\n')}${more}`;
  },
};

interface RawComment {
  id?: string;
  comment_text?: string;
  date?: string | number;
  user?: { username?: string };
}

interface RawTimeEntry {
  id?: string;
  task?: { id?: string; name?: string };
  start?: string | number;
  duration?: string | number;
  description?: string;
  user?: { username?: string };
}

export const timeTool: ToolDef = {
  name: 'time',
  description:
    'Time tracking: start or stop a timer, log time after the fact, or report what has been ' +
    'tracked. Durations are in hours ("1.5") or "90m".',
  schema: {
    action: z.enum(['start', 'stop', 'current', 'log', 'report']),
    task: z.string().optional().describe('Task ID — required for start and log'),
    duration: z.string().optional().describe('For log: "1.5" (hours) or "90m"'),
    when: z.string().optional().describe('For log: the day, e.g. "today" or "2026-08-14"'),
    description: z.string().optional(),
    since: z.string().optional().describe('For report: start of the window, default 7 days ago'),
    who: z.string().optional().describe('For report: a member name, default everyone'),
  },
  async handler(args, ctx) {
    const action = args.action as string;
    const team = ctx.workspaceId;

    if (action === 'current') {
      const r = await ctx.http.get<{ data?: RawTimeEntry | null }>(
        `/team/${team}/time_entries/current`,
        'the running timer',
      );
      const e = r.data;
      if (!e || !e.id) return 'no timer running';
      const mins = Math.round(Number(e.duration ?? 0) / 60000);
      return `running: ${e.task?.name ?? e.task?.id ?? 'unknown task'} — ${mins}m elapsed`;
    }

    if (action === 'start') {
      const task = String(args.task ?? '').trim();
      if (!task) {
        throw new ClickUpToolError({ what: 'No task given.', fix: 'Pass task: "<id>" to start a timer on it.' });
      }
      await ctx.http.post(
        `/team/${team}/time_entries/start`,
        { tid: task, description: args.description ?? '' },
        `task ${task}`,
      );
      return `timer started on ${task}`;
    }

    if (action === 'stop') {
      const r = await ctx.http.post<{ data?: RawTimeEntry }>(`/team/${team}/time_entries/stop`, {}, 'the running timer');
      const mins = Math.round(Number(r.data?.duration ?? 0) / 60000);
      return `timer stopped — ${mins}m logged`;
    }

    if (action === 'log') {
      const task = String(args.task ?? '').trim();
      if (!task) throw new ClickUpToolError({ what: 'No task given.', fix: 'Pass task: "<id>".' });
      const durMs = parseDuration(String(args.duration ?? ''));
      const when = args.when ? parseDate(String(args.when), ctx.now()).ms : ctx.now();
      await ctx.http.post(
        `/team/${team}/time_entries`,
        { tid: task, start: when, duration: durMs, description: args.description ?? '' },
        `task ${task}`,
      );
      return `logged ${(durMs / 3_600_000).toFixed(2)}h on ${task}`;
    }

    // report
    const since = args.since
      ? parseDate(String(args.since), ctx.now()).ms
      : ctx.now() - 7 * 86_400_000;
    const params: Record<string, unknown> = { start_date: since, end_date: ctx.now() };
    if (typeof args.who === 'string' && args.who.trim()) {
      params.assignee = (await ctx.resolver.member(args.who.trim())).id;
    }
    const r = await ctx.http.get<{ data?: RawTimeEntry[] }>(
      `/team/${team}/time_entries${qs(params)}`,
      'time entries',
    );
    const entries = r.data ?? [];
    if (!entries.length) return `no time tracked since ${new Date(since).toISOString().slice(0, 10)}`;

    const byTask = new Map<string, { name: string; ms: number }>();
    let total = 0;
    for (const e of entries) {
      const key = e.task?.id ?? 'no-task';
      const ms = Number(e.duration ?? 0);
      total += ms;
      const cur = byTask.get(key) ?? { name: e.task?.name ?? key, ms: 0 };
      cur.ms += ms;
      byTask.set(key, cur);
    }
    const rows = [...byTask.entries()]
      .sort((a, b) => b[1].ms - a[1].ms)
      .map(([id, v]) => ({ id, hours: (v.ms / 3_600_000).toFixed(2), task: v.name }));

    return renderTable(
      rows,
      ['id', 'hours', 'task'],
      `time since ${new Date(since).toISOString().slice(0, 10)} — ${(total / 3_600_000).toFixed(2)}h across ${entries.length} entries`,
    );
  },
};

function parseDuration(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (!s) {
    throw new ClickUpToolError({
      what: 'No duration given.',
      fix: 'Pass duration: "1.5" for hours, or "90m" for minutes.',
    });
  }
  const m = /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)?$/.exec(s);
  if (!m) {
    throw new ClickUpToolError({
      what: `Could not understand the duration ${JSON.stringify(raw)}.`,
      fix: 'Use "1.5" or "1.5h" for hours, or "90m" for minutes.',
    });
  }
  const n = Number(m[1]);
  const unit = m[2] ?? 'h';
  const ms = unit.startsWith('m') ? n * 60_000 : n * 3_600_000;
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new ClickUpToolError({ what: 'Duration must be positive.', fix: 'Pass e.g. "1.5" or "90m".' });
  }
  return Math.round(ms);
}

export const fieldsTool: ToolDef = {
  name: 'fields',
  description:
    'Inspect a list\'s custom fields, or set a custom field value on a task. Field names and ' +
    'drop-down option labels are resolved for you — no field UUIDs needed.',
  schema: {
    list: z.string().optional().describe('List to inspect, by name/path/ID'),
    task: z.string().optional().describe('Task to write to'),
    field: z.string().optional().describe('Field name (with task, to set a value)'),
    value: z.string().optional().describe('Value to set. For drop-downs, the option label.'),
  },
  async handler(args, ctx) {
    const taskId = String(args.task ?? '').trim();
    const fieldName = String(args.field ?? '').trim();

    // Inspect mode
    if (!taskId || !fieldName) {
      const listRaw = String(args.list ?? '').trim();
      if (!listRaw) {
        throw new ClickUpToolError({
          what: 'Nothing to inspect or set.',
          fix: 'Pass list: "<name>" to see its fields, or task + field + value to set one.',
        });
      }
      const list = await ctx.resolver.list(listRaw);
      const fields = await listFields(ctx, list.id);
      const rows = fields.map((f) => ({
        name: f.name,
        type: f.type,
        options: (f.type_config?.options ?? [])
          .map((o) => o.label ?? o.name ?? '')
          .filter(Boolean)
          .join(', '),
      }));
      return renderTable(rows, ['name', 'type', 'options'], `custom fields on ${list.path}:`);
    }

    // Write mode. The field lives on the task's list, so find that first.
    const task = await ctx.http.get<{ list?: { id?: string } }>(
      `/task/${encodeURIComponent(taskId)}`,
      `task ${taskId}`,
    );
    const listId = task.list?.id;
    if (!listId) {
      throw new ClickUpToolError({
        what: `Could not determine which list task ${taskId} belongs to.`,
        fix: 'Check the task ID with `task`.',
      });
    }

    const fields = await listFields(ctx, listId);
    const hit = fields.find((f) => f.name.toLowerCase() === fieldName.toLowerCase());
    if (!hit) {
      throw unresolved('custom field', fieldName, fields.map((f) => f.name));
    }

    const raw = String(args.value ?? '');
    let value: unknown = raw;

    if (hit.type === 'drop_down') {
      const opts = hit.type_config?.options ?? [];
      const opt = opts.find(
        (o) => (o.label ?? o.name ?? '').toLowerCase() === raw.trim().toLowerCase(),
      );
      if (!opt) {
        throw badValue(
          `option for field "${hit.name}"`,
          raw,
          opts.map((o) => o.label ?? o.name ?? '').filter(Boolean),
        );
      }
      value = opt.id ?? opt.orderindex;
    } else if (hit.type === 'number' || hit.type === 'currency') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw badValue(`value for "${hit.name}"`, raw, ['a number']);
      value = n;
    } else if (hit.type === 'checkbox') {
      value = /^(true|yes|1|checked)$/i.test(raw.trim());
    } else if (hit.type === 'date') {
      value = parseDate(raw, ctx.now()).ms;
    }

    await ctx.http.post(
      `/task/${encodeURIComponent(taskId)}/field/${hit.id}`,
      { value },
      `field ${hit.name}`,
    );
    return `set ${hit.name} = ${raw} on ${taskId}`;
  },
};

async function listFields(ctx: Ctx, listId: string): Promise<RawCustomField[]> {
  return ctx.cache.remember(`fields:${listId}`, async () => {
    const r = await ctx.http.get<{ fields?: RawCustomField[] }>(
      `/list/${listId}/field`,
      `list ${listId}`,
    );
    return r.fields ?? [];
  });
}

export const docsTool: ToolDef = {
  name: 'docs',
  description: 'Search ClickUp Docs, or read one. Docs live on the v3 API.',
  schema: {
    action: z.enum(['search', 'read']).optional().describe('Default search'),
    query: z.string().optional().describe('Substring of the doc name'),
    id: z.string().optional().describe('Doc ID, for read'),
    limit: z.number().optional(),
  },
  async handler(args, ctx) {
    const action = (args.action as string) ?? 'search';

    if (action === 'read') {
      const id = String(args.id ?? '').trim();
      if (!id) throw new ClickUpToolError({ what: 'No doc ID given.', fix: 'Pass id from `docs` search.' });
      const pages = await ctx.http.get<{ pages?: DocPage[] }>(
        `/workspaces/${ctx.workspaceId}/docs/${encodeURIComponent(id)}/pages`,
        `doc ${id}`,
        'v3',
      );
      const list = pages.pages ?? [];
      if (!list.length) return `doc ${id}: no pages`;
      return list
        .map((p) => `## ${p.name ?? '(untitled)'}\n${truncate(p.content ?? '', 6000)}`)
        .join('\n\n');
    }

    const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 100);
    const res = await ctx.http.get<{ docs?: DocMeta[] }>(
      `/workspaces/${ctx.workspaceId}/docs${qs({ limit: 50 })}`,
      'workspace docs',
      'v3',
    );
    let docs = res.docs ?? [];
    const q = String(args.query ?? '').trim().toLowerCase();
    if (q) docs = docs.filter((d) => (d.name ?? '').toLowerCase().includes(q));
    if (!docs.length) {
      return q ? `no docs matched ${JSON.stringify(q)} (searched ${(res.docs ?? []).length})` : 'no docs found';
    }
    const rows = docs.slice(0, limit).map((d) => ({ id: d.id ?? '', name: d.name ?? '' }));
    return renderTable(rows, ['id', 'name'], `docs (${docs.length} matched):`);
  },
};

interface DocMeta {
  id?: string;
  name?: string;
}
interface DocPage {
  name?: string;
  content?: string;
}

export const extraTools: ToolDef[] = [commentTool, timeTool, fieldsTool, docsTool];
