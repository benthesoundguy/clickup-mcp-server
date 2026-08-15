/**
 * Cloudflare Access JWT validation.
 *
 * Access puts a signed RS256 JWT on every request it forwards to the origin,
 * in the `Cf-Access-Jwt-Assertion` header. Validating it here is defence in
 * depth: it means a request that somehow reaches the origin without passing
 * through Access — a tunnel misconfiguration, a second ingress, someone on the
 * host's network — cannot impersonate an Access-authenticated caller.
 *
 * Both Access flows produce the same header and validate through this one path.
 * They differ only in which identity claim is present:
 *   - browser / OAuth login → `email`
 *   - service token         → `common_name`
 *
 * No new dependencies: RS256 is RSASSA-PKCS1-v1_5 over SHA-256, which
 * node:crypto verifies natively, and JWKs convert to KeyObjects via
 * `createPublicKey({ format: 'jwk' })`.
 */
import crypto from 'node:crypto';

export interface AccessIdentity {
  kind: 'user' | 'service_token';
  subject: string;
  aud: string;
  expires: string;
}

export interface AccessConfig {
  /** Issuer origin, e.g. https://myteam.cloudflareaccess.com */
  issuer: string;
  /** JWKS endpoint, always derived from `issuer` — never from the token. */
  certsUrl: string;
  /** Access application AUD tag. */
  aud: string;
}

/** Tolerance for clock drift between Cloudflare and this host. */
const CLOCK_SKEW_S = 60;
/** How long a fetched JWKS stays authoritative. */
const JWKS_TTL_MS = 10 * 60 * 1000;
/** Floor between refreshes triggered by an unknown `kid`, so an attacker
 *  cannot use made-up kids to make us hammer Cloudflare. */
const JWKS_MIN_REFRESH_MS = 30 * 1000;
const JWKS_FETCH_TIMEOUT_MS = 5_000;

/**
 * Normalise whatever the operator put in CF_ACCESS_TEAM_DOMAIN: a bare team
 * name, a team hostname, or a full URL all resolve to the same issuer.
 * A full http(s) URL is honoured as-is, which is what lets tests point at a
 * local JWKS stub — it comes from configuration, never from a request.
 */
export function accessConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AccessConfig | null {
  const rawDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.CF_ACCESS_AUD?.trim();
  if (!rawDomain || !aud) return null;

  let issuer: string;
  if (/^https?:\/\//i.test(rawDomain)) {
    issuer = new URL(rawDomain).origin;
  } else if (rawDomain.includes('.')) {
    issuer = `https://${rawDomain}`;
  } else {
    issuer = `https://${rawDomain}.cloudflareaccess.com`;
  }
  return { issuer, certsUrl: `${issuer}/cdn-cgi/access/certs`, aud };
}

// ── JWKS cache ───────────────────────────────────────────────────────────

interface Jwk { kid?: string; kty?: string; alg?: string; n?: string; e?: string; [k: string]: unknown }

let cachedKeys: Map<string, crypto.KeyObject> | null = null;
let cachedAt = 0;
let lastRefreshAttempt = 0;
let inFlight: Promise<Map<string, crypto.KeyObject>> | null = null;

/** Reset module state. Tests only. */
export function _resetJwksCache(): void {
  cachedKeys = null;
  cachedAt = 0;
  lastRefreshAttempt = 0;
  inFlight = null;
}

