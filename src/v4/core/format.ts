/**
 * Response shaping. The only place raw ClickUp JSON is allowed to die.
 *
 * Measured on a real 100-task list: raw ClickUp JSON is 42,619 tokens, the same information
 * shaped to what an agent can act on is 816. The waste is structural, not incidental —
 * `sharing`, `watchers` and `creator` alone are 44.7% of the payload, and the *parent list*
 * is repeated on all 100 rows in a query that was scoped to that one list.
 *
 * Hence two rules:
 *   - Tabular output, not JSON. Keys aren't repeated per row; that was worth a further 46%.
 *   - Invariants are hoisted into a header. Whatever is true of every row is printed once.
 */

import { decodeEntities } from './text.js';

export interface ShapedTask {
  id: string;
  name: string;
  status: string;
  assignees: string[];
  due?: string;
  start?: string;
  priority?: string;
  tags: string[];
  parent?: string;
  listId?: string;
  listName?: string;
  spaceName?: string;
  url?: string;
  estimateHours?: number;
  timeSpentHours?: number;
  description?: string;
  customFields?: { name: string; value: string }[];
  dateCreated?: string;
  dateUpdated?: string;
  closed?: boolean;
}

export type Detail = 'compact' | 'full';

const PRIORITY_NAMES: Record<string, string> = {
  '1': 'urgent',
  '2': 'high',
  '3': 'normal',
  '4': 'low',
};

export function shapeTask(raw: RawTask, detail: Detail = 'compact'): ShapedTask {
  const out: ShapedTask = {
    id: raw.id,
    name: decodeEntities(raw.name ?? ''),
    status: raw.status?.status ?? '',
    assignees: (raw.assignees ?? []).map((a) => a.username || a.email || String(a.id)),
    tags: (raw.tags ?? []).map((t) => decodeEntities(t.name)),
  };

  if (raw.due_date) out.due = isoDay(raw.due_date);
  if (raw.start_date) out.start = isoDay(raw.start_date);
  if (raw.priority) {
    out.priority =
      raw.priority.priority ?? PRIORITY_NAMES[String(raw.priority.id)] ?? String(raw.priority.id);
  }
  if (raw.parent) out.parent = raw.parent;
  if (raw.list) {
    out.listId = raw.list.id;
    out.listName = decodeEntities(raw.list.name ?? '');
  }
  if (raw.space?.name) out.spaceName = decodeEntities(raw.space.name);
  if (raw.status?.type === 'closed') out.closed = true;

  if (detail === 'full') {
    out.url = raw.url ?? (raw.id ? `https://app.clickup.com/t/${raw.id}` : undefined);
    if (raw.time_estimate) out.estimateHours = round2(raw.time_estimate / 3_600_000);
    if (raw.time_spent) out.timeSpentHours = round2(raw.time_spent / 3_600_000);
    if (raw.description) out.description = raw.description;
    if (raw.date_created) out.dateCreated = isoDay(raw.date_created);
    if (raw.date_updated) out.dateUpdated = isoDay(raw.date_updated);
    const cf = (raw.custom_fields ?? [])
      .filter((f) => f.value !== undefined && f.value !== null && f.value !== '')
      .map((f) => ({ name: f.name, value: renderCustomFieldValue(f) }));
    if (cf.length) out.customFields = cf;
  }

  return out;
}

/**
 * Render a task table.
 *
 * `invariants` are printed once in the header and omitted from every row — in a list-scoped
 * query that is a quarter of the payload.
 */
export function renderTaskTable(
  tasks: ShapedTask[],
  opts: {
    header?: string;
    total?: number;
    truncated?: boolean;
    hideColumns?: string[];
  } = {},
): string {
  if (!tasks.length) {
    return opts.header ? `${opts.header}\n(no tasks matched)` : '(no tasks matched)';
  }

  const hide = new Set(opts.hideColumns ?? []);
  // Only emit a column if at least one row has something to say in it. A column of empties
  // is pure overhead, and which columns are empty varies a lot between workspaces.
  const cols: { key: string; get: (t: ShapedTask) => string }[] = [
    { key: 'id', get: (t) => t.id },
    { key: 'status', get: (t) => t.status },
    { key: 'due', get: (t) => t.due ?? '' },
    { key: 'pri', get: (t) => t.priority ?? '' },
    { key: 'assignees', get: (t) => t.assignees.join(',') },
    { key: 'tags', get: (t) => t.tags.join(',') },
    { key: 'list', get: (t) => t.listName ?? '' },
    { key: 'name', get: (t) => t.name },
  ];

  const active = cols.filter(
    (c) => !hide.has(c.key) && tasks.some((t) => c.get(t).trim() !== ''),
  );

  const lines: string[] = [];
  if (opts.header) lines.push(opts.header);
  lines.push(active.map((c) => c.key).join('\t'));
  for (const t of tasks) {
    lines.push(active.map((c) => sanitizeCell(c.get(t))).join('\t'));
  }

  if (opts.truncated) {
    lines.push(
      `… showing ${tasks.length}${opts.total ? ` of ${opts.total}+` : ''}. ClickUp pages at 100; ` +
        `narrow with status/assignee/due filters rather than paging blindly.`,
    );
  }
  return lines.join('\n');
}

