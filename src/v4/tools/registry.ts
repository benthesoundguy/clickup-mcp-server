import type { ZodRawShape } from 'zod';
import type { ClickUpHttp } from '../core/http.js';
import type { Resolver } from '../core/resolve.js';
import type { TtlCache } from '../core/cache.js';

export interface Ctx {
  http: ClickUpHttp;
  resolver: Resolver;
  cache: TtlCache;
  workspaceId: string;
  now: () => number;
  log: (msg: string) => void;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: ZodRawShape;
  /** Returns the text the agent sees. Throwing a ClickUpToolError renders its teaching form. */
  handler: (args: Record<string, unknown>, ctx: Ctx) => Promise<string>;
}
