import crypto from 'crypto';
import { ClickUpClient } from './index.js';

/**
 * Parse and validate an incoming ClickUp webhook payload.
 * If both secret and signature are provided, HMAC-SHA256 verification is performed.
 * No API calls — pure local logic. Can be used independently of the client factory.
 */
export function parseWebhookPayload(
  payload: any,
  secret?: string,
  signature?: string
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

  // Optional HMAC-SHA256 signature validation
  if (secret && signature) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    const received = signature.replace(/^sha256=/, '');
    result.hmac_validated = expected.length === received.length &&
      crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(received)
      );
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

    /**
     * Parse and validate an incoming ClickUp webhook payload.
     * If both secret and signature (X-Signature header) are provided,
     * the payload is HMAC-SHA256 verified before parsing.
     * No API calls — pure local logic.
     */
    parseWebhookPayload(
      payload: any,
      secret?: string,
      signature?: string
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

      // Optional HMAC-SHA256 signature validation
      if (secret && signature) {
        const expected = crypto
          .createHmac('sha256', secret)
          .update(JSON.stringify(payload))
          .digest('hex');
        const received = signature.replace(/^sha256=/, '');
        result.hmac_validated = expected.length === received.length &&
          crypto.timingSafeEqual(
            Buffer.from(expected),
            Buffer.from(received)
          );
        if (!result.hmac_validated) return result;
      }

      // Parse the version block (present in all ClickUp webhook payloads)
      const version = payload?.payload?.version;
      if (!version) {
        // Some events use a flat structure
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
    },
  };
}
