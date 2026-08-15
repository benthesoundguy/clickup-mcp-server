/**
 * Structure and introspection: tree, meta, lists, whoami.
 *
 * `meta` is the load-bearing one. It exists so an agent can ask "what values are legal here?"
 * instead of guessing a status name and getting an empty result that reads like "no matches".
 */

import { z } from 'zod';
import type { Ctx, ToolDef } from './registry.js';
import { ClickUpToolError, unresolved } from '../core/errors.js';
import { renderTable } from '../core/format.js';

export const treeTool: ToolDef = {
  name: 'tree',
  description:
    'Show the workspace structure — spaces, folders and lists with their task counts. Use this ' +
    'to discover what exists and to get the exact list paths the other tools accept. ' +
    'Costs 2+S API calls and is cached for 5 minutes.',
  schema: {
    scope: z.string().optional().describe('Limit to one space, by name or ID'),
    match: z.string().optional().describe('Only show lists whose path contains this substring'),
  },
  async handler(args, ctx) {
    const idx = await ctx.resolver.index();

    let lists = idx.lists;
    if (typeof args.scope === 'string' && args.scope.trim()) {
      const space = await ctx.resolver.space(args.scope.trim());
      lists = lists.filter((l) => l.spaceId === space.id);
    }
    if (typeof args.match === 'string' && args.match.trim()) {
      const m = args.match.trim().toLowerCase();
      lists = lists.filter((l) => l.path.toLowerCase().includes(m));
    }

    if (!lists.length) {
      throw new ClickUpToolError({
        what: 'No lists matched.',
        fix: 'Drop the filters and run `tree` again to see everything this token can reach.',
        candidates: idx.lists.map((l) => l.path).sort().slice(0, 40),
      });
    }

    const rows = lists
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((l) => ({
        path: l.path,
        id: l.id,
        tasks: l.taskCount === undefined ? '' : String(l.taskCount),
      }));

    const header =
      `${idx.workspaceName} — ${idx.spaces.length} space${idx.spaces.length === 1 ? '' : 's'}, ` +
      `${idx.folders.length} folders, ${lists.length} list${lists.length === 1 ? '' : 's'}` +
      (lists.length !== idx.lists.length ? ` (of ${idx.lists.length})` : '');

    return renderTable(rows, ['path', 'id', 'tasks'], header);
  },
};

export const metaTool: ToolDef = {
  name: 'meta',
  description:
    'What values are legal here. Returns the statuses a list accepts, the tags available in a ' +
    'space, and the workspace members. Ask this before guessing a status or assignee name — ' +
    'ClickUp answers an unknown status with an empty result that looks like "no matches".',
  schema: {
    scope: z
      .string()
      .optional()
      .describe('List or space, by name/path/ID. Omit for workspace-level info (members).'),
  },
  async handler(args, ctx) {
    const idx = await ctx.resolver.index();
    const blocks: string[] = [];

    const scope = typeof args.scope === 'string' ? args.scope.trim() : '';

    if (scope) {
      let spaceId: string | undefined;
      let listId: string | undefined;
      let label = scope;

      const spaceHit = idx.spaces.find(
        (s) => s.name.toLowerCase() === scope.toLowerCase() || s.id === scope,
      );
      if (spaceHit) {
        spaceId = spaceHit.id;
        label = spaceHit.name;
      } else {
        const list = await ctx.resolver.list(scope);
        listId = list.id;
        spaceId = list.spaceId || undefined;
        label = list.path;
      }

      if (listId) {
        const statuses = await ctx.resolver.listStatuses(listId);
        blocks.push(`statuses accepted by ${label}:\n${statuses.join('\t') || '(none)'}`);
      }

      if (spaceId) {
        try {
          const tagRes = await ctx.http.get<{ tags?: { name: string }[] }>(
            `/space/${spaceId}/tag`,
            `space ${label}`,
          );
          const tags = (tagRes.tags ?? []).map((t) => t.name);
          blocks.push(`tags in this space (${tags.length}):\n${tags.join('\t') || '(none)'}`);
        } catch {
          // Tags are a space-level feature that some plans disable; absence isn't an error.
          blocks.push('tags: unavailable for this space');
        }
      }
    }

    blocks.push(
      renderTable(
        idx.members.map((m) => ({ name: m.username, email: m.email, id: String(m.id) })),
        ['name', 'email', 'id'],
        `workspace members (${idx.members.length}) — any of these work as an assignee, as does "me":`,
      ),
    );

    blocks.push('priorities:\nurgent\thigh\tnormal\tlow');
    return blocks.join('\n\n');
  },
};

