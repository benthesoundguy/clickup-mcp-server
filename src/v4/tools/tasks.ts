/**
 * The four task tools: find, task, create, update.
 *
 * `create` and `update` take arrays, so bulk is a parameter rather than three more tools.
 */

import { z } from 'zod';
import type { Ctx, ToolDef } from './registry.js';
import { qs } from '../core/http.js';
import { badValue, ClickUpToolError, isPolicyDenial, unresolved } from '../core/errors.js';
import { parseDate, parseDueWindow } from '../core/dates.js';
import {
  renderTaskDetail,
  renderTaskTable,
  shapeTask,
  truncate,
  type RawTask,
  type ShapedTask,
} from '../core/format.js';
import { looksLikeTaskId } from '../core/resolve.js';
import { decodeEntities, rankCandidates } from '../core/text.js';

const PAGE_SIZE = 100;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Hard ceiling on pages fetched for one call, so a broad query can't eat the rate budget. */
const MAX_PAGES = 8;

const PRIORITY_MAP: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4 };

interface TaskPage {
  tasks?: RawTask[];
  last_page?: boolean;
}

/** Fetch pages until we have enough, or run out, or hit the page ceiling. */
async function fetchTasks(
  ctx: Ctx,
  params: Record<string, unknown>,
  opts: { needAll: boolean; wanted: number },
): Promise<{ tasks: RawTask[]; scanned: number; pagesFetched: number; exhausted: boolean }> {
  const all: RawTask[] = [];
  let page = 0;
  let exhausted = false;

  for (; page < MAX_PAGES; page++) {
    const res = await ctx.http.get<TaskPage>(
      `/team/${ctx.workspaceId}/task${qs({ ...params, page })}`,
      'the workspace tasks',
    );
    const batch = res.tasks ?? [];
    all.push(...batch);

    if (res.last_page === true || batch.length < PAGE_SIZE) {
      exhausted = true;
      break;
    }
    // When no client-side filtering is pending, one page beyond what was asked for is enough
    // to know whether to say "100+".
    if (!opts.needAll && all.length >= opts.wanted) break;
  }

  return { tasks: all, scanned: all.length, pagesFetched: page + 1, exhausted };
}

