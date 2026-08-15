/**
 * Errors that teach.
 *
 * Every error an agent sees must answer three questions: what failed, why, and what to do
 * next. ClickUp's own errors answer none of them reliably — its HTTP status codes are
 * actively misleading (a nonexistent task returns `401 Team not authorized`, so an agent
 * reports a permissions problem when the user simply typo'd an ID). The `ECODE` field is
 * stable and discriminating where the status code is not, so that is what we key off.
 */

export interface ErrorParts {
  /** What went wrong, in one line. */
  what: string;
  /** What to do about it. Omitted only when genuinely nothing is actionable. */
  fix?: string;
  /** Concrete valid values, when we know them. Rendered as a short list. */
  candidates?: string[];
  /** Machine-ish origin, for debugging. Never the primary message. */
  origin?: string;
  /**
   * Set for refusals that are structural rather than per-item — currently capability-profile
   * denials. These must never be swallowed into a partial-failure report: "3 of 4 succeeded"
   * reads as a transient ClickUp problem, when the truth is that this connection is not
   * permitted to do it at all and retrying will never help.
   */
  code?: 'policy';
}

/**
 * A failure that is safe and useful to show an agent verbatim.
 *
 * `toolMessage()` is the rendered form. It leads with the problem, then the fix, then
 * candidates — the order an agent needs them in.
 */
export class ClickUpToolError extends Error {
  readonly fix?: string;
  readonly candidates?: string[];
  readonly origin?: string;
  readonly code?: 'policy';

  constructor(parts: ErrorParts) {
    super(parts.what);
    this.name = 'ClickUpToolError';
    this.fix = parts.fix;
    this.candidates = parts.candidates;
    this.origin = parts.origin;
    this.code = parts.code;
  }

  toolMessage(): string {
    const out = [this.message];
    if (this.fix) out.push(`Fix: ${this.fix}`);
    if (this.candidates?.length) {
      const shown = this.candidates.slice(0, MAX_CANDIDATES);
      const more = this.candidates.length - shown.length;
      out.push(`Valid options: ${shown.join(', ')}${more > 0 ? ` … and ${more} more` : ''}`);
    }
    if (this.origin) out.push(`(${this.origin})`);
    return out.join('\n');
  }
}

const MAX_CANDIDATES = 25;

/**
 * ClickUp `ECODE` → what actually happened.
 *
 * The `misleading` flag marks codes whose HTTP status tells a different story than the truth;
 * those are the ones worth overriding rather than passing through.
 */
interface CodeMeaning {
  what: (ctx: RequestContext) => string;
  fix?: (ctx: RequestContext) => string;
}

export interface RequestContext {
  method: string;
  /** Path with IDs intact, for message building. Never includes the token. */
  path: string;
  /** Best-effort description of what the caller was addressing, e.g. `task 86bben08h`. */
  subject?: string;
}

