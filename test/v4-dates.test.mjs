/**
 * Date parsing.
 *
 * This module had no direct tests before round 5, which is how an unbounded epoch survived: any
 * number at all became a due date, so `-5` silently meant 1969 and an over-long value meant the
 * year 5138. Both render as a success, and a task quietly due on the wrong day is exactly the
 * confidently-wrong answer the whole server is built to refuse.
 *
 * `now` is injected everywhere so none of this is hostage to the wall clock.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseDate, parseDueWindow, startOfDay, endOfDay } from '../build/v4/core/dates.js';

/** Saturday 15 August 2026, 13:30 local. */
const NOW = new Date(2026, 7, 15, 13, 30).getTime();
const day = (y, m, d) => new Date(y, m, d).getTime();

describe('epoch inputs are bounded', () => {
  test('a negative epoch is refused, not silently turned into 1969', () => {
    assert.throws(() => parseDate(-5, NOW), /not a plausible date/);
  });

  test('zero is refused', () => {
    assert.throws(() => parseDate(0, NOW), /not a plausible date/);
  });

  test('an over-long epoch is refused, not turned into the year 5138', () => {
    assert.throws(() => parseDate(99_999_999_999_999, NOW), /not a plausible date/);
    assert.throws(() => parseDate('9999999999999', NOW), /not a plausible date/);
  });

  test('NaN and Infinity are refused', () => {
    assert.throws(() => parseDate(Number.NaN, NOW), /not a plausible date/);
    assert.throws(() => parseDate(Number.POSITIVE_INFINITY, NOW), /not a plausible date/);
  });

  test('the error teaches the accepted form', () => {
    try {
      parseDate(-5, NOW);
      assert.fail('should have thrown');
    } catch (err) {
      const msg = err.toolMessage();
      assert.match(msg, /seconds or milliseconds/);
      assert.match(msg, /YYYY-MM-DD/);
    }
  });

  test('plausible epochs still work, in both seconds and milliseconds', () => {
    const ms = day(2026, 7, 6);
    assert.equal(parseDate(ms, NOW).ms, ms);
    assert.equal(parseDate(Math.floor(ms / 1000), NOW).ms, ms);
    // The string forms the regex accepts: 10 digits and 13 digits.
    assert.equal(parseDate(String(Math.floor(ms / 1000)), NOW).ms, ms);
    assert.equal(parseDate(String(ms), NOW).ms, ms);
  });

  test('an epoch counts as having a time of day', () => {
    assert.equal(parseDate(day(2026, 7, 6), NOW).hasTime, true);
  });
});

describe('calendar dates', () => {
  test('a plain ISO date is that day, locally', () => {
    const r = parseDate('2026-09-01', NOW);
    assert.equal(r.ms, day(2026, 8, 1));
    assert.equal(r.hasTime, false);
  });

  test('a date with a time keeps the time', () => {
    const r = parseDate('2026-09-01 14:30', NOW);
    assert.equal(r.ms, new Date(2026, 8, 1, 14, 30).getTime());
    assert.equal(r.hasTime, true);
  });

  test('a day that does not exist is refused rather than rolled over', () => {
    // Date() would turn 2026-02-31 into March 3 without complaint.
    assert.throws(() => parseDate('2026-02-31', NOW), /Could not understand/);
    assert.throws(() => parseDate('2026-13-01', NOW), /Could not understand/);
    assert.throws(() => parseDate('2026-00-10', NOW), /Could not understand/);
  });

  test('a leap day is accepted in a leap year and refused otherwise', () => {
    assert.equal(parseDate('2028-02-29', NOW).ms, day(2028, 1, 29));
    assert.throws(() => parseDate('2026-02-29', NOW), /Could not understand/);
  });

  test('unparseable input errors rather than defaulting to now', () => {
    for (const bad of ['next next friday', 'sometime', '', '   ', 'in 3 fortnights', '01/09/2026']) {
      assert.throws(() => parseDate(bad, NOW), /Could not understand/, `accepted ${JSON.stringify(bad)}`);
    }
  });
});

describe('relative dates', () => {
  test('today, tomorrow, yesterday are midnight-anchored', () => {
    assert.equal(parseDate('today', NOW).ms, day(2026, 7, 15));
    assert.equal(parseDate('tomorrow', NOW).ms, day(2026, 7, 16));
    assert.equal(parseDate('yesterday', NOW).ms, day(2026, 7, 14));
    assert.equal(parseDate('today', NOW).hasTime, false, 'no time of day was specified');
  });

  test('"in N days/weeks/months"', () => {
    assert.equal(parseDate('in 3 days', NOW).ms, day(2026, 7, 18));
    assert.equal(parseDate('in 2 weeks', NOW).ms, day(2026, 7, 29));
    assert.equal(parseDate('in 1 month', NOW).ms, day(2026, 8, 15));
    assert.equal(parseDate('in 1 day', NOW).ms, day(2026, 7, 16), 'singular form');
  });

  test('a bare weekday means the next one, and today counts as today', () => {
    // NOW is a Saturday.
    assert.equal(parseDate('friday', NOW).ms, day(2026, 7, 21));
    assert.equal(parseDate('saturday', NOW).ms, day(2026, 7, 15), 'saturday on a Saturday is today');
  });

  test('"next friday" always means the following week', () => {
    assert.equal(parseDate('next friday', NOW).ms, day(2026, 7, 28));
    assert.equal(parseDate('next saturday', NOW).ms, day(2026, 7, 22));
  });

  test('case and surrounding space do not matter', () => {
    assert.equal(parseDate('  Next Friday  ', NOW).ms, day(2026, 7, 28));
    assert.equal(parseDate('TODAY', NOW).ms, day(2026, 7, 15));
  });
});

describe('due windows', () => {
  const today = day(2026, 7, 15);

  test('the named windows', () => {
    assert.deepEqual(parseDueWindow('none', NOW), { none: true, label: 'no due date' });
    assert.deepEqual(parseDueWindow('unscheduled', NOW), { none: true, label: 'no due date' });
    assert.equal(parseDueWindow('overdue', NOW).lt, today);
    assert.equal(parseDueWindow('today', NOW).gt, today - 1);
    assert.equal(parseDueWindow('week', NOW).lt, today + 7 * 86_400_000);
  });

  test('a single day becomes a whole-day window', () => {
    const w = parseDueWindow('2026-09-01', NOW);
    assert.equal(w.gt, day(2026, 8, 1) - 1);
    assert.equal(w.lt, endOfDay(day(2026, 8, 1)) + 1);
  });

  test('a range covers both endpoints inclusively', () => {
    const w = parseDueWindow('2026-09-01..2026-09-03', NOW);
    assert.equal(w.gt, day(2026, 8, 1) - 1);
    assert.equal(w.lt, endOfDay(day(2026, 8, 3)) + 1);
  });

  test('a bad endpoint in a range fails the whole window', () => {
    assert.throws(() => parseDueWindow('2026-09-01..whenever', NOW), /Could not understand/);
    assert.throws(() => parseDueWindow('2026-02-31..2026-09-03', NOW), /Could not understand/);
  });

  test('an implausible epoch endpoint is caught here too', () => {
    assert.throws(() => parseDueWindow('9999999999999', NOW), /not a plausible date/);
  });
});

describe('day boundaries', () => {
  test('startOfDay and endOfDay bracket exactly one day', () => {
    const s = startOfDay(NOW);
    assert.equal(s, day(2026, 7, 15));
    assert.equal(endOfDay(NOW) - s, 86_400_000 - 1);
  });
});
