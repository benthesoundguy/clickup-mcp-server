import crypto from 'crypto';
/**
 * Parse and validate an incoming ClickUp webhook payload.
 * If both secret and signature are provided, HMAC-SHA256 verification is performed.
 * No API calls — pure local logic. Can be used independently of the client factory.
 */
export function parseWebhookPayload(payload, secret, signature) {
    const result = { valid: false, hmac_validated: false };
    // Optional HMAC-SHA256 signature validation
    if (secret && signature) {
        const expected = crypto
            .createHmac('sha256', secret)
            .update(JSON.stringify(payload))
            .digest('hex');
        const received = signature.replace(/^sha256=/, '');
        result.hmac_validated = expected.length === received.length &&
            crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
        if (!result.hmac_validated)
            return result;
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
    result.relationships = (version.relationships || []).map((r) => ({
        type: r.type,
        object_type: r.object_type,
        object_id: r.object_id,
    }));
    result.valid = true;
    return result;
}
export function createWebhooksClient(client) {
    return {
        async getWebhooks(workspaceId) {
            return client.get(`/team/${workspaceId}/webhook`);
        },
        async createWebhook(workspaceId, endpoint, events, spaceId) {
            return client.post(`/team/${workspaceId}/webhook`, {
                endpoint,
                events,
                space_id: spaceId
            });
        },
        async updateWebhook(webhookId, endpoint, events, status) {
            return client.put(`/webhook/${webhookId}`, {
                endpoint,
                events,
                status
            });
        },
        async deleteWebhook(webhookId) {
            return client.delete(`/webhook/${webhookId}`);
        },
        /**
         * Parse and validate an incoming ClickUp webhook payload.
         * If both secret and signature (X-Signature header) are provided,
         * the payload is HMAC-SHA256 verified before parsing.
         * No API calls — pure local logic.
         */
        parseWebhookPayload(payload, secret, signature) {
            const result = { valid: false, hmac_validated: false };
            // Optional HMAC-SHA256 signature validation
            if (secret && signature) {
                const expected = crypto
                    .createHmac('sha256', secret)
                    .update(JSON.stringify(payload))
                    .digest('hex');
                const received = signature.replace(/^sha256=/, '');
                result.hmac_validated = expected.length === received.length &&
                    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
                if (!result.hmac_validated)
                    return result;
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
            result.relationships = (version.relationships || []).map((r) => ({
                type: r.type,
                object_type: r.object_type,
                object_id: r.object_id,
            }));
            result.valid = true;
            return result;
        },
    };
}
//# sourceMappingURL=webhooks.js.map