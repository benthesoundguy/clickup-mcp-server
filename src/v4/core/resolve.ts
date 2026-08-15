/**
 * Name → ID resolution.
 *
 * This is the module that makes the whole server feel different. Every tool accepts what a
 * person would say — "Findings", "Cavalry/Findings", "Ben", "in progress" — and the ID
 * plumbing never appears in the transcript. Anthropic's tool-design guidance is blunt about
 * why this matters beyond ergonomics: resolving opaque alphanumeric IDs to meaningful names
 * measurably reduces hallucination in retrieval tasks.
 *
 * Two rules hold everywhere, and they are the reason to trust this thing:
 *
 *   1. **Nothing ever resolves to a guess.** If a name matches two lists, that is an error
 *      naming both, not a coin flip. Guessing here silently writes to the wrong list.
 *   2. **Failure to resolve is never an empty result.** The ClickUp API will happily answer
 *      `?assignees[]=99999999` with `{"tasks":[]}` — "Sam has no work" when the truth is
 *      "there is no Sam". Every unresolved name raises instead.
 *
 * Resolution is lazy: an ID costs zero calls, and only a bare ambiguous name needs the
 * full index.
 */

import { ClickUpHttp } from './http.js';
import { TtlCache } from './cache.js';
import { ambiguous, unresolved, ClickUpToolError } from './errors.js';
import { decodeEntities, rankCandidates } from './text.js';

export interface SpaceRef {
  id: string;
  name: string;
}
export interface FolderRef {
  id: string;
  name: string;
  spaceId: string;
  spaceName: string;
}
export interface ListRef {
  id: string;
  name: string;
  spaceId: string;
  spaceName: string;
  folderId?: string;
  folderName?: string;
  /** "Space/Folder/List" or "Space/List" — the canonical human address. */
  path: string;
  taskCount?: number;
}
export interface MemberRef {
  id: number;
  username: string;
  email: string;
}

export interface WorkspaceIndex {
  workspaceId: string;
  workspaceName: string;
  spaces: SpaceRef[];
  folders: FolderRef[];
  lists: ListRef[];
  members: MemberRef[];
  builtAt: number;
  /** How many API calls this index cost, for `whoami`. */
  cost: number;
}

const INDEX_KEY = 'workspace-index';
const INDEX_TTL_MS = 5 * 60 * 1000;

/** ClickUp space/folder/list IDs are long digit strings; task IDs are short alphanumerics. */
const NUMERIC_ID = /^\d{6,}$/;

export function looksLikeContainerId(s: string): boolean {
  return NUMERIC_ID.test(s.trim());
}

/**
 * Task IDs look like `86bben08h`. Custom IDs look like `ABC-123`. Neither is a safe thing to
 * guess wrong, so we only treat a string as a task ID when it cannot be a name — no spaces,
 * and either the ClickUp id shape or an explicit custom-id shape.
 */
export function looksLikeTaskId(s: string): boolean {
  const t = s.trim();
  if (/\s/.test(t)) return false;
  return /^[0-9a-z]{6,12}$/i.test(t) || /^[A-Za-z]+-\d+$/.test(t);
}

export class Resolver {
  constructor(
    private readonly http: ClickUpHttp,
    private readonly cache: TtlCache,
    private readonly workspaceId: string,
  ) {}

  /**
   * Build the whole addressable workspace in `2 + S` calls.
   *
   * The cheap path is `GET /team/{id}/folder`, which is not in ClickUp's published docs but
   * returns every folder in the workspace *with its lists embedded* — one call instead of one
   * per space plus one per folder. Folderless lists still need a per-space call.
   */
  index(): Promise<WorkspaceIndex> {
    return this.cache.remember(INDEX_KEY, () => this.buildIndex(), INDEX_TTL_MS);
  }

