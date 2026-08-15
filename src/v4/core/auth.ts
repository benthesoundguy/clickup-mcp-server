/**
 * HTTP auth for v4.
 *
 * The actual JWT verification is `src/cf-access.ts`, reused unchanged — it has been through
 * four adversarial review rounds and pins RS256 explicitly, so it is the last thing that
 * should be rewritten for a refactor. What lives here is only the glue: extracting a
 * credential, comparing it in constant time, and deciding between the two ways in.
 *
 * Two independent credentials, both of which must actually prove something:
 *   1. a Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`), covering both the OAuth/browser
 *      flow and service tokens;
 *   2. a bearer token, for agents that can set headers (n8n, Claude Code, curl).
 *
 * An invalid JWT never authenticates — the only success path runs through a verified
 * signature. It also does not *veto* a caller holding a valid bearer token: Access injects
 * this header on every request it forwards, so a transient JWKS or clock problem would
 * otherwise lock out clients that presented a second, perfectly good credential.
 */

import type * as http from 'node:http';
import crypto from 'node:crypto';
import { accessConfigFromEnv, verifyAccessJwt, type AccessConfig } from '../../cf-access.js';

export type AuthResult =
  | { ok: true; via: string; subject?: string }
  | { ok: false; reason: string };

export function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // The length check has to come first: timingSafeEqual throws on a length mismatch.
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Pull the bearer credential out of a request.
 *
 * RFC 7235 makes the auth-scheme case-insensitive, so `bearer` must work as well as `Bearer`;
 * matching only the capitalised form made a well-formed client look like it held a bad
 * credential. The credential itself is still compared exactly.
 */
export function extractToken(
  req: http.IncomingMessage,
  allowTokenInPath: boolean,
): string | undefined {
  const fromHeader = /^Bearer[ \t]+(.+)$/i.exec(req.headers.authorization ?? '');
  if (fromHeader) return fromHeader[1].trim();
  if (!allowTokenInPath) return undefined;
  const fromPath = (req.url ?? '').split('?')[0].match(/^\/mcp\/([^/]+)\/?$/);
  return fromPath?.[1];
}

export interface AuthOptions {
  authToken: string;
  allowTokenInPath: boolean;
  accessConfig: AccessConfig | null;
}

export async function authorize(
  req: http.IncomingMessage,
  opts: AuthOptions,
): Promise<AuthResult> {
  const header = req.headers['cf-access-jwt-assertion'];
  const jwt = Array.isArray(header) ? header[0] : header;
  let jwtFailure: string | null = null;

  if (jwt) {
    if (!opts.accessConfig) {
      jwtFailure = 'CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD not configured';
    } else {
      try {
        const id = await verifyAccessJwt(jwt, opts.accessConfig);
        return { ok: true, via: `access-${id.kind}`, subject: id.subject };
      } catch (err) {
        jwtFailure = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const token = extractToken(req, opts.allowTokenInPath);
  if (token && timingSafeEq(token, opts.authToken)) return { ok: true, via: 'bearer' };

  if (jwtFailure) {
    return { ok: false, reason: `Access JWT rejected (${jwtFailure}); no valid bearer token` };
  }
  return { ok: false, reason: token ? 'invalid bearer token' : 'no credentials presented' };
}

export { accessConfigFromEnv };
export type { AccessConfig };

/**
 * Public origin for the RFC 9728 discovery hint.
 *
 * Host headers are client-controllable, so this is only ever used to build an advisory URL —
 * never for an auth decision.
 */
export function publicOrigin(req: http.IncomingMessage): string {
  if (process.env.MCP_PUBLIC_URL) return process.env.MCP_PUBLIC_URL.replace(/\/+$/, '');
  const pick = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
  const proto =
    pick(req.headers['x-forwarded-proto']) ??
    ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
  const host = pick(req.headers['x-forwarded-host']) ?? req.headers.host ?? 'localhost';
  return `${proto}://${host}`;
}
