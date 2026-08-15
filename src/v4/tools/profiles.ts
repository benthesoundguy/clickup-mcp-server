/**
 * Which tools and actions each profile exposes.
 *
 * Deliberately a single table rather than metadata scattered across tool definitions: this is
 * the artefact a reviewer reads to answer "what can the agent profile do?", and that question
 * should be answerable from one screen.
 *
 * Note this table is an *ergonomics* layer — it decides what the model sees. The actual
 * guarantee is `core/policy.ts`, which inspects requests on their way out. If this table and
 * that policy ever disagree, the policy wins and the tool call fails loudly. `test/v4-profiles`
 * asserts they agree.
 */

import type { Profile, ToolDef } from './registry.js';
import type { Restriction } from './registry.js';

export interface ToolProfile {
  /** Lowest profile in which this tool appears at all. */
  min: Profile;
  /** Narrowed schema for profiles where the tool appears but must be limited. */
  restrict?: Partial<Record<Profile, Restriction>>;
  /**
   * Profiles at which this tool is withheld unless a local-file sandbox is configured.
   *
   * `attach` reads the local filesystem, a resource `core/policy.ts` cannot see, so the
   * append-only guarantee does not extend to it. There is no safe default root — the working
   * directory is typically the project directory, which is exactly where `.env` lives — so
   * under `agent` the operator must name one explicitly. See `core/localfile.ts`.
   */
  needsSandbox?: Profile[];
}

/** Environment facts that affect availability, separate from the profile itself. */
export interface ToolEnv {
  /** Whether CLICKUP_ATTACH_ROOT resolved to a usable directory. */
  hasSandbox: boolean;
}

const READ_ONLY_NOTE = 'Read-only under this profile.';

export const TOOL_PROFILES: Record<string, ToolProfile> = {
  // ---- pure reads: available everywhere -----------------------------------------------
  find: { min: 'read' },
  task: { min: 'read' },
  tree: { min: 'read' },
  meta: { min: 'read' },
  whoami: { min: 'read' },
  docs: { min: 'read' },

  // ---- mixed-mode: present from `read`, but narrowed --------------------------------
  // Dropping these from `read` entirely would cost a reporting agent the ability to read
  // comments, time reports and checklist state — most of what it needs.
  comment: {
    min: 'read',
    restrict: {
      read: { omit: ['text', 'assign_to'], note: `${READ_ONLY_NOTE} Posting is not available.` },
    },
  },
  chat: {
    min: 'read',
    restrict: {
      read: { actions: ['channels', 'read', 'members'], note: READ_ONLY_NOTE },
    },
  },
  time: {
    min: 'read',
    restrict: {
      read: { actions: ['current', 'report'], note: READ_ONLY_NOTE },
      // `log` records a completed entry, which is additive. `start` leaves a running timer
      // only `stop` can close, and `stop` mutates an existing entry — neither is append-only.
      agent: { actions: ['current', 'report', 'log'], note: 'Logging complete entries only.' },
    },
  },
  checklist: {
    min: 'read',
    restrict: {
      read: { actions: ['list'], note: READ_ONLY_NOTE },
      agent: {
        actions: ['list', 'add', 'add_item'],
        note: 'Additions only — items cannot be checked, renamed or removed.',
      },
    },
  },
  fields: {
    min: 'read',
    restrict: {
      // Setting a custom field mutates an existing task, so inspection only below `core`.
      read: { omit: ['task', 'field', 'value'], note: `${READ_ONLY_NOTE} Inspection only.` },
      agent: { omit: ['task', 'field', 'value'], note: 'Inspection only.' },
    },
  },

  // ---- append-only: `agent` and above ------------------------------------------------
  create: { min: 'agent' },
  attach: {
    min: 'agent',
    needsSandbox: ['agent'],
    restrict: {
      agent: { note: 'Files must be inside CLICKUP_ATTACH_ROOT.' },
    },
  },

  // ---- normal user work: `core` and above --------------------------------------------
  update: { min: 'core' },
  lists: { min: 'core' },
  goals: { min: 'core' },

  // ---- administration: `full` only ---------------------------------------------------
  people: { min: 'full' },
  webhooks: { min: 'full' },
};

const RANK: Record<Profile, number> = { read: 0, agent: 1, core: 2, full: 3 };

/**
 * Tools visible under a profile, already narrowed.
 *
 * `env` defaults to the restrictive reading — no sandbox — so a caller that forgets to pass it
 * withholds a capability rather than granting one.
 */
export function toolsFor(
  all: ToolDef[],
  profile: Profile,
  narrow: NarrowFn,
  env: ToolEnv = { hasSandbox: false },
): ToolDef[] {
  const out: ToolDef[] = [];
  for (const tool of all) {
    const spec = TOOL_PROFILES[tool.name];
    if (!spec) {
      // Fail closed: an untagged tool is a mistake, and the safe reading of a mistake is
      // "administrative", not "available to everyone".
      if (profile !== 'full') continue;
      out.push(tool);
      continue;
    }
    if (RANK[profile] < RANK[spec.min]) continue;
    if (spec.needsSandbox?.includes(profile) && !env.hasSandbox) continue;
    const restriction = spec.restrict?.[profile];
    out.push(restriction ? narrow(tool, restriction) : tool);
  }
  return out;
}

export type NarrowFn = (tool: ToolDef, r: Restriction) => ToolDef;
