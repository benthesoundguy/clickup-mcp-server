import crypto from 'crypto';
import { ClickUpClient } from './index.js';

/**
 * Verify a ClickUp webhook HMAC-SHA256 signature against the RAW request body.
 * ClickUp signs the exact bytes it sends — verifying a re-serialized object
 * would produce false mismatches (key order, whitespace), so callers must
 * pass the unmodified body string.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, secret: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = signature.replace(/^sha256=/, '');
  return (
    expected.length === received.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}

/**
 * Parse and validate an incoming ClickUp webhook payload.
 *
 * @param payload   Parsed JSON body (used for structure extraction)
 * @param secret    Webhook secret; when set, HMAC validation is REQUIRED —
 *                  a missing or wrong signature yields valid: false
 * @param signature X-Signature header value
 * @param rawBody   The raw, unmodified request body — required for correct
 *                  HMAC verification when a secret is configured. Falls back
 *                  to JSON.stringify(payload) only if omitted (legacy callers).
 */
export function parseWebhookPayload(
  payload: any,
  secret?: string,
  signature?: string,
  rawBody?: string | Buffer
): {
  valid: boolean;
  hmac_validated: boolean;
  event?: string;
  object_type?: string;
  object_id?: string;
  operation?: string;
  timestamp?: number;
  user_id?: number;
  changes?: Array<{ field: string; before?: any; after?: any }>;
  relationships?: Array<{ type: string; object_type: string; object_id: string | number }>;
} {
  const result: any = { valid: false, hmac_validated: false };

  // HMAC-SHA256 signature validation. When a secret is configured the
  // signature is MANDATORY: absence is a validation failure, not a skip.
  if (secret) {
    const body = rawBody ?? JSON.stringify(payload);
    result.hmac_validated = verifyWebhookSignature(body, secret, signature);
    if (!result.hmac_validated) return result;
  }

  // Parse the version block (present in structured ClickUp webhook payloads)
  const version = payload?.payload?.version;
  if (!version) {
    // Flat structure fallback
    result.event = payload.event;
    result.object_type = payload.object_type;
    result.object_id = payload.object_id;
    result.operation = payload.operation;
    result.timestamp = payload.timestamp;
    result.valid = true;
    return result;
  }

  // Structured v2 webhook payload
  result.event = payload.event;
  result.object_type = version.object_type;
  result.object_id = version.object_id;
  result.operation = payload.operation_display || payload.operation;
  result.timestamp = payload.timestamp;
  result.user_id = version.context?.audit_context?.userid;
  result.changes = version.changes || [];
  result.relationships = (version.relationships || []).map((r: any) => ({
    type: r.type,
    object_type: r.object_type,
    object_id: r.object_id,
  }));
  result.valid = true;

  return result;
}

export function createWebhooksClient(client: ClickUpClient) {
  return {
    async getWebhooks(workspaceId: string): Promise<any> {
      return client.get(`/team/${workspaceId}/webhook`);
    },
    async createWebhook(workspaceId: string, endpoint: string, events: string[], spaceId?: string): Promise<any> {
      return client.post(`/team/${workspaceId}/webhook`, {
        endpoint,
        events,
        space_id: spaceId
      });
    },
    async updateWebhook(webhookId: string, endpoint?: string, events?: string[], status?: string): Promise<any> {
      return client.put(`/webhook/${webhookId}`, {
        endpoint,
        events,
        status
      });
    },
    async deleteWebhook(webhookId: string): Promise<any> {
      return client.delete(`/webhook/${webhookId}`);
    },

    /** Delegates to the top-level parseWebhookPayload (see its docs). */
    parseWebhookPayload(payload: any, secret?: string, signature?: string, rawBody?: string | Buffer) {
      return parseWebhookPayload(payload, secret, signature, rawBody);
    },
  };
}
