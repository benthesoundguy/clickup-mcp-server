/**
 * The ClickUp HTTP layer, with a rate-limit governor.
 *
 * ClickUp allows ~100 requests/minute *per token* — shared by every client using that token,
 * not per connection. It reports the live budget on every response:
 *
 *     x-ratelimit-limit: 100
 *     x-ratelimit-remaining: 98
 *     x-ratelimit-reset: 1786782276     (unix seconds)
 *
 * so throttling can be adaptive rather than guessed. We stay off the last few requests of a
 * window by default: something else on this token (a webhook, another agent, the user's own
 * browser) may be spending it concurrently, and the failure mode of running the budget to
 * zero is a hard lockout.
 *
 * Clock and fetch are injectable so the backoff logic is testable without real waiting.
 */

import { fromApiError, ClickUpToolError, type RequestContext } from './errors.js';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export interface HttpOptions {
  token: string;
  baseUrl?: string;
  clock?: Clock;
  fetchImpl?: typeof fetch;
  /** Leave this many requests unspent in each window as headroom for other clients. */
  reserve?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  maxRetries?: number;
  onLog?: (msg: string) => void;
}

export interface RateState {
  limit: number | null;
  remaining: number | null;
  /** Unix ms when the window resets. */
  resetAt: number | null;
}

const DEFAULT_BASE = 'https://api.clickup.com/api';
const DEFAULT_RESERVE = 5;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 3;
/** Never sleep longer than this in one wait; better to surface a slow call than to hang. */
const MAX_SLEEP_MS = 60_000;

export class ClickUpHttp {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly clock: Clock;
  private readonly fetchImpl: typeof fetch;
  private readonly reserve: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly onLog: (msg: string) => void;

  private rate: RateState = { limit: null, remaining: null, resetAt: null };
  /** Serialises the governor's wait decision so concurrent calls can't both spend the last slot. */
  private gate: Promise<void> = Promise.resolve();

  requestCount = 0;
  throttleWaits = 0;
  retries = 0;

  constructor(opts: HttpOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.clock = opts.clock ?? systemClock;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.reserve = opts.reserve ?? DEFAULT_RESERVE;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.onLog = opts.onLog ?? (() => {});
  }

  rateState(): RateState {
    return { ...this.rate };
  }

  stats() {
    return {
      requests: this.requestCount,
      throttleWaits: this.throttleWaits,
      retries: this.retries,
      rate: this.rateState(),
    };
  }

  get<T>(path: string, subject?: string, version: 'v2' | 'v3' = 'v2'): Promise<T> {
    return this.request<T>('GET', path, undefined, subject, version);
  }

  post<T>(path: string, body: unknown, subject?: string, version: 'v2' | 'v3' = 'v2'): Promise<T> {
    return this.request<T>('POST', path, body, subject, version);
  }

  put<T>(path: string, body: unknown, subject?: string, version: 'v2' | 'v3' = 'v2'): Promise<T> {
    return this.request<T>('PUT', path, body, subject, version);
  }

  delete<T>(path: string, subject?: string, version: 'v2' | 'v3' = 'v2'): Promise<T> {
    return this.request<T>('DELETE', path, undefined, subject, version);
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    subject?: string,
    version: 'v2' | 'v3' = 'v2',
  ): Promise<T> {
    const ctx: RequestContext = { method, path, subject };
    const url = `${this.baseUrl}/${version}${path.startsWith('/') ? path : `/${path}`}`;

    let attempt = 0;
    for (;;) {
      await this.awaitBudget();

      const res = await this.fire(method, url, body, ctx);
      this.absorbHeaders(res.headers);
      this.requestCount++;

      if (res.status === 429 || (res.status >= 500 && res.status !== 501)) {
        // 5xx from ClickUp is frequently a *bad parameter*, not an outage, so retrying is
        // often pointless — but a genuine blip is indistinguishable from here. Retry a
        // bounded number of times, then surface the teaching error.
        if (attempt < this.maxRetries) {
          const wait = this.retryDelay(res, attempt);
          this.retries++;
          this.onLog(
            `retrying ${method} ${path} after ${res.status} in ${wait}ms (attempt ${attempt + 1}/${this.maxRetries})`,
          );
          await this.clock.sleep(wait);
          attempt++;
          continue;
        }
      }

      if (!res.ok) {
        throw fromApiError(res.status, res.body, ctx);
      }
      return res.body as T;
    }
  }

