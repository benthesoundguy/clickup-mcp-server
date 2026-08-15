/**
 * Date handling.
 *
 * Agents write dates the way people do — "today", "next friday", "2026-09-01". ClickUp wants
 * unix milliseconds. Anything we cannot parse confidently is an error, never a silent
 * fallback to "now": a task quietly due today instead of next Friday is a wrong answer that
 * looks like a success.
 */

import { ClickUpToolError } from './errors.js';

const DAY_MS = 86_400_000;

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export interface ParsedDate {
  ms: number;
  /** Whether the caller specified a time of day, which ClickUp tracks separately. */
  hasTime: boolean;
}

/**
 * Parse a date the way a person wrote it.
 *
 * `now` is injectable so tests are not hostage to the wall clock.
 */
export function parseDate(input: string | number, now: number = Date.now()): ParsedDate {
  if (typeof input === 'number') {
    return { ms: normaliseEpoch(input), hasTime: true };
  }

  const raw = String(input).trim();
  const s = raw.toLowerCase();
  if (!s) throw badDate(raw);

  // Bare epoch
  if (/^\d{10}$|^\d{13}$/.test(s)) return { ms: normaliseEpoch(Number(s)), hasTime: true };

  const startOfToday = startOfDay(now);

  if (s === 'today') return { ms: startOfToday, hasTime: false };
  if (s === 'tomorrow') return { ms: startOfToday + DAY_MS, hasTime: false };
  if (s === 'yesterday') return { ms: startOfToday - DAY_MS, hasTime: false };

  // "in 3 days", "in 2 weeks"
  const rel = /^in\s+(\d+)\s+(day|week|month)s?$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    if (rel[2] === 'day') return { ms: startOfToday + n * DAY_MS, hasTime: false };
    if (rel[2] === 'week') return { ms: startOfToday + n * 7 * DAY_MS, hasTime: false };
    const d = new Date(startOfToday);
    d.setMonth(d.getMonth() + n);
    return { ms: d.getTime(), hasTime: false };
  }

  // "next friday" / "friday"
  const wd = /^(?:(next|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(s);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[2]);
    const current = new Date(startOfToday).getDay();
    let delta = (target - current + 7) % 7;
    // "friday" on a Friday means today; "next friday" always means the following week.
    if (wd[1] === 'next') delta = delta === 0 ? 7 : delta + 7;
    else if (delta === 0) delta = 0;
    return { ms: startOfToday + delta * DAY_MS, hasTime: false };
  }

  // ISO-ish: YYYY-MM-DD, optionally with a time
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw.trim());
  if (iso) {
    const [, y, mo, d, hh, mm, ss] = iso;
    const hasTime = hh !== undefined;
    // Construct in local time — a due date of "2026-09-01" means that day where the user is.
    const dt = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      hasTime ? Number(hh) : 0,
      hasTime ? Number(mm) : 0,
      ss ? Number(ss) : 0,
      0,
    );
    if (Number.isNaN(dt.getTime())) throw badDate(raw);
    // Reject a rolled-over date (2026-02-31 becomes March 3 otherwise).
    if (dt.getMonth() !== Number(mo) - 1 || dt.getDate() !== Number(d)) throw badDate(raw);
    return { ms: dt.getTime(), hasTime };
  }

  throw badDate(raw);
}

function badDate(raw: string): ClickUpToolError {
  return new ClickUpToolError({
    what: `Could not understand the date ${JSON.stringify(raw)}.`,
    fix:
      'Use YYYY-MM-DD (optionally "YYYY-MM-DD HH:MM"), or one of: today, tomorrow, ' +
      'yesterday, "next friday", "in 3 days", "in 2 weeks". Guessing was not safe here — a ' +
      'task due on the wrong day looks like a success.',
  });
}

function normaliseEpoch(n: number): number {
  // Seconds vs milliseconds: anything below ~2001 in ms is really seconds.
  return n < 1e11 ? n * 1000 : n;
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ms: number): number {
  return startOfDay(ms) + DAY_MS - 1;
}

export interface DueWindow {
  gt?: number;
  lt?: number;
  /** Set when the caller asked for tasks with no due date at all — a client-side filter. */
  none?: boolean;
  label: string;
}

/**
 * Turn a due-date expression into a window.
 *
 * Supports the shapes an agent actually reaches for: `overdue`, `today`, `week`, `none`,
 * a single day, or `A..B`.
 */
export function parseDueWindow(input: string, now: number = Date.now()): DueWindow {
  const s = input.trim().toLowerCase();
  const today = startOfDay(now);

  if (s === 'none' || s === 'unscheduled') return { none: true, label: 'no due date' };
  if (s === 'overdue') return { lt: today, label: 'overdue' };
  if (s === 'today') return { gt: today - 1, lt: today + DAY_MS, label: 'due today' };
  if (s === 'tomorrow') {
    return { gt: today + DAY_MS - 1, lt: today + 2 * DAY_MS, label: 'due tomorrow' };
  }
  if (s === 'week' || s === 'this week') {
    return { gt: today - 1, lt: today + 7 * DAY_MS, label: 'due within 7 days' };
  }
  if (s === 'month') {
    return { gt: today - 1, lt: today + 31 * DAY_MS, label: 'due within 31 days' };
  }

  const range = s.split('..');
  if (range.length === 2) {
    const a = parseDate(range[0], now);
    const b = parseDate(range[1], now);
    return { gt: a.ms - 1, lt: endOfDay(b.ms) + 1, label: `due ${range[0]}..${range[1]}` };
  }

  const one = parseDate(s, now);
  return { gt: one.ms - 1, lt: endOfDay(one.ms) + 1, label: `due ${s}` };
}
