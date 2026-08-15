/**
 * Capability profiles, enforced at the HTTP chokepoint.
 *
 * There are three layers of restriction, and only one of them is a security boundary:
 *
 *   1. Tool filtering      — which tools appear at all.        (tokens + tool selection)
 *   2. Action filtering    — which actions a tool advertises.  (tokens + honesty)
 *   3. **Write policy**    — what may actually leave the process.  ← the guarantee
 *
 * Layers 1 and 2 are for the model's benefit and depend on every tool being classified
 * correctly, forever, by every future contributor. Layer 3 does not: it inspects the actual
 * request on its way out, so a mistagged tool, a refactor, or a new endpoint added in six
 * months cannot widen a profile. "This agent cannot harm anything" is a claim about layer 3.
 *
 * Matching is **segment-exact**, never prefix-based, because ClickUp distinguishes
 *
 *     POST /list/{id}/task        create a task   (append — allowed for `agent`)
 *     POST /list/{id}/task/{id}   MOVE a task     (mutation — not allowed)
 *
 * by one trailing segment. A prefix match would silently grant the second.
 */

import { ClickUpToolError } from './errors.js';

export type Profile = 'read' | 'agent' | 'core' | 'full';

export const PROFILES: Profile[] = ['read', 'agent', 'core', 'full'];

/** Ordering, so a tool can declare the *lowest* profile that includes it. */
const RANK: Record<Profile, number> = { read: 0, agent: 1, core: 2, full: 3 };

export function profileAtLeast(actual: Profile, required: Profile): boolean {
  return RANK[actual] >= RANK[required];
}

export function parseProfile(raw: string | undefined): Profile {
  const p = (raw ?? '').trim().toLowerCase();
  if (!p) return 'full';
  if ((PROFILES as string[]).includes(p)) return p as Profile;
  throw new Error(
    `MCP_PROFILE=${JSON.stringify(raw)} is not valid. Use one of: ${PROFILES.join(', ')}.`,
  );
}

/**
 * A `METHOD /a/*​/b` pattern. `*` matches exactly one segment; the segment count must match,
 * which is what keeps create and move apart.
 */
export interface Pattern {
  method: string;
  segments: string[];
}

export function pattern(spec: string): Pattern {
  const [method, path] = spec.split(/\s+/, 2);
  return { method: method.toUpperCase(), segments: splitPath(path) };
}

function splitPath(p: string): string[] {
  return p.split('?')[0].split('/').filter(Boolean);
}

export function matches(pat: Pattern, method: string, path: string): boolean {
  if (pat.method !== method.toUpperCase()) return false;
  const segs = splitPath(path);
  if (segs.length !== pat.segments.length) return false;
  return pat.segments.every((s, i) => s === '*' || s === segs[i]);
}

/**
 * Append-only writes.
 *
 * Every entry here creates a **new** object. Nothing on this list alters or destroys anything
 * that already exists — that is the whole definition of the `agent` profile, and the reason
 * each exclusion below is deliberate rather than accidental.
 */
const APPEND_WRITES: Pattern[] = [
  'POST /list/*/task', // create a task — NOT /list/*/task/* which is a move
  'POST /task/*/comment', // add a comment
  'POST /task/*/checklist', // add a checklist
  'POST /checklist/*/checklist_item', // add an item
  'POST /team/*/time_entries', // log a completed entry — NOT /start or /stop
  'POST /workspaces/*/chat/channels/*/messages', // post a message
  'UPLOAD /task/*/attachment', // upload a file
].map(pattern);

/**
 * Deliberately excluded from `agent`, with reasons, because several of these *look* additive:
 *
 *   POST /task/*​/tag/*        attaches a tag to an EXISTING task — mutation
 *   POST /task/*​/dependency   rewrites the relationship on BOTH tasks — mutation
 *   POST /task/*​/link/*       same
 *   POST /task/*​/field/*      sets a custom field on an existing task — mutation
 *   POST /list/*​/task/*       "add to list" — this is the move endpoint
 *   POST /space/*​/folder      creates workspace structure, not agent output
 *   POST /space/*​/list        "
 *   POST /folder/*​/list       "
 *   POST /team/*​/goal         goals are a planning artefact, not agent output
 *   POST /team/*​/user|guest   membership, and billing
 *   POST /team/*​/webhook      additive, but starts streaming data to an EXTERNAL endpoint —
 *                             the clearest proof that "append-only" and "safe" differ
 *   POST /team/*​/time_entries/start|stop
 *                             start leaves a running timer that only `stop` can close, and
 *                             stop mutates an existing entry. Only whole `log` entries append.
 */

/** Membership and webhook administration — everything `core` must not reach. */
const ADMIN_PATHS: Pattern[] = [
  'GET /group',
  'GET /team/*/seats',
  'GET /team/*/guest/*',
  'POST /team/*/user',
  'POST /team/*/user/*',
  'PUT /team/*/user/*',
  'DELETE /team/*/user/*',
  'POST /team/*/guest',
  'DELETE /team/*/guest/*',
  'POST /guest/*/*/*',
  'DELETE /guest/*/*/*',
  'GET /team/*/webhook',
  'POST /team/*/webhook',
  'DELETE /webhook/*',
].map(pattern);

