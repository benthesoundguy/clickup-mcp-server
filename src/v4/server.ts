/**
 * v4 server assembly.
 *
 * Every tool returns plain text and throws `ClickUpToolError` for anything an agent should
 * read. The wrapper here is the only place that converts a throw into an MCP error payload,
 * so no tool has to remember to format its own failures.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ClickUpHttp, type Clock } from './core/http.js';
import { TtlCache } from './core/cache.js';
import { Resolver } from './core/resolve.js';
import { ClickUpToolError } from './core/errors.js';
import type { Ctx, ToolDef, Restriction } from './tools/registry.js';
import { POLICIES, describeProfile, DEFAULT_PROFILE, type Profile } from './core/policy.js';
import { toolsFor } from './tools/profiles.js';
import { taskTools } from './tools/tasks.js';
import { structureTools } from './tools/structure.js';
import { extraTools } from './tools/extras.js';
import { extendedTools } from './tools/extended.js';

export { SERVER_VERSION } from './core/version.js';
import { SERVER_VERSION } from './core/version.js';

export const allTools: ToolDef[] = [
  ...taskTools,
  ...structureTools,
  ...extraTools,
  ...extendedTools,
];

/** Responses above this are truncated; Claude Code caps tool results at 25k tokens. */
const MAX_RESPONSE_CHARS = 60_000;

export interface BuildOptions {
  token: string;
  /** Capability profile. Defaults to `core` — see DEFAULT_PROFILE. */
  profile?: Profile;
  /** Override the API root. Exists so tests can point at a stub instead of the live API. */
  baseUrl?: string;
  workspaceId?: string;
  clock?: Clock;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
  cacheTtlMs?: number;
  /**
   * Canonical directory local file reads are confined to, already resolved by
   * `resolveSandbox`. `null`/omitted means no confinement, which also withholds `attach`
   * from the `agent` profile. See `core/localfile.ts`.
   */
  attachRoot?: string | null;
}

export interface BuiltServer {
  server: McpServer;
  ctx: Ctx;
}

export function buildContext(opts: BuildOptions): Ctx {
  const log = opts.log ?? (() => {});
  const http = new ClickUpHttp({
    token: opts.token,
    policy: POLICIES[opts.profile ?? DEFAULT_PROFILE],
    baseUrl: opts.baseUrl ?? process.env.CLICKUP_API_BASE?.trim() ?? undefined,
    clock: opts.clock,
    fetchImpl: opts.fetchImpl,
    onLog: log,
  });
  const cache = new TtlCache(opts.cacheTtlMs ?? 5 * 60 * 1000, opts.now ?? Date.now);
  const workspaceId = opts.workspaceId ?? '';
  const resolver = new Resolver(http, cache, workspaceId);
  return {
    http,
    resolver,
    cache,
    workspaceId,
    profile: opts.profile ?? DEFAULT_PROFILE,
    attachRoot: opts.attachRoot ?? null,
    now: opts.now ?? Date.now,
    log,
  };
}

/**
 * The workspace ID is discoverable, so requiring it as an environment variable — or worse, as
 * a tool argument the way v3 did — is a papercut with no upside. Resolve it once at startup.
 */
export async function discoverWorkspaceId(ctx: Ctx): Promise<string> {
  if (ctx.workspaceId) return ctx.workspaceId;
  const idx = await ctx.resolver.index();
  return idx.workspaceId;
}

/**
 * Build an MCP server around an *existing* context.
 *
 * This split matters for stateless HTTP mode, which creates a fresh `McpServer` per request.
 * Building a fresh context alongside it would rebuild the workspace index on every single
 * request — six API calls each, against a 100/minute budget. The protocol object is
 * per-request; the cache, resolver and rate governor are per-process.
 */
export function buildServerWithContext(ctx: Ctx): McpServer {
  return assemble(ctx);
}

/**
 * Narrow a tool's schema for a profile.
 *
 * Omitted keys are simply absent, so the model never sees an argument it cannot use; the
 * `action` enum is rebuilt from the permitted subset, so the schema tells the truth about what
 * this connection can do rather than advertising actions that would be refused.
 */
function narrow(tool: ToolDef, r: Restriction): ToolDef {
  const schema: Record<string, unknown> = { ...tool.schema };
  for (const key of r.omit ?? []) delete schema[key];
  if (r.actions?.length && schema.action) {
    schema.action = z.enum(r.actions as [string, ...string[]]);
  }
  return {
    ...tool,
    schema: schema as ToolDef['schema'],
    description: r.note ? `${tool.description} — ${r.note}` : tool.description,
  };
}

export function buildServer(opts: BuildOptions): BuiltServer {
  const ctx = buildContext(opts);
  return { server: assemble(ctx), ctx };
}

function assemble(ctx: Ctx): McpServer {
  const server = new McpServer(
    { name: 'clickup', version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        'ClickUp, addressed by name. Lists are "Space/Folder/List" paths or bare names; ' +
        'assignees are usernames or "me"; statuses are the words shown in ClickUp. ' +
        'Start with `tree` to see what exists and `meta` to see what values a list accepts. ' +
        'Unresolvable names raise an error listing the valid options rather than returning ' +
        'an empty result. ' +
        `Capability profile: ${describeProfile(ctx.profile)}.` +
        (ctx.attachRoot ? ` Attachments may only be read from ${ctx.attachRoot}.` : ''),
    },
  );

  for (const tool of toolsFor(allTools, ctx.profile, narrow, {
    hasSandbox: ctx.attachRoot !== null,
  })) {
    server.tool(tool.name, tool.description, tool.schema, async (args: unknown) => {
      try {
        const text = await tool.handler((args ?? {}) as Record<string, unknown>, ctx);
        const capped =
          text.length > MAX_RESPONSE_CHARS
            ? `${text.slice(0, MAX_RESPONSE_CHARS)}\n\n… response truncated at ${MAX_RESPONSE_CHARS} characters. Narrow the query — add a scope, a status filter, or a smaller limit.`
            : text;
        return { content: [{ type: 'text' as const, text: capped }] };
      } catch (err) {
        if (err instanceof ClickUpToolError) {
          ctx.log(`tool ${tool.name} failed: ${err.message}`);
          return {
            content: [{ type: 'text' as const, text: err.toolMessage() }],
            isError: true,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log(`tool ${tool.name} crashed: ${msg}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `The ${tool.name} tool failed unexpectedly: ${msg}\nFix: this is a bug in the server, not in your arguments. Retry once; if it persists, report it.`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  return server;
}