const ECODE_MEANINGS: Record<string, CodeMeaning> = {
  OAUTH_017: {
    what: () => 'No ClickUp API token was sent.',
    fix: () => 'Set CLICKUP_API_TOKEN in the server environment and restart.',
  },
  OAUTH_025: {
    what: () => 'The ClickUp API token was rejected as invalid.',
    fix: () =>
      'Check CLICKUP_API_TOKEN. Personal tokens start with "pk_" and are found under ' +
      'ClickUp → Settings → Apps.',
  },
  OAUTH_027: {
    // The big one. ClickUp returns this with HTTP 401 for IDs that simply do not exist.
    what: (ctx) =>
      `${cap(ctx.subject ?? 'That object')} was not found, or this token cannot see it.`,
    fix: () =>
      'Most often the ID is wrong rather than the permissions. Re-resolve the name with ' +
      '`tree` or `find` and retry with the ID it reports.',
  },
  OAUTH_055: {
    what: (ctx) => `${cap(ctx.subject ?? 'That list')} does not exist.`,
    fix: () => 'Run `tree` to see the lists this token can reach.',
  },
  OAUTH_064: {
    what: () => 'This token is not authorised for that workspace.',
    fix: () => 'Run `whoami` to see which workspace the token belongs to.',
  },
  ITEMV2_003: {
    // Observed when an enum-ish query param is invalid — ClickUp answers HTTP 500.
    what: () => 'ClickUp rejected a query parameter (it answers these with a 500).',
    fix: () =>
      'Usually an invalid sort or filter value. Check `order_by` / `statuses` against ' +
      '`meta` for this list.',
  },
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Build a teaching error from a ClickUp error response body. */
export function fromApiError(
  status: number,
  body: unknown,
  ctx: RequestContext,
): ClickUpToolError {
  const parsed = parseErrorBody(body);
  const meaning = parsed.ecode ? ECODE_MEANINGS[parsed.ecode] : undefined;

  if (meaning) {
    return new ClickUpToolError({
      what: meaning.what(ctx),
      fix: meaning.fix?.(ctx),
      origin: `ClickUp ${status} ${parsed.ecode}`,
    });
  }

  // Unmapped. Fall back to the API's own words, but never present a misleading status as
  // though we endorse it.
  if (status === 429) {
    return new ClickUpToolError({
      what: 'ClickUp rate limit exceeded.',
      fix: 'The server retries these automatically; if you see this, retries were exhausted. Wait a minute and try a narrower query.',
      origin: `ClickUp 429${parsed.ecode ? ` ${parsed.ecode}` : ''}`,
    });
  }

  const detail = parsed.err ?? `HTTP ${status}`;
  return new ClickUpToolError({
    what: `ClickUp rejected the request: ${detail}`,
    fix:
      status >= 500
        ? 'This is usually a bad parameter rather than a ClickUp outage — check enum values against `meta`.'
        : 'Check the arguments against `meta` for this scope.',
    origin: `ClickUp ${status}${parsed.ecode ? ` ${parsed.ecode}` : ''} on ${ctx.method} ${ctx.path}`,
  });
}

function parseErrorBody(body: unknown): { err?: string; ecode?: string } {
  if (typeof body === 'string') {
    try {
      return parseErrorBody(JSON.parse(body));
    } catch {
      return { err: body.slice(0, 200) };
    }
  }
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    return {
      err: typeof b.err === 'string' ? b.err : undefined,
      ecode: typeof b.ECODE === 'string' ? b.ECODE : undefined,
    };
  }
  return {};
}

/** True when an error is a capability-profile refusal rather than a data problem. */
export function isPolicyDenial(err: unknown): boolean {
  return err instanceof ClickUpToolError && err.code === 'policy';
}

/**
 * A name did not resolve. This is the single most important error in the server: the
 * alternative is a confidently empty result, which is a wrong answer rather than a failure.
 */
export function unresolved(
  kind: string,
  query: string,
  candidates: string[],
  hint?: string,
): ClickUpToolError {
  return new ClickUpToolError({
    what: `No ${kind} matches ${JSON.stringify(query)}.`,
    fix:
      hint ??
      `Pick one of the ${kind}s below, or pass its ID directly. Returning no results would ` +
        `have been wrong — the ${kind} was never found, so nothing was actually searched.`,
    candidates,
  });
}

/** A name matched more than one thing. Guessing here silently corrupts the user's data. */
export function ambiguous(
  kind: string,
  query: string,
  candidates: string[],
): ClickUpToolError {
  return new ClickUpToolError({
    what: `${JSON.stringify(query)} matches ${candidates.length} ${kind}s.`,
    fix: `Qualify it with its parent (e.g. "Cavalry/Findings") or pass the ID.`,
    candidates,
  });
}

/** An enum-ish argument was invalid. Caught here because ClickUp answers these with a 500. */
export function badValue(
  field: string,
  value: string,
  candidates: string[],
): ClickUpToolError {
  return new ClickUpToolError({
    what: `${JSON.stringify(value)} is not a valid ${field}.`,
    fix: `Use one of the values below.`,
    candidates,
  });
}