export interface WritePolicy {
  profile: Profile;
  /** GET is permitted unless it matches one of these. */
  denyReads: Pattern[];
  /** `'all'` permits any write not in `denyWrites`; a list permits only those. */
  allowWrites: Pattern[] | 'all';
  denyWrites: Pattern[];
}

export const POLICIES: Record<Profile, WritePolicy> = {
  read: {
    profile: 'read',
    denyReads: [],
    allowWrites: [], // nothing at all
    denyWrites: [],
  },
  agent: {
    profile: 'agent',
    denyReads: [],
    allowWrites: APPEND_WRITES,
    denyWrites: [],
  },
  core: {
    profile: 'core',
    denyReads: ADMIN_PATHS,
    allowWrites: 'all',
    denyWrites: ADMIN_PATHS,
  },
  full: {
    profile: 'full',
    denyReads: [],
    allowWrites: 'all',
    denyWrites: [],
  },
};

/**
 * Decide whether a request may leave the process.
 *
 * Called on every request, including uploads. Returns `null` when permitted, or the error the
 * agent should see.
 */
/** `%2F` / `%5C` — an encoded path separator hiding inside what looks like one segment. */
const ENCODED_SEPARATOR = /%(?:2f|5c)/i;

/** Give up after this many decode rounds; nothing legitimate needs even one. */
const MAX_DECODE_ROUNDS = 5;

/**
 * True when *any* layer of decoding reveals a path separator.
 *
 * Testing the literal string alone is not enough: `%252F` decodes to `%2F`, which decodes to
 * `/`. The single-encoded form was caught but the double-encoded one sailed through, because
 * the regex looks for `%` followed by `2f` and finds `%` followed by `25`. Peeling one layer at
 * a time and re-testing catches every depth rather than just the next one.
 *
 * Fails closed on malformed encoding: a path we cannot decode is a path whose segment
 * boundaries we cannot reason about, and this is the branch where the safe answer is no.
 */
function hidesSeparator(path: string): boolean {
  let cur = path;
  for (let i = 0; i < MAX_DECODE_ROUNDS; i++) {
    if (ENCODED_SEPARATOR.test(cur)) return true;
    let next: string;
    try {
      next = decodeURIComponent(cur);
    } catch {
      return true;
    }
    if (next === cur) return false;
    cur = next;
  }
  return true;
}

/**
 * Decode one layer of percent-encoding per segment.
 *
 * Used only to re-test *deny* rules: if a segment decodes into something containing a
 * separator, an attacker may be relying on the origin normalising the path differently than we
 * do, so the denied form must be checked as well as the literal one.
 */
function decodedForm(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join('/');
}

export function checkPolicy(
  policy: WritePolicy,
  method: string,
  path: string,
): ClickUpToolError | null {
  const m = method.toUpperCase();
  // Compare deny rules against both the literal path and its decoded form. Otherwise
  // `/team/9001%2Fuser` could sail past a rule written for `/team/*/user` on any origin that
  // normalises before routing.
  const decoded = decodedForm(path);
  const denied = (rules: Pattern[]) =>
    rules.some((p) => matches(p, m, path) || matches(p, m, decoded));

  if (m === 'GET') {
    if (denied(policy.denyReads)) {
      return blocked(policy, m, path, 'reading that is outside this profile');
    }
    return null;
  }

  if (denied(policy.denyWrites)) {
    return blocked(policy, m, path, 'that administrative change is outside this profile');
  }

  if (policy.allowWrites === 'all') return null;

  // An allowlisted profile must never grant a path whose segment boundaries are ambiguous.
  // `/list/1%2Ftask%2Fvictim/task` reads as three segments here and possibly as five at the
  // origin; when those two readings can differ, the safe answer is no. Nothing legitimate on
  // the append allowlist takes a segment containing an encoded separator — they are all IDs.
  if (hidesSeparator(path)) {
    return blocked(
      policy,
      m,
      path,
      'the path contains an encoded separator, so its segment boundaries are ambiguous',
    );
  }

  if (policy.allowWrites.some((p) => matches(p, m, path))) return null;

  return blocked(
    policy,
    m,
    path,
    policy.profile === 'read'
      ? 'this profile is read-only'
      : 'this profile may only ADD new objects, never alter or delete existing ones',
  );
}

function blocked(
  policy: WritePolicy,
  method: string,
  path: string,
  why: string,
): ClickUpToolError {
  return new ClickUpToolError({
    what: `Blocked by the "${policy.profile}" profile: ${why}.`,
    fix:
      `The server is running with MCP_PROFILE=${policy.profile}. This is a deliberate ` +
      `capability limit, not a bug or a permissions problem in ClickUp — the request was ` +
      `stopped here and never sent. If this operation is genuinely wanted, run a connection ` +
      `with a higher profile (${PROFILES.join(' < ')}).`,
    origin: `${method} ${path}`,
    code: 'policy',
  });
}

/** Human-readable summary, for `whoami` and the startup banner. */
export function describeProfile(p: Profile): string {
  switch (p) {
    case 'read':
      return 'read — observation only; no write of any kind can leave this process';
    case 'agent':
      return 'agent — read, plus append-only writes (create tasks, comments, chat messages, checklist items, time logs, attachments). Cannot alter or delete anything that already exists';
    case 'core':
      return 'core — everything a normal user does; no membership, guest or webhook administration';
    case 'full':
      return 'full — unrestricted, including membership and webhooks';
  }
}