export const listsTool: ToolDef = {
  name: 'lists',
  description:
    'Create, rename, or delete lists and folders. Deleting a list destroys every task in it, ' +
    'so `confirm: true` is required for any delete.',
  schema: {
    action: z.enum(['create', 'rename', 'delete']),
    kind: z.enum(['list', 'folder']).optional().describe('Default list'),
    name: z.string().optional().describe('New name (create/rename)'),
    parent: z
      .string()
      .optional()
      .describe('For create: the folder or space to create in, by name/path/ID'),
    target: z.string().optional().describe('For rename/delete: the list or folder to act on'),
    confirm: z.boolean().optional().describe('Required for delete'),
    from_template: z
      .string()
      .optional()
      .describe('For create: build the list from a saved template, by template name'),
  },
  async handler(args, ctx) {
    const kind = (args.kind as string) ?? 'list';
    const action = args.action as string;

    if (action === 'create') {
      const name = String(args.name ?? '').trim();
      if (!name) {
        throw new ClickUpToolError({ what: 'No name given.', fix: 'Pass name: "…".' });
      }
      const parentRaw = String(args.parent ?? '').trim();
      if (!parentRaw) {
        throw new ClickUpToolError({
          what: 'No parent given.',
          fix: `Pass parent: the ${kind === 'folder' ? 'space' : 'folder or space'} to create in. \`tree\` lists them.`,
        });
      }

      if (kind === 'folder') {
        const space = await ctx.resolver.space(parentRaw);
        const r = await ctx.http.post<{ id: string; name: string }>(
          `/space/${space.id}/folder`,
          { name },
          `space ${space.name}`,
        );
        ctx.resolver.invalidate();
        return `created folder ${space.name}/${r.name} (${r.id})`;
      }

      const tmplName = String(args.from_template ?? '').trim();
      if (tmplName) {
        const tmpl = await resolveTemplate(ctx, tmplName);
        let created: { id: string; name?: string };
        let where: string;
        try {
          const folder = await ctx.resolver.folder(parentRaw);
          created = await ctx.http.post(
            `/folder/${folder.id}/list/template/${tmpl.id}`,
            { name },
            `folder ${folder.name}`,
          );
          where = `${folder.spaceName}/${folder.name}`;
        } catch {
          const space = await ctx.resolver.space(parentRaw);
          created = await ctx.http.post(
            `/space/${space.id}/list/template/${tmpl.id}`,
            { name },
            `space ${space.name}`,
          );
          where = space.name;
        }
        ctx.resolver.invalidate();
        return `created list ${where}/${name} from template "${tmpl.name}" (${created.id})`;
      }

      // A list can live in a folder or directly in a space; try folder first, then space.
      let created: { id: string; name: string };
      let where: string;
      try {
        const folder = await ctx.resolver.folder(parentRaw);
        created = await ctx.http.post(`/folder/${folder.id}/list`, { name }, `folder ${folder.name}`);
        where = `${folder.spaceName}/${folder.name}`;
      } catch {
        const space = await ctx.resolver.space(parentRaw);
        created = await ctx.http.post(`/space/${space.id}/list`, { name }, `space ${space.name}`);
        where = space.name;
      }
      ctx.resolver.invalidate();
      return `created list ${where}/${created.name} (${created.id})`;
    }

    const targetRaw = String(args.target ?? '').trim();
    if (!targetRaw) {
      throw new ClickUpToolError({
        what: 'No target given.',
        fix: `Pass target: the ${kind} to ${action}.`,
      });
    }

    if (action === 'rename') {
      const name = String(args.name ?? '').trim();
      if (!name) throw new ClickUpToolError({ what: 'No new name given.', fix: 'Pass name: "…".' });
      if (kind === 'folder') {
        const f = await ctx.resolver.folder(targetRaw);
        await ctx.http.put(`/folder/${f.id}`, { name }, `folder ${f.name}`);
        ctx.resolver.invalidate();
        return `renamed folder ${f.spaceName}/${f.name} → ${name}`;
      }
      const l = await ctx.resolver.list(targetRaw);
      await ctx.http.put(`/list/${l.id}`, { name }, `list ${l.path}`);
      ctx.resolver.invalidate();
      return `renamed list ${l.path} → ${name}`;
    }

    // delete
    if (args.confirm !== true) {
      const l =
        kind === 'folder'
          ? await ctx.resolver.folder(targetRaw)
          : await ctx.resolver.list(targetRaw);
      const label = 'path' in l ? l.path : `${l.spaceName}/${l.name}`;

      // Count live rather than trusting the cached index. This is the confirmation prompt for
      // an irreversible action, and the index's task_count has been observed disagreeing with
      // what the list actually contains — the one number here that must not be a guess.
      let count = '';
      if (kind === 'list') {
        try {
          const res = await ctx.http.get<{ tasks?: unknown[] }>(
            `/list/${l.id}/task?include_closed=true`,
            `list ${label}`,
          );
          const n = res.tasks?.length ?? 0;
          count = ` (${n === 100 ? '100+' : n} task${n === 1 ? '' : 's'})`;
        } catch {
          count = ' (task count unavailable)';
        }
      }

      throw new ClickUpToolError({
        what: `Deleting ${kind} ${label}${count} would destroy everything in it, permanently.`,
        fix: 'Re-run with confirm: true if that is genuinely intended.',
      });
    }

    if (kind === 'folder') {
      const f = await ctx.resolver.folder(targetRaw);
      await ctx.http.delete(`/folder/${f.id}`, `folder ${f.name}`);
      ctx.resolver.invalidate();
      return `deleted folder ${f.spaceName}/${f.name}`;
    }
    const l = await ctx.resolver.list(targetRaw);
    await ctx.http.delete(`/list/${l.id}`, `list ${l.path}`);
    ctx.resolver.invalidate();
    return `deleted list ${l.path}`;
  },
};