  /** Hold requests when the visible budget is nearly spent. */
  private async awaitBudget(): Promise<void> {
    // Chain onto the gate so two concurrent callers can't both decide the last slot is free.
    const mine = this.gate.then(async () => {
      const { remaining, resetAt } = this.rate;
      if (remaining === null || resetAt === null) return;
      if (remaining > this.reserve) return;

      const wait = Math.min(Math.max(resetAt - this.clock.now(), 0) + 250, MAX_SLEEP_MS);
      if (wait <= 0) return;
      this.throttleWaits++;
      this.onLog(`rate budget low (${remaining} left); holding ${wait}ms for window reset`);
      await this.clock.sleep(wait);
      // The window has rolled; assume it refilled until a real response says otherwise.
      this.rate.remaining = this.rate.limit;
    });
    this.gate = mine.catch(() => {});
    return mine;
  }

  private retryDelay(res: RawResponse, attempt: number): number {
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000 + 250, MAX_SLEEP_MS);
    }
    if (res.status === 429 && this.rate.resetAt) {
      const untilReset = this.rate.resetAt - this.clock.now();
      if (untilReset > 0) return Math.min(untilReset + 250, MAX_SLEEP_MS);
    }
    // Exponential backoff with jitter, so retries from parallel callers don't re-collide.
    const base = Math.min(1000 * 2 ** attempt, 8000);
    return base + Math.floor(Math.random() * 250);
  }

  private absorbHeaders(headers: Headers): void {
    const limit = numHeader(headers, 'x-ratelimit-limit');
    const remaining = numHeader(headers, 'x-ratelimit-remaining');
    const reset = numHeader(headers, 'x-ratelimit-reset');
    if (limit !== null) this.rate.limit = limit;
    if (remaining !== null) this.rate.remaining = remaining;
    // ClickUp sends reset as unix *seconds*; store ms. Guard against a seconds/ms mixup by
    // rejecting values that would place the reset absurdly far out.
    if (reset !== null) {
      const asMs = reset < 1e12 ? reset * 1000 : reset;
      const delta = asMs - this.clock.now();
      this.rate.resetAt = delta > -60_000 && delta < 10 * 60_000 ? asMs : null;
    }
  }

  private async fire(
    method: string,
    url: string,
    body: unknown,
    ctx: RequestContext,
  ): Promise<RawResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: this.token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown = text;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          /* leave as text; the error path handles strings */
        }
      }
      return { status: res.status, ok: res.ok, headers: res.headers, body: parsed };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ClickUpToolError({
          what: `ClickUp did not respond within ${Math.round(this.timeoutMs / 1000)}s.`,
          fix: 'Retry once. If it persists, narrow the query — very large lists can time out.',
          origin: `${ctx.method} ${ctx.path}`,
        });
      }
      throw new ClickUpToolError({
        what: `Could not reach ClickUp: ${err instanceof Error ? err.message : String(err)}`,
        fix: 'Check network connectivity from the server host.',
        origin: `${ctx.method} ${ctx.path}`,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

interface RawResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  body: unknown;
}

function numHeader(h: Headers, name: string): number | null {
  const v = h.get(name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Build a query string, dropping empties and expanding arrays into ClickUp's `k[]=` form. */
export function qs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item === undefined || item === null || item === '') continue;
        parts.push(`${encodeURIComponent(k)}[]=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}
