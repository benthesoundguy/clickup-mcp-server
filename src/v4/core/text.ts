/**
 * Text handling for names that come back from ClickUp.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * ClickUp HTML-escapes names on the way out: a list called `Civic & Public Interest` arrives
 * as `Civic &amp; Public Interest`.
 *
 * Left alone, that name doesn't round-trip — an agent reads it from `tree`, passes it back as
 * a scope, and the literal string `&amp;` fails to match anything. Decode on the way in.
 */
export function decodeEntities(s: string): string {
  if (!s || !s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    const b = body.toLowerCase();
    if (b.startsWith('#x')) {
      const n = parseInt(body.slice(2), 16);
      return Number.isFinite(n) ? safeFromCodePoint(n, whole) : whole;
    }
    if (b.startsWith('#')) {
      const n = parseInt(body.slice(1), 10);
      return Number.isFinite(n) ? safeFromCodePoint(n, whole) : whole;
    }
    return ENTITIES[b] ?? whole;
  });
}

function safeFromCodePoint(n: number, fallback: string): string {
  if (n < 0 || n > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(n);
  } catch {
    return fallback;
  }
}

/**
 * Rank candidate paths by how plausibly they were what the caller meant.
 *
 * An alphabetical dump of 61 lists is technically complete and practically useless — the
 * caller who typed "Findigs" needs the three lists actually called "Findings" at the top, not
 * everything beginning with "A". Scored on the last path segment, since that's what people
 * type.
 */
export function rankCandidates(query: string, candidates: string[], max = 15): string[] {
  const q = lastSegment(query).toLowerCase();
  if (!q) return candidates.slice(0, max);

  const scored = candidates.map((c) => {
    const seg = lastSegment(c).toLowerCase();
    let score: number;
    if (seg === q) score = 0;
    else if (seg.startsWith(q)) score = 1;
    else if (seg.includes(q)) score = 2;
    else score = 3 + editDistance(seg, q) / Math.max(seg.length, q.length, 1);
    return { c, score };
  });

  scored.sort((a, b) => a.score - b.score || a.c.localeCompare(b.c));
  return scored.slice(0, max).map((s) => s.c);
}

function lastSegment(p: string): string {
  const parts = p.split('/');
  return (parts[parts.length - 1] ?? '').trim();
}

/** Levenshtein, iterative with a single row. Inputs here are short names. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}