export const whoamiTool: ToolDef = {
  name: 'whoami',
  description:
    'Identity, workspace, and server health — who the token belongs to, how much of the ' +
    'ClickUp rate budget is left, and what is cached.',
  schema: {},
  async handler(_args, ctx) {
    const me = await ctx.resolver.me();
    const idx = await ctx.resolver.index();
    const stats = ctx.http.stats();
    const rate = stats.rate;

    const lines = [
      `user: ${me.username} <${me.email}> (${me.id})`,
      `workspace: ${idx.workspaceName} (${idx.workspaceId})`,
      `structure: ${idx.spaces.length} spaces, ${idx.folders.length} folders, ${idx.lists.length} lists`,
      `index cost: ${idx.cost} API calls, built ${Math.round((Date.now() - idx.builtAt) / 1000)}s ago`,
      `requests this session: ${stats.requests} (retries ${stats.retries}, throttle waits ${stats.throttleWaits})`,
      rate.remaining !== null
        ? `rate budget: ${rate.remaining}/${rate.limit ?? '?'} remaining${
            rate.resetAt ? `, resets in ${Math.max(0, Math.round((rate.resetAt - Date.now()) / 1000))}s` : ''
          }`
        : 'rate budget: not yet observed',
      `cache entries: ${ctx.cache.size}`,
    ];
    return lines.join('\n');
  },
};

/** Resolve a task template by name. ClickUp exposes these read-only, one page at a time. */
async function resolveTemplate(ctx: Ctx, name: string): Promise<{ id: string; name: string }> {
  const r = await ctx.http.get<{ templates?: { id?: string; name?: string }[] }>(
    `/team/${ctx.workspaceId}/taskTemplate?page=0`,
    'the task templates',
  );
  const all = (r.templates ?? []).filter((t) => t.id && t.name);
  const lower = name.toLowerCase();
  const exact = all.filter((t) => (t.name ?? '').toLowerCase() === lower);
  if (exact.length === 1) return { id: exact[0].id!, name: exact[0].name! };
  const partial = all.filter((t) => (t.name ?? '').toLowerCase().includes(lower));
  if (partial.length === 1) return { id: partial[0].id!, name: partial[0].name! };
  if (exact.length > 1 || partial.length > 1) {
    throw new ClickUpToolError({
      what: `${JSON.stringify(name)} matches more than one template.`,
      fix: 'Use the exact template name.',
      candidates: (exact.length > 1 ? exact : partial).map((t) => t.name!),
    });
  }
  throw unresolved('task template', name, all.map((t) => t.name!));
}

export const structureTools: ToolDef[] = [treeTool, metaTool, listsTool, whoamiTool];
