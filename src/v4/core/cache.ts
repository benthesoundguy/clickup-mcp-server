/**
 * A small TTL cache.
 *
 * Deliberately in-memory only. The workspace index costs `2 + S` calls (5 on the reference
 * workspace) and is built once per process, so a disk cache would buy about one second of
 * cold start in exchange for on-disk state keyed by a hash of the API token. That trade isn't
 * worth it yet — revisit if a workspace turns up where the index is genuinely expensive.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache {
  private readonly map = new Map<string, Entry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly defaultTtlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get<T>(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): T {
    this.map.set(key, { value, expiresAt: this.now() + (ttlMs ?? this.defaultTtlMs) });
    return value;
  }

  /**
   * Memoise an async build. Concurrent callers share one in-flight build rather than each
   * firing their own — with a 5-call index build, a stampede is 5 wasted calls off a
   * 100/minute budget.
   */
  async remember<T>(key: string, build: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const p = build()
      .then((v) => {
        this.set(key, v, ttlMs);
        return v;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, p);
    return p;
  }

  invalidate(prefix?: string): void {
    if (!prefix) {
      this.map.clear();
      return;
    }
    for (const k of [...this.map.keys()]) {
      if (k.startsWith(prefix)) this.map.delete(k);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