/** A single task, expanded. Key/value beats a one-row table when there's one of something. */
export function renderTaskDetail(t: ShapedTask, extras: Record<string, string> = {}): string {
  const rows: [string, string | undefined][] = [
    ['task', `${t.name} (${t.id})`],
    ['status', t.status],
    ['list', t.listName ? `${t.spaceName ? `${t.spaceName}/` : ''}${t.listName}` : undefined],
    ['assignees', t.assignees.join(', ') || undefined],
    ['due', t.due],
    ['start', t.start],
    ['priority', t.priority],
    ['tags', t.tags.join(', ') || undefined],
    ['parent', t.parent],
    ['estimate', t.estimateHours ? `${t.estimateHours}h` : undefined],
    ['tracked', t.timeSpentHours ? `${t.timeSpentHours}h` : undefined],
    ['created', t.dateCreated],
    ['updated', t.dateUpdated],
    ['url', t.url],
  ];

  const lines = rows
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`);

  for (const cf of t.customFields ?? []) lines.push(`field.${cf.name}: ${cf.value}`);
  for (const [k, v] of Object.entries(extras)) if (v) lines.push(`${k}: ${v}`);

  if (t.description) {
    lines.push('---');
    lines.push(truncate(t.description, 4000));
  }
  return lines.join('\n');
}

/** Generic two-column table for non-task rows (lists, spaces, members…). */
export function renderTable(
  rows: Record<string, string>[],
  columns: string[],
  header?: string,
): string {
  if (!rows.length) return header ? `${header}\n(nothing found)` : '(nothing found)';
  const active = columns.filter((c) => rows.some((r) => (r[c] ?? '').trim() !== ''));
  const lines: string[] = [];
  if (header) lines.push(header);
  lines.push(active.join('\t'));
  for (const r of rows) lines.push(active.map((c) => sanitizeCell(r[c] ?? '')).join('\t'));
  return lines.join('\n');
}

/**
 * Cells are tab-separated, so a tab or newline inside a value would forge a column or a row.
 * Task names are user-controlled and routinely contain both.
 */
export function sanitizeCell(v: string): string {
  return (
    v
      // Anything that could forge a column or a row becomes a single space...
      .replace(/[\t\n\r\u2028\u2029]+/g, ' ')
      // ...and any other control character is dropped outright.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
      .trim()
  );
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… truncated ${s.length - max} more characters.`;
}

function isoDay(ms: string | number): string {
  const n = typeof ms === 'string' ? Number(ms) : ms;
  if (!Number.isFinite(n)) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function renderCustomFieldValue(f: RawCustomField): string {
  const v = f.value;
  if (v === null || v === undefined) return '';
  // Drop-downs store an index into `type_config.options`; the index alone is meaningless.
  if (f.type === 'drop_down' && f.type_config?.options) {
    const opt = f.type_config.options.find(
      (o) => o.orderindex === Number(v) || o.id === String(v),
    );
    if (opt) return opt.name ?? opt.label ?? String(v);
  }
  if (f.type === 'labels' && Array.isArray(v) && f.type_config?.options) {
    const names = v.map((id) => {
      const o = f.type_config?.options?.find((x) => x.id === String(id));
      return o?.label ?? o?.name ?? String(id);
    });
    return names.join(', ');
  }
  if (f.type === 'users' && Array.isArray(v)) {
    return v.map((u) => (typeof u === 'object' && u ? ((u as RawUserish).username ?? '') : String(u))).join(', ');
  }
  if (f.type === 'date') {
    const n = Number(v);
    return Number.isFinite(n) ? isoDay(n) : String(v);
  }
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 200);
  return String(v);
}

interface RawUserish {
  username?: string;
}
export interface RawCustomField {
  id: string;
  name: string;
  type: string;
  value?: unknown;
  type_config?: {
    options?: { id?: string; name?: string; label?: string; orderindex?: number }[];
  };
}
export interface RawTask {
  id: string;
  name?: string;
  description?: string;
  status?: { status?: string; type?: string };
  assignees?: { id: number; username?: string; email?: string }[];
  tags?: { name: string }[];
  priority?: { id?: string | number; priority?: string } | null;
  due_date?: string | number | null;
  start_date?: string | number | null;
  date_created?: string | number | null;
  date_updated?: string | number | null;
  time_estimate?: number | null;
  time_spent?: number | null;
  parent?: string | null;
  url?: string;
  list?: { id: string; name?: string };
  space?: { id?: string; name?: string };
  custom_fields?: RawCustomField[];
}
