/**
 * OAuth 2.1 resource-server support.
 *
 * The expensive misconception about MCP auth is that the server has to *be* an OAuth provider.
 * It does not. Since the 2025-06-18 spec revision an MCP server is a pure **resource server**:
 * the authorization server "may be hosted with the resource server or a separate entity", and
 * the server's job is only to say which AS it trusts and to validate the tokens that AS issues.
 *
 * That makes the whole feature two things:
 *
 *   1. **Protected Resource Metadata** (RFC 9728) at `/.well-known/oauth-protected-resource`,
 *      naming the authorization server. This is a MUST, and it was the only MUST missing — the
 *      `WWW-Authenticate` header pointing at it has been correct since v3.4.0.
 *   2. **Token validation with audience binding** — the token must have been issued *for this
 *      server*, or a token minted for some other service could be replayed here.
 *
 * Staying a resource server is also the durable choice: the 2026-07-28 spec deprecated Dynamic
 * Client Registration in favour of Client ID Metadata Documents, and that churn lands on
 * authorization servers and clients. A resource server is unaffected by either.
 *
 * Verification itself delegates to `src/cf-access.ts`, which already pins RS256, takes the JWKS
 * location from configuration rather than from the token, and checks exp/nbf/iss/aud. Those are
 * precisely the resource-server requirements, and it has been through four adversarial rounds —
 * a second JWT verifier in one codebase would be a liability, not a feature.
 */

import { verifyAccessJwt, type AccessConfig, type AccessIdentity } from '../../cf-access.js';

export interface OAuthConfig {
  /** Authorization server issuer, e.g. `https://auth.example.com`. */
  issuer: string;
  /** Where signing keys come from. Discovered from the issuer unless set explicitly. */
  jwksUrl: string;
  /**
   * The canonical URI of THIS server, which inbound tokens must name as their audience.
   *
   * Never derived from the request. A `Host` header is client-controllable, so deriving the
   * expected audience from it would let a caller choose what their token has to match — which
   * is the whole attack that audience binding exists to prevent.
   */
  resource: string;
  /** Advertised in the metadata document. Purely informational. */
  scopes: string[];
}

/** Fetch timeout for issuer discovery. Short: this runs on a request path. */
const DISCOVERY_TIMEOUT_MS = 5000;

/** Discovery answers are stable; re-fetching per request would be a free DoS on the IdP. */
let discoveryCache: { key: string; jwksUrl: string; at: number } | null = null;
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

export class OAuthConfigError extends Error {}

/**
 * HTTPS, or plain HTTP on loopback.
 *
 * OAuth 2.1 requires TLS for authorization server endpoints, and that is not negotiable over a
 * network. The loopback exemption is the standard one: traffic that never leaves the host has
 * no transport to intercept, and without it nobody can develop against a local Keycloak or run
 * these tests. The check is on the parsed hostname, not a substring — `https://127.0.0.1.evil.com`
 * must not read as loopback.
 */
