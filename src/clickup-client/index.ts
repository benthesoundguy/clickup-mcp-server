// Shared HTTP core for the ClickUp API.
//
// Design goals:
// - ONE client instance shared by every module (lazy singleton).
// - Token is resolved at request time, not import time — a missing
//   CLICKUP_API_TOKEN surfaces as a normal tool error instead of killing
//   the process before the MCP transport can even start.
// - Native fetch (Node >= 18): no axios dependency.
// - Both API versions: v2 (default) and v3 via { api: 'v3' }.
// - 30s timeout, automatic retry with exponential backoff on 429/5xx,
//   honoring the Retry-After header when present.
// - Errors normalized to ClickUpApiError with status + ClickUp ECODE.

const BASE_URLS = {
  v2: 'https://api.clickup.com/api/v2',
  v3: 'https://api.clickup.com/api/v3',
} as const;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
// Longest single retry wait we'll honor from a Retry-After header — beyond
// this we fail fast with the server's demanded wait in the error message.
const MAX_RETRY_WAIT_MS = 15_000;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
// 500s are retried only for idempotent methods — a retried POST could
// double-create (observed: ClickUp's experimental chat API throws
// transient 500s that succeed on the next attempt).
const IDEMPOTENT_METHODS = new Set(['GET', 'PUT', 'PATCH', 'DELETE']);

export type ApiVersion = keyof typeof BASE_URLS;

export interface RequestOptions {
  params?: object;
  body?: unknown;
  api?: ApiVersion;
  /** Raw body override for multipart uploads (skips JSON serialization). */
  formData?: FormData;
}

export class ClickUpApiError extends Error {
  readonly status: number;
  readonly ecode?: string;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string, ecode?: string) {
    super(message);
    this.name = 'ClickUpApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.ecode = ecode;
  }
}

export interface ClickUpClientConfig {
  apiToken?: string;
  baseUrlV2?: string;
  baseUrlV3?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ── Token resolution ───────────────────────────────────────────────────
// Precedence: explicit config > .env FILE > process env var.
// The file outranks the inherited env var deliberately: MCP host apps
// (e.g. Claude Desktop) snapshot their config into the child process env
// and can rewrite the config from memory on quit, so the env var goes
// stale after a token rotation. The .env file is the single source of
// truth the user actually edits. Searched (first hit wins):
//   1. <cwd>/.env
//   2. <repo root>/.env        (two levels up from this compiled file)
//   3. <repo root>/../.env     (repo checked out inside a project folder)
// Set MCP_NO_ENV_FILE=1 to disable the file lookup (used by tests).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let envFileToken: string | null | undefined; // undefined = not yet searched

function tokenFromEnvFile(): string | null {
  if (process.env.MCP_NO_ENV_FILE === '1') return null;
  if (envFileToken !== undefined) return envFileToken;
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(moduleDir, '..', '..');
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(repoRoot, '.env'),
    path.resolve(repoRoot, '..', '.env'),
  ];
  envFileToken = null;
  for (const p of candidates) {
    try {
      const m = fs.readFileSync(p, 'utf-8').match(/^\s*CLICKUP_API_TOKEN\s*=\s*(\S+)\s*$/m);
      if (m) {
        envFileToken = m[1];
        console.error(`[Auth] ClickUp token loaded from ${p}`);
        break;
      }
    } catch { /* no file here */ }
  }
  return envFileToken;
}

export class ClickUpClient {
  private config: ClickUpClientConfig;

  constructor(config: ClickUpClientConfig = {}) {
    this.config = config;
  }

  /** Resolve the API token lazily so a missing token is a request-time error. */
  private getToken(): string {
    const token = this.config.apiToken ?? tokenFromEnvFile() ?? process.env.CLICKUP_API_TOKEN;
    if (!token) {
      throw new ClickUpApiError(
        'CLICKUP_API_TOKEN is not set. Put it in a .env file next to the server install, or in the env block of your MCP settings.',
        0,
        '(config)'
      );
    }
    return token;
  }