  private async buildIndex(): Promise<WorkspaceIndex> {
    let cost = 0;

    const teamRes = await this.http.get<{ teams: RawTeam[] }>('/team', 'the workspace');
    cost++;
    const team =
      teamRes.teams.find((t) => t.id === this.workspaceId) ?? teamRes.teams[0];
    if (!team) {
      throw new ClickUpToolError({
        what: 'This token can reach no ClickUp workspaces.',
        fix: 'Check that CLICKUP_API_TOKEN belongs to an account with at least one workspace.',
      });
    }

    const spacesRes = await this.http.get<{ spaces: RawSpace[] }>(
      `/team/${team.id}/space?archived=false`,
      'the workspace spaces',
    );
    cost++;
    const spaces: SpaceRef[] = (spacesRes.spaces ?? []).map((s) => ({
      id: s.id,
      name: decodeEntities(s.name),
    }));
    const spaceName = new Map(spaces.map((s) => [s.id, s.name]));

    const folderRes = await this.http.get<{ folders: RawFolder[] }>(
      `/team/${team.id}/folder?archived=false`,
      'the workspace folders',
    );
    cost++;

    const folders: FolderRef[] = [];
    const lists: ListRef[] = [];

    for (const f of folderRes.folders ?? []) {
      const sid = f.space?.id ?? '';
      const sname = spaceName.get(sid) ?? decodeEntities(f.space?.name ?? '?');
      const fname = decodeEntities(f.name);
      folders.push({ id: f.id, name: fname, spaceId: sid, spaceName: sname });
      for (const l of f.lists ?? []) {
        const lname = decodeEntities(l.name);
        lists.push({
          id: l.id,
          name: lname,
          spaceId: sid,
          spaceName: sname,
          folderId: f.id,
          folderName: fname,
          path: `${sname}/${fname}/${lname}`,
          taskCount: l.task_count ?? undefined,
        });
      }
    }

    // Folderless lists, one call per space. These are invisible to the folder index.
    const folderless = await Promise.all(
      spaces.map(async (s) => {
        const r = await this.http.get<{ lists: RawList[] }>(
          `/space/${s.id}/list?archived=false`,
          `space ${s.name}`,
        );
        return { space: s, lists: r.lists ?? [] };
      }),
    );
    cost += spaces.length;

    for (const { space, lists: ls } of folderless) {
      for (const l of ls) {
        const lname = decodeEntities(l.name);
        lists.push({
          id: l.id,
          name: lname,
          spaceId: space.id,
          spaceName: space.name,
          path: `${space.name}/${lname}`,
          taskCount: l.task_count ?? undefined,
        });
      }
    }

    const members: MemberRef[] = (team.members ?? [])
      .map((m) => m.user)
      .filter((u): u is RawUser => Boolean(u))
      .map((u) => ({
        id: u.id,
        username: decodeEntities(u.username ?? ''),
        email: u.email ?? '',
      }));

    return {
      workspaceId: team.id,
      workspaceName: decodeEntities(team.name),
      spaces,
      folders,
      lists,
      members,
      builtAt: Date.now(),
      cost,
    };
  }

  invalidate(): void {
    this.cache.invalidate(INDEX_KEY);
  }

  /** Resolve a list locator: an ID, a bare name, or a `Space/Folder/List` path. */
  async list(locator: string): Promise<ListRef> {
    const q = locator.trim();
    if (!q) {
      throw new ClickUpToolError({
        what: 'No list was given.',
        fix: 'Pass a list name, a "Space/Folder/List" path, or a list ID. `tree` shows them all.',
      });
    }

    const idx = await this.index();

    if (looksLikeContainerId(q)) {
      const known = idx.lists.find((l) => l.id === q);
      if (known) return known;
      // An ID we don't know may still be valid (archived, or created since the index was
      // built). Trust it — the API is the authority, and a wrong ID surfaces as a teaching
      // 404 rather than a silent wrong answer.
      return {
        id: q,
        name: q,
        spaceId: '',
        spaceName: '',
        path: q,
      };
    }

    const match = matchByPath(q, idx.lists, (l) => l.path);
    if (match.length === 1) return match[0];
    if (match.length === 0) {
      throw unresolved('list', q, rankCandidates(q, idx.lists.map((l) => l.path)));
    }
    throw ambiguous('list', q, match.map((l) => l.path).sort());
  }

  async space(locator: string): Promise<SpaceRef> {
    const q = locator.trim();
    const idx = await this.index();
    if (looksLikeContainerId(q)) {
      return idx.spaces.find((s) => s.id === q) ?? { id: q, name: q };
    }
    const match = matchByPath(q, idx.spaces, (s) => s.name);
    if (match.length === 1) return match[0];
    if (match.length === 0) {
      throw unresolved('space', q, rankCandidates(q, idx.spaces.map((s) => s.name)));
    }
    throw ambiguous('space', q, match.map((s) => s.name).sort());
  }

