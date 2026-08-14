// Shared helpers for tool handlers: response shaping and error normalization.
//
// Responses are compact JSON (no pretty-printing) — tool output goes into an
// LLM context window, where indentation is pure token waste. List-shaped
// payloads get trimmed to a lean default field set with an opt-in for the
// full objects.

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ [key: string]: unknown; type: 'text'; text: string }>;
  isError?: boolean;
}

/** Successful tool result with compact JSON. */
export function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }] };
}

/** Error tool result; logs to stderr (never stdout — that's the transport). */
export function fail(context: string, error: any): ToolResult {
  console.error(`[${context}]`, error);
  return {
    content: [{ type: 'text', text: `${context}: ${error?.message ?? String(error)}` }],
    isError: true
  };
}

/** Wrap a handler body: try/catch + shaping in one place. */
export function toolHandler<A>(
  context: string,
  fn: (args: A) => Promise<unknown>
): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      const result = await fn(args);
      return ok(result);
    } catch (error: any) {
      return fail(context, error);
    }
  };
}

// ── Task trimming ──────────────────────────────────────────────────────

/** The lean default view of a task — what agents actually need. */
export const LEAN_TASK_FIELDS = [
  'id', 'name', 'status', 'priority', 'assignees', 'due_date', 'start_date',
  'date_updated', 'parent', 'url', 'tags', 'time_estimate', 'dependencies'
] as const;

/** Trim one raw API task object down to the lean field set (or a custom one). */
export function trimTask(task: any, fields?: string[]): any {
  const wanted = fields?.length ? fields : (LEAN_TASK_FIELDS as unknown as string[]);
  const out: any = {};
  for (const f of wanted) {
    if (task[f] === undefined || task[f] === null) continue;
    switch (f) {
      case 'status':
        out.status = task.status?.status ?? task.status;
        break;
      case 'priority':
        out.priority = task.priority?.priority ?? task.priority;
        break;
      case 'assignees':
        out.assignees = (task.assignees ?? []).map((a: any) => a.username ?? a.email ?? a.id);
        break;
      case 'tags':
        if (Array.isArray(task.tags) && task.tags.length) {
          out.tags = task.tags.map((t: any) => t.name ?? t);
        }
        break;
      case 'dependencies':
        if (Array.isArray(task.dependencies) && task.dependencies.length) {
          out.dependencies = task.dependencies;
        }
        break;
      default:
        out[f] = task[f];
    }
  }
  return out;
}

/**
 * Shape a task-list response: lean by default, full objects on request.
 * Adds a note when results were trimmed so the model knows how to get more.
 */
export function shapeTaskList(
  tasks: any[],
  opts: { detail?: 'lean' | 'full'; fields?: string[]; complete?: boolean } = {}
): any {
  const detail = opts.detail ?? 'lean';
  const shaped: any = {
    count: tasks.length,
    tasks: detail === 'full' ? tasks : tasks.map(t => trimTask(t, opts.fields)),
  };
  if (detail !== 'full') {
    shaped.note = 'Lean view. Pass detail:"full" for complete task objects, or fields:[...] to choose fields.';
  }
  if (opts.complete === false) {
    shaped.data_complete = false;
    shaped.note = (shaped.note ? shaped.note + ' ' : '') + 'Result truncated by page cap — more tasks exist.';
  }
  return shaped;
}

/** Pause between requests in bulk loops so serial writes stay under the rate limit. */
export const BULK_PACING_MS = 150;
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Date coercion ──────────────────────────────────────────────────────

/**
 * Coerce a task date into the Unix-millisecond form ClickUp wants.
 * Accepts:
 *  - number (Unix ms) — passed through
 *  - "YYYY-MM-DD"            → that date at noon, server-local time
 *  - "YYYY-MM-DD HH:MM"      → that local time
 *  - any ISO-8601 string with explicit offset
 * Returns { ms, hasTime } so callers can set due_date_time correctly.
 */
export function coerceDate(input: number | string): { ms: number; hasTime: boolean } {
  if (typeof input === 'number') return { ms: input, hasTime: true };
  const s = input.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    // Noon local time keeps the calendar date stable across timezones
    const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12, 0, 0);
    return { ms: d.getTime(), hasTime: false };
  }
  const dateTime = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (dateTime) {
    const d = new Date(
      Number(dateTime[1]), Number(dateTime[2]) - 1, Number(dateTime[3]),
      Number(dateTime[4]), Number(dateTime[5]), Number(dateTime[6] ?? 0)
    );
    return { ms: d.getTime(), hasTime: true };
  }
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return { ms: parsed, hasTime: true };
  throw new Error(`Unparseable date: "${input}". Use Unix ms, "YYYY-MM-DD", or "YYYY-MM-DD HH:MM".`);
}

/**
 * Parse a duration into milliseconds. Accepts a number (already ms), a plain
 * numeric string, or human forms: "90m", "1h 30m", "1.5h", "2h", "45s".
 */
export function coerceDuration(input: number | string): number {
  if (typeof input === 'number') return input;
  const s = String(input).trim();
  if (/^\d+$/.test(s)) return Number(s); // bare number = already ms
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/gi;
  let ms = 0, matched = false, m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    matched = true;
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.startsWith('h')) ms += n * 3_600_000;
    else if (unit.startsWith('m')) ms += n * 60_000;
    else ms += n * 1000;
  }
  if (!matched) throw new Error(`Unparseable duration: "${input}". Use milliseconds, or forms like "90m", "1h 30m", "1.5h".`);
  return Math.round(ms);
}

/**
 * Normalize due_date/start_date on task params in place: string dates become
 * Unix ms, and *_time flags are set from whether a time was provided (unless
 * the caller set them explicitly).
 */
export function normalizeTaskDates<T extends { due_date?: number | string; due_date_time?: boolean; start_date?: number | string; start_date_time?: boolean }>(params: T): T {
  if (params.due_date !== undefined) {
    const { ms, hasTime } = coerceDate(params.due_date);
    params.due_date = ms;
    if (params.due_date_time === undefined) params.due_date_time = hasTime;
  }
  if (params.start_date !== undefined) {
    const { ms, hasTime } = coerceDate(params.start_date);
    params.start_date = ms;
    if (params.start_date_time === undefined) params.start_date_time = hasTime;
  }
  return params;
}