export const findTool: ToolDef = {
  name: 'find',
  description:
    'Find tasks anywhere in the workspace. Everything takes human names, not IDs: ' +
    'scope="Cavalry/Findings", assignee="Ben" or "me", status="in progress". ' +
    'Omit scope to search the whole workspace. Returns a compact table. ' +
    'NOTE: text= is matched client-side over the tasks actually scanned (ClickUp has no ' +
    'server-side task search), and the reply always states the coverage — narrow with ' +
    'scope/status/assignee for a complete answer over a large workspace.',
  schema: {
    scope: z
      .string()
      .optional()
      .describe('List or space: name, "Space/Folder/List" path, or ID. Omit = whole workspace.'),
    status: z.array(z.string()).optional().describe('Status names, e.g. ["in progress","review"]'),
    assignee: z
      .array(z.string())
      .optional()
      .describe('Usernames, emails, or "me". Unresolvable names raise rather than return empty.'),
    tags: z.array(z.string()).optional().describe('Tag names'),
    due: z
      .string()
      .optional()
      .describe('overdue | today | tomorrow | week | month | none | YYYY-MM-DD | A..B'),
    text: z.string().optional().describe('Case-insensitive substring of the task name'),
    include_closed: z.boolean().optional().describe('Include closed tasks (default false)'),
    subtasks: z.boolean().optional().describe('Include subtasks (default false)'),
    detail: z.enum(['compact', 'full']).optional().describe('Default compact'),
    limit: z.number().optional().describe(`Max rows, default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT}`),
    order_by: z.enum(['due_date', 'created', 'updated', 'priority']).optional(),
    view: z
      .string()
      .optional()
      .describe('Run a saved ClickUp View by name instead of building filters by hand'),
  },
  async handler(args, ctx) {
    const limit = Math.min(Math.max(Number(args.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    const detail = (args.detail as 'compact' | 'full') ?? 'compact';

    // A saved View already encodes its own filters, so it is a different query path rather
    // than another filter. Mixing the two would silently drop whichever lost.
    if (typeof args.view === 'string' && args.view.trim()) {
      return runView(ctx, args.view.trim(), limit, detail, args);
    }
    const params: Record<string, unknown> = {
      subtasks: args.subtasks === true ? true : undefined,
      include_closed: args.include_closed === true ? true : undefined,
      order_by: args.order_by,
    };

    const headerBits: string[] = [];

    // --- scope -------------------------------------------------------------
    let scopeLabel = 'workspace';
    let scopedListId: string | undefined;
    if (typeof args.scope === 'string' && args.scope.trim()) {
      const scope = await resolveScope(ctx, args.scope.trim());
      if (scope.kind === 'list') {
        params.list_ids = [scope.id];
        scopedListId = scope.id;
        scopeLabel = scope.label;
      } else {
        params.space_ids = [scope.id];
        scopeLabel = `space ${scope.label}`;
      }
    }
    headerBits.push(scopeLabel);

    // --- assignees ---------------------------------------------------------
    if (Array.isArray(args.assignee) && args.assignee.length) {
      const ids: number[] = [];
      for (const a of args.assignee as string[]) {
        const m = await ctx.resolver.member(a);
        ids.push(m.id);
      }
      params.assignees = ids;
      headerBits.push(`assignee=${(args.assignee as string[]).join(',')}`);
    }

    // --- statuses ----------------------------------------------------------
    if (Array.isArray(args.status) && args.status.length) {
      const wanted = args.status as string[];
      if (scopedListId) {
        // Validate against the list's real statuses. ClickUp answers an unknown status with
        // an empty result set, which reads as "nothing matched" instead of "no such status".
        const valid = await ctx.resolver.listStatuses(scopedListId);
        const lower = new Map(valid.map((v) => [v.toLowerCase(), v]));
        const mapped: string[] = [];
        for (const w of wanted) {
          const hit = lower.get(w.trim().toLowerCase());
          if (!hit) throw badValue('status for this list', w, valid);
          mapped.push(hit);
        }
        params.statuses = mapped;
      } else {
        // No list scope, so validate against every status defined anywhere in the workspace.
        // Passing an unknown status straight through returns zero tasks, which reads as
        // "nothing is in that state" rather than "there is no such state".
        const known = await ctx.resolver.knownStatuses();
        const lower = new Map(known.map((v) => [v.toLowerCase(), v]));
        const mapped: string[] = [];
        for (const w of wanted) {
          const hit = lower.get(w.trim().toLowerCase());
          if (!hit) {
            throw new ClickUpToolError({
              what: `Nothing in this workspace uses a status called ${JSON.stringify(w)}.`,
              fix:
                'Filtering on it would return zero tasks, which would look like "nothing is in ' +
                'that state" rather than "no such state exists". Use one of the statuses below. ' +
                '(These are collected from every list in a folder plus each space\'s defaults; ' +
                'a folderless list with custom statuses could define others — scope the query ' +
                'to that list to validate against it exactly.)',
              candidates: known,
            });
          }
          mapped.push(hit);
        }
        params.statuses = mapped;
      }
      headerBits.push(`status=${wanted.join(',')}`);
    }

    // --- due ---------------------------------------------------------------
    let dueNoneFilter = false;
    if (typeof args.due === 'string' && args.due.trim()) {
      const w = parseDueWindow(args.due, ctx.now());
      if (w.none) dueNoneFilter = true;
      else {
        if (w.gt !== undefined) params.due_date_gt = w.gt;
        if (w.lt !== undefined) params.due_date_lt = w.lt;
      }
      headerBits.push(w.label);
    }

    // --- fetch -------------------------------------------------------------
    const text = typeof args.text === 'string' ? args.text.trim().toLowerCase() : '';
    const tagFilter = (args.tags as string[] | undefined)?.map((t) => t.toLowerCase()) ?? [];
    // Any client-side predicate means the page we need isn't knowable in advance.
    const needAll = Boolean(text) || dueNoneFilter || tagFilter.length > 0;

    const { tasks, scanned, exhausted } = await fetchTasks(ctx, params, {
      needAll,
      wanted: limit + 1,
    });

    // --- client-side predicates -------------------------------------------
    let filtered = tasks;
    if (text) filtered = filtered.filter((t) => (t.name ?? '').toLowerCase().includes(text));
    if (dueNoneFilter) filtered = filtered.filter((t) => !t.due_date);
    if (tagFilter.length) {
      filtered = filtered.filter((t) =>
        (t.tags ?? []).some((tag) => tagFilter.includes(tag.name.toLowerCase())),
      );
    }

    const shown = filtered.slice(0, limit);
    const shaped: ShapedTask[] = shown.map((t) => shapeTask(t, detail));

    // --- header ------------------------------------------------------------
    // The match count must never overstate what was actually established. When paging stopped
    // early, `filtered.length` is a floor, not a total — reporting it as "100 matches" would
    // be an unverified number presented as fact.
    const exact = exhausted;
    const countLabel = exact
      ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`
      : `${filtered.length}+ matches (more exist beyond the pages fetched)`;

    let header = `${headerBits.join(' · ')} — ${countLabel}`;
    if (shown.length < filtered.length) header += `, showing ${shown.length}`;

    // Client-side filtering only saw what was fetched, so a bare "3 matches" would overstate
    // the answer without saying how much was actually searched.
    if (needAll) {
      header += ` (scanned ${scanned} task${scanned === 1 ? '' : 's'}`;
      header += exhausted ? ', complete)' : ', HIT PAGE LIMIT)';
    }

    const hide = scopedListId ? ['list'] : [];
    const body = renderTaskTable(shaped, {
      header,
      hideColumns: hide,
    });

    if (!exhausted && needAll) {
      return `${body}\n\nCoverage warning: only the first ${scanned} tasks were scanned, so this is NOT a complete answer. Narrow with scope/status/assignee/due and re-run.`;
    }
    return body;
  },
};

/**
 * Run a saved ClickUp View.
 *
 * Views are resolved by name across the workspace, then by space/list if not found there.
 * A view carries its own filters, so combining it with status/assignee/due arguments would
 * mean silently honouring one and dropping the other — that is refused instead.
 */
async function runView(
  ctx: Ctx,
  name: string,
  limit: number,
  detail: 'compact' | 'full',
  args: Record<string, unknown>,
): Promise<string> {
  const conflicting = ['status', 'assignee', 'tags', 'due', 'text'].filter(
    (k) => args[k] !== undefined && args[k] !== '' && (!Array.isArray(args[k]) || (args[k] as unknown[]).length),
  );
  if (conflicting.length) {
    throw new ClickUpToolError({
      what: `A view already defines its own filters, so ${conflicting.join('/')} cannot be combined with view.`,
      fix: 'Either run the view on its own, or drop `view` and filter explicitly. Honouring one and ignoring the other would give a result that looks filtered but is not.',
    });
  }

  const view = await resolveView(ctx, name);
  const res = await ctx.http.get<TaskPage>(`/view/${view.id}/task${qs({ page: 0 })}`, `view ${view.name}`);
  const tasks = res.tasks ?? [];
  const shown = tasks.slice(0, limit);
  const exhausted = res.last_page === true || tasks.length < PAGE_SIZE;
  const count = exhausted ? `${tasks.length} match${tasks.length === 1 ? '' : 'es'}` : `${tasks.length}+ matches`;
  return renderTaskTable(
    shown.map((t) => shapeTask(t, detail)),
    { header: `view "${view.name}" — ${count}${shown.length < tasks.length ? `, showing ${shown.length}` : ''}` },
  );
}

interface RawView {
  id?: string;
  name?: string;
}

async function resolveView(ctx: Ctx, name: string): Promise<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  const collect = (views: RawView[] | undefined) => {
    for (const v of views ?? []) if (v.id && v.name) seen.set(v.id, decodeEntities(v.name));
  };

  const ws = await ctx.http.get<{ views?: RawView[] }>(
    `/team/${ctx.workspaceId}/view`,
    'the workspace views',
  );
  collect(ws.views);

  const lower = name.toLowerCase();
  const hit = [...seen.entries()].filter(([, n]) => n.toLowerCase() === lower);
  if (hit.length === 1) return { id: hit[0][0], name: hit[0][1] };
  if (hit.length > 1) throw ambiguousView(name, hit.map(([id, n]) => `${n} (${id})`));

  // Not a workspace view — look inside spaces and lists, which is where most views live.
  const idx = await ctx.resolver.index();
  for (const sp of idx.spaces) {
    const r = await ctx.http.get<{ views?: RawView[] }>(`/space/${sp.id}/view`, `space ${sp.name}`);
    collect(r.views);
  }
  const hit2 = [...seen.entries()].filter(([, n]) => n.toLowerCase() === lower);
  if (hit2.length === 1) return { id: hit2[0][0], name: hit2[0][1] };
  if (hit2.length > 1) throw ambiguousView(name, hit2.map(([id, n]) => `${n} (${id})`));

  const partial = [...seen.entries()].filter(([, n]) => n.toLowerCase().includes(lower));
  if (partial.length === 1) return { id: partial[0][0], name: partial[0][1] };
  if (partial.length > 1) throw ambiguousView(name, partial.map(([id, n]) => `${n} (${id})`));

  throw unresolved('view', name, rankCandidates(name, [...seen.values()]));
}

function ambiguousView(name: string, candidates: string[]): ClickUpToolError {
  return new ClickUpToolError({
    what: `${JSON.stringify(name)} matches ${candidates.length} views.`,
    fix: 'Pass the view ID instead.',
    candidates,
  });
}

async function resolveScope(
  ctx: Ctx,
  raw: string,
): Promise<{ kind: 'list' | 'space'; id: string; label: string }> {
  const idx = await ctx.resolver.index();
  const lower = raw.toLowerCase();

  // A space name is a legitimate scope too, so try spaces before failing on lists.
  const spaceHit = idx.spaces.find((s) => s.name.toLowerCase() === lower || s.id === raw);
  if (spaceHit) return { kind: 'space', id: spaceHit.id, label: spaceHit.name };

  try {
    const list = await ctx.resolver.list(raw);
    return { kind: 'list', id: list.id, label: list.path };
  } catch (err) {
    // Only a genuine *non-match* gets rebranded as "no list or space". An ambiguity error is
    // already the right answer and must survive: rewriting "matches 3 lists" into "matches
    // nothing" would be precisely the confident-wrong-answer this server exists to prevent.
    if (err instanceof ClickUpToolError && !/^No list matches/.test(err.message)) throw err;
    throw new ClickUpToolError({
      what: `No list or space matches ${JSON.stringify(raw)}.`,
      fix: 'Use `tree` to see the available spaces and lists, or pass an ID.',
      candidates: rankCandidates(raw, [
        ...idx.spaces.map((s) => `${s.name} (space)`),
        ...idx.lists.map((l) => l.path),
      ]),
    });
  }
}

export const taskTool: ToolDef = {
  name: 'task',
  description:
    'Read one task in full — description, custom fields, timestamps, optionally comments and ' +
    'subtasks. Takes a task ID (e.g. 86bben08h) or a custom ID (e.g. ABC-123).',
  schema: {
    id: z.string().describe('Task ID or custom ID'),
    comments: z.boolean().optional().describe('Include comments (default false)'),
    subtasks: z.boolean().optional().describe('Include subtasks (default false)'),
  },
  async handler(args, ctx) {
    const id = String(args.id ?? '').trim();
    if (!id) {
      throw new ClickUpToolError({
        what: 'No task ID was given.',
        fix: 'Pass the id from a `find` result, e.g. task(id:"86bben08h").',
      });
    }
    if (!looksLikeTaskId(id)) {
      throw new ClickUpToolError({
        what: `${JSON.stringify(id)} does not look like a task ID.`,
        fix: 'Task IDs look like "86bben08h". If you have a task name, use `find` first — this tool does not search by name.',
      });
    }

    const custom = /^[A-Za-z]+-\d+$/.test(id);
    const query = custom ? qs({ custom_task_ids: true, team_id: ctx.workspaceId }) : '';
    const raw = await ctx.http.get<RawTask>(`/task/${encodeURIComponent(id)}${query}`, `task ${id}`);
    const shaped = shapeTask(raw, 'full');

    const extras: Record<string, string> = {};

    if (args.subtasks === true) {
      const subs = await ctx.http.get<TaskPage>(
        `/team/${ctx.workspaceId}/task${qs({ parent: id, subtasks: true })}`,
        `subtasks of ${id}`,
      );
      const kids = (subs.tasks ?? []).filter((t) => t.id !== id);
      if (kids.length) {
        extras.subtasks = `${kids.length}`;
      }
      const detail = renderTaskDetail(shaped, extras);
      const table = renderTaskTable(
        kids.map((k) => shapeTask(k, 'compact')),
        { header: `\nsubtasks (${kids.length}):`, hideColumns: ['list'] },
      );
      return args.comments === true
        ? `${detail}\n${table}\n${await commentBlock(ctx, id)}`
        : `${detail}\n${table}`;
    }

    const detail = renderTaskDetail(shaped, extras);
    if (args.comments === true) return `${detail}\n${await commentBlock(ctx, id)}`;
    return detail;
  },
};

async function commentBlock(ctx: Ctx, taskId: string): Promise<string> {
  const res = await ctx.http.get<{ comments?: RawComment[] }>(
    `/task/${encodeURIComponent(taskId)}/comment`,
    `comments on ${taskId}`,
  );
  const list = res.comments ?? [];
  if (!list.length) return '\ncomments: none';
  const lines = list.slice(0, 30).map((c) => {
    const who = c.user?.username ?? 'unknown';
    const when = c.date ? new Date(Number(c.date)).toISOString().slice(0, 10) : '';
    const body = (c.comment_text ?? '').replace(/\s+/g, ' ').trim();
    return `- ${who} ${when}: ${truncate(body, 400)}`;
  });
  const more = list.length > lines.length ? `\n… ${list.length - lines.length} older comments` : '';
  return `\ncomments (${list.length}):\n${lines.join('\n')}${more}`;
}

interface RawComment {
  id?: string;
  comment_text?: string;
  date?: string | number;
  user?: { username?: string };
}

/** Shared field-building for create and update. */
async function buildTaskBody(
  ctx: Ctx,
  spec: Record<string, unknown>,
  listId: string | undefined,
  forCreate: boolean,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};

  if (typeof spec.name === 'string' && spec.name.trim()) body.name = spec.name.trim();
  if (typeof spec.description === 'string') body.description = spec.description;

  if (typeof spec.status === 'string' && spec.status.trim()) {
    const wanted = spec.status.trim();
    if (listId) {
      const valid = await ctx.resolver.listStatuses(listId);
      const hit = valid.find((v) => v.toLowerCase() === wanted.toLowerCase());
      if (!hit) throw badValue('status for this list', wanted, valid);
      body.status = hit;
    } else {
      body.status = wanted;
    }
  }

  if (spec.priority !== undefined && spec.priority !== null && spec.priority !== '') {
    const p = String(spec.priority).toLowerCase();
    const n = PRIORITY_MAP[p] ?? (/^[1-4]$/.test(p) ? Number(p) : undefined);
    if (n === undefined) {
      throw badValue('priority', String(spec.priority), ['urgent', 'high', 'normal', 'low']);
    }
    body.priority = n;
  }

  if (spec.due !== undefined && spec.due !== null) {
    if (spec.due === '' || spec.due === 'none') {
      body.due_date = null;
    } else {
      const d = parseDate(spec.due as string, ctx.now());
      body.due_date = d.ms;
      body.due_date_time = d.hasTime;
    }
  }
  if (spec.start !== undefined && spec.start !== null) {
    if (spec.start === '' || spec.start === 'none') {
      body.start_date = null;
    } else {
      const d = parseDate(spec.start as string, ctx.now());
      body.start_date = d.ms;
      body.start_date_time = d.hasTime;
    }
  }

  if (Array.isArray(spec.assignees)) {
    const ids: number[] = [];
    for (const a of spec.assignees as string[]) ids.push((await ctx.resolver.member(a)).id);
    // Create takes a flat array; update takes {add, rem}.
    body.assignees = forCreate ? ids : { add: ids };
  }

  if (Array.isArray(spec.tags) && forCreate) body.tags = spec.tags;

  if (spec.estimate_hours !== undefined && spec.estimate_hours !== null) {
    const h = Number(spec.estimate_hours);
    if (!Number.isFinite(h) || h < 0) {
      throw badValue('estimate_hours', String(spec.estimate_hours), ['a positive number of hours']);
    }
    body.time_estimate = Math.round(h * 3_600_000);
  }

  return body;
}

const taskSpecShape = {
  name: z.string().optional().describe('Task name'),
  description: z.string().optional(),
  status: z.string().optional().describe('Status name — validated against the list'),
  assignees: z.array(z.string()).optional().describe('Usernames, emails, or "me"'),
  tags: z.array(z.string()).optional(),
  priority: z.string().optional().describe('urgent | high | normal | low'),
  due: z.string().optional().describe('YYYY-MM-DD, "today", "next friday", "in 3 days", or "none"'),
  start: z.string().optional(),
  estimate_hours: z.number().optional(),
};

export const createTool: ToolDef = {
  name: 'create',
  description:
    'Create one or more tasks in a list. Pass `tasks` as an array to create several in one ' +
    'call. The list is addressed by name or path ("Cavalry/Findings"); assignees, status and ' +
    'priority are all resolved from human names and validated before anything is written.',
  schema: {
    list: z.string().describe('List name, "Space/Folder/List" path, or ID'),
    tasks: z
      .array(z.object({ ...taskSpecShape, parent: z.string().optional() }).passthrough())
      .describe('One entry per task. `name` is required on each.'),
  },
  async handler(args, ctx) {
    const listRef = await ctx.resolver.list(String(args.list ?? ''));
    const specs = (args.tasks ?? []) as Record<string, unknown>[];
    if (!Array.isArray(specs) || specs.length === 0) {
      throw new ClickUpToolError({
        what: 'No tasks were given to create.',
        fix: 'Pass tasks: [{ name: "…" }]. Every entry needs a name.',
      });
    }
    for (const [i, s] of specs.entries()) {
      if (typeof s.name !== 'string' || !s.name.trim()) {
        throw new ClickUpToolError({
          what: `tasks[${i}] has no name.`,
          fix: 'Every task needs a name. Nothing was created — fix the entry and re-run.',
        });
      }
    }

    // Validate every spec *before* writing any of them, so a bad entry at index 3 doesn't
    // leave three tasks already created.
    const bodies: Record<string, unknown>[] = [];
    for (const s of specs) bodies.push(await buildTaskBody(ctx, s, listRef.id, true));

    // Work out which tags are about to be conjured into existence, before anything is written.
    const requestedTags = new Set<string>();
    for (const s of specs) {
      if (Array.isArray(s.tags)) for (const t of s.tags as string[]) requestedTags.add(String(t));
    }
    let newTags: string[] = [];
    if (requestedTags.size && listRef.spaceId) {
      const existing = new Set(
        (await ctx.resolver.spaceTags(listRef.spaceId)).map((t) => t.toLowerCase()),
      );
      newTags = [...requestedTags].filter((t) => !existing.has(t.toLowerCase()));
    }

    const created: ShapedTask[] = [];
    const failures: string[] = [];
    for (const [i, body] of bodies.entries()) {
      const parent = specs[i].parent;
      if (typeof parent === 'string' && parent.trim()) body.parent = parent.trim();
      try {
        const raw = await ctx.http.post<RawTask>(
          `/list/${listRef.id}/task`,
          body,
          `list ${listRef.path}`,
        );
        created.push(shapeTask(raw, 'compact'));
      } catch (err) {
        // A capability refusal applies to the whole call, not to this one item.
        if (isPolicyDenial(err)) throw err;
        failures.push(
          `- ${String(specs[i].name)}: ${err instanceof ClickUpToolError ? err.message : String(err)}`,
        );
      }
    }

    const header = `created ${created.length}/${specs.length} in ${listRef.path}`;
    const table = renderTaskTable(created, { header, hideColumns: ['list'] });

    const notes: string[] = [];
    if (newTags.length) {
      // ClickUp auto-creates any tag it doesn't recognise, so a typo becomes a permanent
      // workspace tag with no error. Creating tags on demand is often wanted, so this reports
      // rather than blocks — but it must not happen invisibly.
      notes.push(
        `Note: ${newTags.length} tag${newTags.length === 1 ? ' did' : 's did'} not exist in this ` +
          `space and ${newTags.length === 1 ? 'was' : 'were'} created: ${newTags.join(', ')}. ` +
          `If that was a typo, remove it in ClickUp — tags persist workspace-wide.`,
      );
    }
    if (failures.length) notes.push(`FAILED ${failures.length}:\n${failures.join('\n')}`);

    return notes.length ? `${table}\n\n${notes.join('\n\n')}` : table;
  },
};

interface Relations {
  tagsAdd: string[];
  tagsRemove: string[];
  waitsOn: string[];
  blocks: string[];
  unblock: string[];
  linkTo: string[];
  unlink: string[];
}

/**
 * Tags, dependencies and links are each their own endpoint rather than fields on the task, so
 * they are applied after the main PUT.
 *
 * Dependency direction is expressed by which key is sent: `depends_on` means *this* task waits,
 * `dependency_of` means the other one does. Getting that backwards silently inverts a project
 * plan, so the two are kept as separately named arguments rather than one `dependencies` list.
 */
async function applyRelations(ctx: Ctx, taskId: string, rel: Relations): Promise<void> {
  const t = encodeURIComponent(taskId);

  for (const tag of rel.tagsAdd) {
    await ctx.http.post(`/task/${t}/tag/${encodeURIComponent(tag)}`, {}, `task ${taskId}`);
  }
  for (const tag of rel.tagsRemove) {
    await ctx.http.delete(`/task/${t}/tag/${encodeURIComponent(tag)}`, `task ${taskId}`);
  }
  for (const other of rel.waitsOn) {
    await ctx.http.post(`/task/${t}/dependency`, { depends_on: other }, `task ${taskId}`);
  }
  for (const other of rel.blocks) {
    await ctx.http.post(`/task/${t}/dependency`, { dependency_of: other }, `task ${taskId}`);
  }
  for (const other of rel.unblock) {
    await ctx.http.delete(
      `/task/${t}/dependency${qs({ depends_on: other, dependency_of: other })}`,
      `task ${taskId}`,
    );
  }
  for (const other of rel.linkTo) {
    await ctx.http.post(`/task/${t}/link/${encodeURIComponent(other)}`, {}, `task ${taskId}`);
  }
  for (const other of rel.unlink) {
    await ctx.http.delete(`/task/${t}/link/${encodeURIComponent(other)}`, `task ${taskId}`);
  }
}

export const updateTool: ToolDef = {
  name: 'update',
  description:
    'Update, move, or delete one or more tasks. Pass several IDs to apply the same change to ' +
    'all of them. Set `move_to` to relocate tasks to another list, or `delete: true` to remove ' +
    'them. Status values are validated against the destination list before anything is written.',
  schema: {
    ids: z.array(z.string()).describe('Task IDs (from `find`)'),
    ...taskSpecShape,
    tags_add: z.array(z.string()).optional().describe('Tag names to attach'),
    tags_remove: z.array(z.string()).optional().describe('Tag names to detach'),
    waits_on: z
      .array(z.string())
      .optional()
      .describe('Task IDs this task is blocked by (it cannot start until they finish)'),
    blocks: z.array(z.string()).optional().describe('Task IDs that are blocked by this task'),
    unblock: z.array(z.string()).optional().describe('Task IDs to remove a dependency with'),
    link_to: z.array(z.string()).optional().describe('Task IDs to link (a reference, not a blocker)'),
    unlink: z.array(z.string()).optional().describe('Task IDs to unlink'),
    move_to: z
      .string()
      .optional()
      .describe(
        'Destination list. NOTE: ClickUp\'s API cannot move tasks unless the "Tasks in ' +
          'Multiple Lists" ClickApp is enabled; the move is verified and the call fails ' +
          'loudly if it did not take.',
      ),
    delete: z.boolean().optional().describe('Delete the tasks. Irreversible.'),
    remove_assignees: z.array(z.string()).optional().describe('Usernames to unassign'),
  },
  async handler(args, ctx) {
    const ids = (args.ids ?? []) as string[];
    if (!Array.isArray(ids) || !ids.length) {
      throw new ClickUpToolError({
        what: 'No task IDs were given.',
        fix: 'Pass ids: ["86bben08h"]. Use `find` to get IDs.',
      });
    }

    if (args.delete === true) {
      const done: string[] = [];
      const failed: string[] = [];
      for (const id of ids) {
        try {
          await ctx.http.delete(`/task/${encodeURIComponent(id)}`, `task ${id}`);
          done.push(id);
        } catch (err) {
          if (isPolicyDenial(err)) throw err;
          failed.push(`- ${id}: ${err instanceof ClickUpToolError ? err.message : String(err)}`);
        }
      }
      return `deleted ${done.length}/${ids.length}${done.length ? `: ${done.join(', ')}` : ''}${
        failed.length ? `\nFAILED:\n${failed.join('\n')}` : ''
      }`;
    }

    // A move changes which statuses are legal, so resolve the destination first and validate
    // against *it* rather than against wherever the task currently lives.
    let destListId: string | undefined;
    let destPath: string | undefined;
    if (typeof args.move_to === 'string' && args.move_to.trim()) {
      const dest = await ctx.resolver.list(args.move_to.trim());
      destListId = dest.id;
      destPath = dest.path;
    }

    const body = await buildTaskBody(ctx, args, destListId, false);

    if (Array.isArray(args.remove_assignees) && args.remove_assignees.length) {
      const rem: number[] = [];
      for (const a of args.remove_assignees as string[]) rem.push((await ctx.resolver.member(a)).id);
      const existing = (body.assignees as { add?: number[] } | undefined) ?? {};
      body.assignees = { ...existing, rem };
    }

    const rel = {
      tagsAdd: (args.tags_add as string[] | undefined) ?? [],
      tagsRemove: (args.tags_remove as string[] | undefined) ?? [],
      waitsOn: (args.waits_on as string[] | undefined) ?? [],
      blocks: (args.blocks as string[] | undefined) ?? [],
      unblock: (args.unblock as string[] | undefined) ?? [],
      linkTo: (args.link_to as string[] | undefined) ?? [],
      unlink: (args.unlink as string[] | undefined) ?? [],
    };
    const hasRel = Object.values(rel).some((a) => a.length);

    if (!Object.keys(body).length && !destListId && !hasRel) {
      throw new ClickUpToolError({
        what: 'Nothing to change.',
        fix: 'Pass at least one of: status, assignees, due, priority, name, description, tags_add/remove, waits_on, blocks, link_to, move_to, delete.',
      });
    }

    const updated: ShapedTask[] = [];
    const failed: string[] = [];
    const notMoved: string[] = [];
    for (const id of ids) {
      try {
        if (destListId) {
          // There is no working "move task" in the ClickUp public API. Verified 2026-08-15:
          // POST /list/{dest}/task/{id} returns 200 {} and does nothing unless the "Tasks in
          // Multiple Lists" ClickApp is on; PUT /task/{id} with list_id is silently ignored;
          // /move 404s on v2 and v3. So attempt it, then *read the task back* and believe the
          // API's answer rather than its status code.
          await ctx.http.post(
            `/list/${destListId}/task/${encodeURIComponent(id)}`,
            {},
            `task ${id}`,
          );
        }
        const raw = Object.keys(body).length
          ? await ctx.http.put<RawTask>(`/task/${encodeURIComponent(id)}`, body, `task ${id}`)
          : await ctx.http.get<RawTask>(`/task/${encodeURIComponent(id)}`, `task ${id}`);

        if (destListId) {
          const landed = await ctx.http.get<RawTask>(
            `/task/${encodeURIComponent(id)}`,
            `task ${id}`,
          );
          if (landed.list?.id !== destListId) {
            notMoved.push(id);
            updated.push(shapeTask(landed, 'compact'));
            continue;
          }
          updated.push(shapeTask(landed, 'compact'));
          continue;
        }
        if (hasRel) {
          await applyRelations(ctx, id, rel);
          // Tags and dependencies are written after the PUT, so the PUT's response predates
          // them. Rendering it would show the tag you just removed still attached — which
          // reads as a failed write. Re-read so the row shown is the row that now exists.
          const fresh = await ctx.http.get<RawTask>(`/task/${encodeURIComponent(id)}`, `task ${id}`);
          updated.push(shapeTask(fresh, 'compact'));
          continue;
        }
        updated.push(shapeTask(raw, 'compact'));
      } catch (err) {
        if (isPolicyDenial(err)) throw err;
        failed.push(`- ${id}: ${err instanceof ClickUpToolError ? err.message : String(err)}`);
      }
    }

    if (notMoved.length) {
      // Reporting "moved" here would be a confident lie, which is the one thing this server
      // is built not to do. Fail the whole call rather than bury it in a footnote.
      throw new ClickUpToolError({
        what:
          `${notMoved.length} task${notMoved.length === 1 ? ' was' : 's were'} NOT moved to ` +
          `${destPath}: ${notMoved.join(', ')}. Any other field changes in this call were applied.`,
        fix:
          'ClickUp\'s public API cannot move a task between lists. The endpoint returns HTTP 200 ' +
          'and silently does nothing. Either enable the "Tasks in Multiple Lists" ClickApp in ' +
          'ClickUp settings (which makes this endpoint work), move the task in the ClickUp UI, ' +
          'or recreate it in the destination and delete the original — noting that recreating ' +
          'gives it a new ID and loses its comments and history.',
      });
    }

    const what = destPath ? `updated + moved to ${destPath}` : 'updated';
    const table = renderTaskTable(updated, {
      header: `${what}: ${updated.length}/${ids.length}`,
      hideColumns: destListId ? [] : ['list'],
    });
    return failed.length ? `${table}\n\nFAILED ${failed.length}:\n${failed.join('\n')}` : table;
  },
};

export const taskTools: ToolDef[] = [findTool, taskTool, createTool, updateTool];
