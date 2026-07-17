import { ClickUpClient } from './index.js';
/**
 * Parse and validate an incoming ClickUp webhook payload.
 * If both secret and signature are provided, HMAC-SHA256 verification is performed.
 * No API calls — pure local logic. Can be used independently of the client factory.
 */
export declare function parseWebhookPayload(payload: any, secret?: string, signature?: string): {
    valid: boolean;
    hmac_validated: boolean;
    event?: string;
    object_type?: string;
    object_id?: string;
    operation?: string;
    timestamp?: number;
    user_id?: number;
    changes?: Array<{
        field: string;
        before?: any;
        after?: any;
    }>;
    relationships?: Array<{
        type: string;
        object_type: string;
        object_id: string | number;
    }>;
};
export declare function createWebhooksClient(client: ClickUpClient): {
    getWebhooks(workspaceId: string): Promise<any>;
    createWebhook(workspaceId: string, endpoint: string, events: string[], spaceId?: string): Promise<any>;
    updateWebhook(webhookId: string, endpoint?: string, events?: string[], status?: string): Promise<any>;
    deleteWebhook(webhookId: string): Promise<any>;
    /**
     * Parse and validate an incoming ClickUp webhook payload.
     * If both secret and signature (X-Signature header) are provided,
     * the payload is HMAC-SHA256 verified before parsing.
     * No API calls — pure local logic.
     */
    parseWebhookPayload(payload: any, secret?: string, signature?: string): {
        valid: boolean;
        hmac_validated: boolean;
        event?: string;
        object_type?: string;
        object_id?: string;
        operation?: string;
        timestamp?: number;
        user_id?: number;
        changes?: Array<{
            field: string;
            before?: any;
            after?: any;
        }>;
        relationships?: Array<{
            type: string;
            object_type: string;
            object_id: string | number;
        }>;
    };
};
