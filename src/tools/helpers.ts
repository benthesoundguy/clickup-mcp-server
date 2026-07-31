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