async function fetchJwks(certsUrl: string): Promise<Map<string, crypto.KeyObject>> {
  const res = await fetch(certsUrl, {
    signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  const body = await res.json() as { keys?: Jwk[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error('JWKS response contained no keys');
  }

  const keys = new Map<string, crypto.KeyObject>();
  for (const jwk of body.keys) {
    // Only RSA signing keys are usable for RS256; anything else is ignored
    // rather than trusted.
    if (!jwk.kid || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) continue;
    try {
      keys.set(jwk.kid, crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' }));
    } catch { /* unusable key — skip it rather than fail the whole set */ }
  }
  if (keys.size === 0) throw new Error('JWKS contained no usable RSA keys');
  return keys;
}

async function getKeys(cfg: AccessConfig, forceRefresh = false): Promise<Map<string, crypto.KeyObject>> {
  const fresh = cachedKeys && Date.now() - cachedAt < JWKS_TTL_MS;
  if (fresh && !forceRefresh) return cachedKeys!;

  if (forceRefresh && Date.now() - lastRefreshAttempt < JWKS_MIN_REFRESH_MS && cachedKeys) {
    return cachedKeys;
  }
  if (inFlight) return inFlight;   // collapse concurrent misses into one fetch

  lastRefreshAttempt = Date.now();
  inFlight = fetchJwks(cfg.certsUrl)
    .then((keys) => {
      cachedKeys = keys;
      cachedAt = Date.now();
      return keys;
    })
    .finally(() => { inFlight = null; });

  try {
    return await inFlight;
  } catch (err) {
    // Serve a stale set rather than locking everyone out during a blip — but
    // never treat a fetch failure as permission to skip verification.
    if (cachedKeys) return cachedKeys;
    throw err;
  }
}

// ── JWT verification ─────────────────────────────────────────────────────

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodeJson(segment: string): Record<string, unknown> {
  const parsed = JSON.parse(b64urlToBuffer(segment).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('segment is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export class AccessJwtError extends Error {}

/**
 * Verify a Cloudflare Access JWT. Resolves with the caller's identity, or
 * throws — there is no third outcome, and no path returns success without a
 * signature check having passed.
 */
export async function verifyAccessJwt(token: string, cfg: AccessConfig): Promise<AccessIdentity> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AccessJwtError('malformed token (expected 3 segments)');
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJson(headerB64);
    payload = decodeJson(payloadB64);
  } catch {
    throw new AccessJwtError('malformed token (undecodable segments)');
  }

  // Pin the algorithm. Accepting whatever `alg` says is how `none` and
  // RSA→HMAC confusion attacks work: the token must not choose its own
  // verification scheme.
  if (header.alg !== 'RS256') {
    throw new AccessJwtError(`unsupported alg ${String(header.alg)} (only RS256 is accepted)`);
  }
  const kid = typeof header.kid === 'string' ? header.kid : null;
  if (!kid) throw new AccessJwtError('token header has no kid');

  let keys = await getKeys(cfg);
  let key = keys.get(kid);
  if (!key) {
    // Unknown kid usually means Cloudflare rotated signing keys.
    keys = await getKeys(cfg, true);
    key = keys.get(kid);
  }
  if (!key) throw new AccessJwtError(`no signing key matches kid ${kid}`);

  const ok = crypto
    .createVerify('RSA-SHA256')
    .update(`${headerB64}.${payloadB64}`)
    .verify(key, b64urlToBuffer(signatureB64));
  if (!ok) throw new AccessJwtError('signature verification failed');

  // Claims are only trustworthy after the signature check above.
  const now = Math.floor(Date.now() / 1000);

  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  if (exp === null) throw new AccessJwtError('token has no exp');
  if (now > exp + CLOCK_SKEW_S) throw new AccessJwtError('token expired');

  const nbf = typeof payload.nbf === 'number' ? payload.nbf : null;
  if (nbf !== null && nbf > now + CLOCK_SKEW_S) throw new AccessJwtError('token not yet valid');

  if (payload.iss !== cfg.issuer) {
    throw new AccessJwtError(`issuer mismatch (got ${String(payload.iss)})`);
  }

  const audClaim = payload.aud;
  const auds = Array.isArray(audClaim) ? audClaim : [audClaim];
  if (!auds.some((a) => typeof a === 'string' && a === cfg.aud)) {
    throw new AccessJwtError('aud does not include this application');
  }

  // One path, two flows: a browser/OAuth login carries `email`, a service
  // token carries `common_name`.
  const email = typeof payload.email === 'string' ? payload.email : null;
  const commonName = typeof payload.common_name === 'string' ? payload.common_name : null;
  if (!email && !commonName) {
    throw new AccessJwtError('token carries neither email nor common_name');
  }

  return {
    kind: email ? 'user' : 'service_token',
    subject: email ?? commonName!,
    aud: cfg.aud,
    expires: new Date(exp * 1000).toISOString(),
  };
}