  async folder(locator: string): Promise<FolderRef> {
    const q = locator.trim();
    const idx = await this.index();
    if (looksLikeContainerId(q)) {
      const known = idx.folders.find((f) => f.id === q);
      if (known) return known;
      return { id: q, name: q, spaceId: '', spaceName: '' };
    }
    const match = matchByPath(q, idx.folders, (f) => `${f.spaceName}/${f.name}`);
    if (match.length === 1) return match[0];
    if (match.length === 0) {
      throw unresolved(
        'folder',
        q,
        rankCandidates(q, idx.folders.map((f) => `${f.spaceName}/${f.name}`)),
      );
    }
    throw ambiguous('folder', q, match.map((f) => `${f.spaceName}/${f.name}`).sort());
  }

  /**
   * Resolve an assignee. Accepts a username, an email, a numeric user ID, or "me".
   *
   * This is the highest-stakes resolution in the server: an unresolved assignee filter is
   * exactly the case where ClickUp returns a confident empty list.
   */
  async member(locator: string): Promise<MemberRef> {
    const q = locator.trim();
    const idx = await this.index();

    if (q.toLowerCase() === 'me' || q.toLowerCase() === 'myself') {
      const me = await this.me();
      return me;
    }
    if (/^\d+$/.test(q)) {
      const known = idx.members.find((m) => m.id === Number(q));
      if (known) return known;
      throw unresolved(
        'workspace member',
        q,
        idx.members.map((m) => `${m.username} <${m.email}> (${m.id})`),
        'That numeric ID is not a member of this workspace. Filtering by it would return an ' +
          'empty result that looks like "no tasks" but actually means "no such person".',
      );
    }

    const lower = q.toLowerCase();
    const exact = idx.members.filter(
      (m) => m.username.toLowerCase() === lower || m.email.toLowerCase() === lower,
    );
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) {
      throw ambiguous('member', q, exact.map((m) => `${m.username} <${m.email}>`));
    }

    const partial = idx.members.filter(
      (m) => m.username.toLowerCase().includes(lower) || m.email.toLowerCase().includes(lower),
    );
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) {
      throw ambiguous('member', q, partial.map((m) => `${m.username} <${m.email}>`));
    }

    throw unresolved(
      'workspace member',
      q,
      rankCandidates(q, idx.members.map((m) => `${m.username} <${m.email}>`)),
    );
  }

  async me(): Promise<MemberRef> {
    return this.cache.remember('me', async () => {
      const r = await this.http.get<{ user: RawUser }>('/user', 'the current user');
      return { id: r.user.id, username: r.user.username ?? '', email: r.user.email ?? '' };
    });
  }

  /**
   * The statuses a list actually accepts. Used to validate before writing, because ClickUp
   * answers an invalid status with a 500 or a silently wrong result depending on the endpoint.
   */
  async listStatuses(listId: string): Promise<string[]> {
    return this.cache.remember(`statuses:${listId}`, async () => {
      const r = await this.http.get<RawListDetail>(`/list/${listId}`, `list ${listId}`);
      return (r.statuses ?? []).map((s) => s.status);
    });
  }
}

/**
 * Match a locator against a set of paths, from the right.
 *
 * "Findings" matches `Agent PM/Cavalry/Findings`; so does "Cavalry/Findings"; so does the
 * full path. Exact segment matching is tried first across the whole set — a substring match
 * is only consulted when nothing matched exactly, so a list literally named "Docs" always
 * wins over one named "Docs archive".
 */
export function matchByPath<T>(query: string, items: T[], pathOf: (t: T) => string): T[] {
  const qSegs = query
    .split('/')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!qSegs.length) return [];

  const suffixMatch = (path: string, compare: (a: string, b: string) => boolean): boolean => {
    const pSegs = path.split('/').map((s) => s.trim().toLowerCase());
    if (qSegs.length > pSegs.length) return false;
    const tail = pSegs.slice(pSegs.length - qSegs.length);
    return qSegs.every((seg, i) => compare(tail[i], seg));
  };

  const exact = items.filter((it) => suffixMatch(pathOf(it), (a, b) => a === b));
  if (exact.length) return exact;

  return items.filter((it) => suffixMatch(pathOf(it), (a, b) => a.includes(b)));
}

interface RawUser {
  id: number;
  username?: string;
  email?: string;
}
interface RawTeam {
  id: string;
  name: string;
  members?: { user?: RawUser }[];
}
interface RawSpace {
  id: string;
  name: string;
}
interface RawList {
  id: string;
  name: string;
  task_count?: number;
}
interface RawFolder {
  id: string;
  name: string;
  space?: { id: string; name?: string };
  lists?: RawList[];
}
interface RawListDetail {
  statuses?: { status: string }[];
}