export function isSecureOrigin(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return true;
  if (u.protocol !== 'http:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

/**
 * Read OAuth settings from the environment. Returns `null` when OAuth is not configured, which
 * is the normal case for a personal stdio install.
 */
export function oauthEnv(env: NodeJS.ProcessEnv = process.env): {
  issuer: string;
  jwksUrl?: string;
  resource?: string;
  scopes: string[];
} | null {
  const issuer = env.MCP_OAUTH_ISSUER?.trim().replace(/\/+$/, '');
  if (!issuer) return null;
  if (!isSecureOrigin(issuer)) {
    throw new OAuthConfigError(
      `MCP_OAUTH_ISSUER must be an https URL, got ${JSON.stringify(issuer)}. ` +
        'Plain http is permitted only on loopback (127.0.0.1, [::1], localhost) for local ' +
        'development against an IdP running on this machine.',
    );
  }
  return {
    issuer,
    jwksUrl: env.MCP_OAUTH_JWKS_URL?.trim() || undefined,
    resource: (env.MCP_OAUTH_AUDIENCE?.trim() || env.MCP_PUBLIC_URL?.trim() || '').replace(/\/+$/, '') || undefined,
    scopes: (env.MCP_OAUTH_SCOPES?.trim() || '').split(/[\s,]+/).filter(Boolean),
  };
}

/**
 * Resolve the full configuration, discovering the JWKS URL if it was not given.
 *
 * Tries the OpenID Connect document first and the RFC 8414 OAuth document second, because
 * issuers in the wild serve one, the other, or both.
 */
export async function resolveOAuthConfig(
  raw: NonNullable<ReturnType<typeof oauthEnv>>,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthConfig> {
  if (!raw.resource) {
    throw new OAuthConfigError(
      'OAuth is enabled but this server has no canonical URI, so it cannot check that a token ' +
        'was issued for it. Set MCP_PUBLIC_URL (e.g. https://mcp.example.com) — or ' +
        'MCP_OAUTH_AUDIENCE if your issuer mints a different audience value. It must not be ' +
        'derived from the request, because the Host header is set by the caller.',
    );
  }

  const jwksUrl = raw.jwksUrl ?? (await discoverJwks(raw.issuer, fetchImpl));
  return { issuer: raw.issuer, jwksUrl, resource: raw.resource, scopes: raw.scopes };
}

async function discoverJwks(issuer: string, fetchImpl: typeof fetch): Promise<string> {
  const now = Date.now();
  if (discoveryCache && discoveryCache.key === issuer && now - discoveryCache.at < DISCOVERY_TTL_MS) {
    return discoveryCache.jwksUrl;
  }

  const candidates = [
    `${issuer}/.well-known/openid-configuration`,
    `${issuer}/.well-known/oauth-authorization-server`,
  ];
  const failures: string[] = [];

  for (const url of candidates) {
    try {
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        failures.push(`${url} → HTTP ${res.status}`);
        continue;
      }
      const doc = (await res.json()) as { jwks_uri?: unknown; issuer?: unknown };
      // The document must agree about who it belongs to, or it is not this issuer's document.
      if (typeof doc.issuer === 'string' && doc.issuer.replace(/\/+$/, '') !== issuer) {
        failures.push(`${url} → issuer mismatch (${doc.issuer})`);
        continue;
      }
      if (typeof doc.jwks_uri !== 'string' || !isSecureOrigin(doc.jwks_uri)) {
        failures.push(`${url} → no usable jwks_uri`);
        continue;
      }
      discoveryCache = { key: issuer, jwksUrl: doc.jwks_uri, at: now };
      return doc.jwks_uri;
    } catch (err) {
      failures.push(`${url} → ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new OAuthConfigError(
    `Could not discover signing keys for ${issuer}. Tried:\n  ${failures.join('\n  ')}\n` +
      'Set MCP_OAUTH_JWKS_URL explicitly if the issuer does not publish a discovery document.',
  );
}

/** Exposed for tests, which must not inherit a cache from a previous case. */
export function resetDiscoveryCache(): void {
  discoveryCache = null;
}

/** Cheap shape test: three dot-separated segments. Distinguishes a JWT from a static secret. */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p));
}

/**
 * Verify an access token issued by the configured authorization server.
 *
 * The audience check is the load-bearing one: the spec requires a server to reject tokens that
 * were not minted for it, precisely so a token obtained for another service cannot be replayed
 * here. `verifyAccessJwt` enforces it against `cfg.resource`.
 */
export async function verifyOAuthToken(
  token: string,
  cfg: OAuthConfig,
): Promise<AccessIdentity> {
  const access: AccessConfig = {
    issuer: cfg.issuer,
    certsUrl: cfg.jwksUrl,
    aud: cfg.resource,
    // A generic issuer identifies the caller by `sub`; some also carry a friendlier claim.
    subjectClaims: ['sub', 'email', 'client_id'],
  };
  return verifyAccessJwt(token, access);
}

/**
 * The RFC 9728 Protected Resource Metadata document.
 *
 * `authorization_servers` is the field the spec requires: it is how a client that got a 401
 * discovers where to go and log in.
 */
export function protectedResourceMetadata(cfg: OAuthConfig): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    resource: cfg.resource,
    authorization_servers: [cfg.issuer],
    bearer_methods_supported: ['header'],
  };
  if (cfg.scopes.length) doc.scopes_supported = cfg.scopes;
  return doc;
}

/**
 * Paths that must serve the metadata document.
 *
 * RFC 9728 inserts the resource's path component after the well-known segment, so a server at
 * `https://host/mcp` is discovered at `/.well-known/oauth-protected-resource/mcp`. Clients
 * differ over whether they include it, so both forms are served.
 */
export function metadataPaths(resource: string): string[] {
  const base = '/.well-known/oauth-protected-resource';
  const paths: string[] = [];
  try {
    const p = new URL(resource).pathname.replace(/\/+$/, '');
    // Most specific first: this is the RFC-correct location for a resource with a path.
    if (p && p !== '/') paths.push(`${base}${p}`);
  } catch {
    // A malformed resource URI is caught at config time; nothing useful to add here.
  }
  paths.push(base);
  return paths;
}

/**
 * The URL to advertise in `WWW-Authenticate: ... resource_metadata=`.
 *
 * RFC 9728 inserts the well-known segment **between the host and the resource's path**, so a
 * server at `https://host/mcp` is described at `https://host/.well-known/oauth-protected-resource/mcp`
 * — not at `https://host/mcp/.well-known/...`. Getting this backwards sends a client that did
 * everything right to a 404.
 */
export function metadataUrl(resource: string): string {
  try {
    const u = new URL(resource);
    return `${u.origin}${metadataPaths(resource)[0]}`;
  } catch {
    return `${resource.replace(/\/+$/, '')}/.well-known/oauth-protected-resource`;
  }
}
