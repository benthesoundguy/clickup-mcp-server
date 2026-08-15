import type { ZodRawShape } from 'zod';
import type { ClickUpHttp } from '../core/http.js';
import type { Resolver } from '../core/resolve.js';
import type { TtlCache } from '../core/cache.js';
import type { Profile } from '../core/policy.js';
export type { Profile };

export interface Ctx {
  http: ClickUpHttp;
  resolver: Resolver;
  cache: TtlCache;
  workspaceId: string;
  profile: Profile;
  now: () => number;
  log: (msg: string) => void;
}

/** Per-profile narrowing of a tool's schema. */
export interface Restriction {
  /** Replace the `action` enum with just these values. */
  actions?: string[];
  /** Drop these schema keys entirely (e.g. `text` on `comment` in read mode). */
  omit?: string[];
  /** Appended to the description so the narrowing is visible, not surprising. */
  note?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: ZodRawShape;
  /** Lowest profile that includes this tool at all. Defaults to `core`. */
  minProfile?: Profile;
  /** Narrowed schemas for profiles below the tool's natural home. */
  restrict?: Partial<Record<Profile, Restriction>>;
  /** Returns the text the agent sees. Throwing a ClickUpToolError renders its teaching form. */
  handler: (args: Record<string, unknown>, ctx: Ctx) => Promise<string>;
}