  private buildUrl(endpoint: string, api: ApiVersion, params?: object): string {
    const base =
      api === 'v3'
        ? this.config.baseUrlV3 ?? BASE_URLS.v3
        : this.config.baseUrlV2 ?? BASE_URLS.v2;
    const url = new URL(base + endpoint);
    if (params) {
      for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          // ClickUp expects repeated array params like assignees[]=1&assignees[]=2
          for (const v of value) url.searchParams.append(`${key}[]`, String(v));
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<T = any>(method: string, endpoint: string, opts: RequestOptions = {}): Promise<T> {
    const token = this.getToken();
    const url = this.buildUrl(endpoint, opts.api ?? 'v2', opts.params);
    const maxRetries = this.config.maxRetries ?? MAX_RETRIES;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const headers: Record<string, string> = { Authorization: token };
    let body: BodyInit | undefined;
    if (opts.formData) {
      body = opts.formData; // fetch sets the multipart boundary header itself
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, { method, headers, body, signal: controller.signal });
      } catch (err: any) {
        clearTimeout(timer);
        const isAbort = err?.name === 'AbortError';
        lastError = new ClickUpApiError(
          isAbort
            ? `Request timed out after ${timeoutMs / 1000}s: ${method} ${endpoint}`
            : `Network error on ${method} ${endpoint}: ${err?.message ?? err}`,
          0,
          endpoint
        );
        if (attempt < maxRetries) {
          await sleep(this.backoffMs(attempt));
          continue;
        }
        throw lastError;
      }
      clearTimeout(timer);

      if (response.ok) {
        const text = await response.text();
        if (!text) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as unknown as T;
        }
      }

      // Error response — extract ClickUp's error body if present
      let errBody: any = {};
      try {
        errBody = await response.json();
      } catch {
        /* non-JSON error body */
      }
      const ecode: string | undefined = errBody?.ECODE;
      // ClickUp frequently answers with an empty body and no statusText,
      // which used to surface as a bare "error (400) on POST /x:" — nothing
      // an agent can act on. Fall back to an explanation of the status.
      const STATUS_HINTS: Record<number, string> = {
        400: 'Bad request — a parameter is missing, malformed, or not accepted for this resource.',
        401: 'Unauthorized — the API token is invalid, or this resource belongs to another workspace.',
        403: 'Forbidden — the token lacks permission for this resource.',
        404: 'Not found — the id does not exist, was deleted, or is in a different workspace.',
        405: 'Method not allowed — this route does not support that HTTP verb.',
        429: 'Rate limited.',
      };
      const detail = errBody?.err ?? errBody?.error ?? errBody?.message
        ?? (response.statusText || undefined)
        ?? STATUS_HINTS[response.status]
        ?? 'no detail supplied by ClickUp';
      const message = `ClickUp API error (${response.status}${ecode ? ` ${ecode}` : ''}) on ${method} ${endpoint}: ${detail}`;

      const retryable =
        RETRYABLE_STATUSES.has(response.status) ||
        (response.status === 500 && IDEMPOTENT_METHODS.has(method.toUpperCase()));
      if (retryable && attempt < maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : this.backoffMs(attempt);
        // A long Retry-After (rate-limit lockouts can demand minutes to
        // hours) must FAIL FAST, not become a silent multi-minute hang
        // inside a tool call. A fast, explained error beats a stuck tool.
        if (waitMs > MAX_RETRY_WAIT_MS) {
          throw new ClickUpApiError(
            `${message} — rate limited: ClickUp asked to retry after ${Math.round(waitMs / 1000)}s, `
            + `which exceeds the ${MAX_RETRY_WAIT_MS / 1000}s in-call retry budget. Do not retry immediately; `
            + `wait at least that long before the next attempt.`,
            response.status,
            endpoint,
            ecode
          );
        }
        await sleep(waitMs);
        lastError = new ClickUpApiError(message, response.status, endpoint, ecode);
        continue;
      }

      throw new ClickUpApiError(message, response.status, endpoint, ecode);
    }

    // Retries exhausted on a retryable status
    throw lastError ?? new ClickUpApiError(`Request failed: ${method} ${endpoint}`, 0, endpoint);
  }

  private backoffMs(attempt: number): number {
    return 1000 * 2 ** attempt + Math.random() * 250;
  }

  // ── Convenience methods (v2 by default; pass { api: 'v3' } for v3) ──

  async get<T = any>(endpoint: string, params?: object, opts?: Pick<RequestOptions, 'api'>): Promise<T> {
    return this.request<T>('GET', endpoint, { params, api: opts?.api });
  }

  async post<T = any>(endpoint: string, data?: unknown, opts?: Pick<RequestOptions, 'api'>): Promise<T> {
    return this.request<T>('POST', endpoint, { body: data, api: opts?.api });
  }

  async put<T = any>(endpoint: string, data?: unknown, opts?: Pick<RequestOptions, 'api'>): Promise<T> {
    return this.request<T>('PUT', endpoint, { body: data, api: opts?.api });
  }

  async patch<T = any>(endpoint: string, data?: unknown, opts?: Pick<RequestOptions, 'api'>): Promise<T> {
    return this.request<T>('PATCH', endpoint, { body: data, api: opts?.api });
  }

  async delete<T = any>(endpoint: string, config?: { params?: object; api?: ApiVersion }): Promise<T> {
    return this.request<T>('DELETE', endpoint, { params: config?.params, api: config?.api });
  }

  /** Multipart upload (attachments). */
  async upload<T = any>(endpoint: string, formData: FormData, opts?: Pick<RequestOptions, 'api'>): Promise<T> {
    return this.request<T>('POST', endpoint, { formData, api: opts?.api });
  }
}

// ── Pagination helper ──────────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
  /** False when the page cap was hit and more data may exist. */
  complete: boolean;
  pagesFetched: number;
}

/**
 * Fetch all pages from a page-numbered ClickUp endpoint.
 * @param fetchPage Called with a 0-based page number; returns that page's items
 *                  and (optionally) an explicit last-page flag.
 * @param opts.pageSize   Items per full page (ClickUp defaults to 100).
 * @param opts.maxPages   Safety cap; when hit, `complete` is false.
 */
export async function getAllPages<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; lastPage?: boolean }>,
  opts: { pageSize?: number; maxPages?: number } = {}
): Promise<PaginatedResult<T>> {
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 20;
  const items: T[] = [];
  let page = 0;

  for (; page < maxPages; page++) {
    const result = await fetchPage(page);
    items.push(...result.items);
    const isLast = result.lastPage === true || result.items.length < pageSize;
    if (isLast) {
      return { items, complete: true, pagesFetched: page + 1 };
    }
  }
  return { items, complete: false, pagesFetched: page };
}

// ── Shared singleton ───────────────────────────────────────────────────

let sharedClient: ClickUpClient | undefined;

/**
 * Returns the shared ClickUpClient. Safe to call at module scope: the
 * API token is not read until the first actual request.
 */
export const createClickUpClient = (): ClickUpClient => {
  if (!sharedClient) {
    sharedClient = new ClickUpClient();
  }
  return sharedClient;
};

export const getClickUpClient = createClickUpClient;
