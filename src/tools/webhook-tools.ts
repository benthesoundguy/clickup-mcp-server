import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createWebhooksClient, parseWebhookPayload } from '../clickup-client/webhooks.js';

const clickUpClient = createClickUpClient();
const webhooksClient = createWebhooksClient(clickUpClient);

export function setupWebhookTools(server: McpServer): void {
  server.tool(
    'webhooks',
    'Manage ClickUp webhooks and parse incoming webhook events. Use action to list, create, update, delete webhooks, or process an incoming payload with optional HMAC validation.',
    {
      action: z.enum(['list', 'create', 'update', 'delete', 'process']).describe('Action to perform'),
      workspace_id: z.string().optional().describe('Required for list, create: the workspace ID'),
      webhook_id: z.string().optional().describe('Required for update, delete: the webhook ID'),
      endpoint: z.string().optional().describe('Required for create: the webhook endpoint URL'),
      events: z.array(z.string()).optional().describe('Event types to subscribe to (create/update)'),
      status: z.string().optional().describe('Webhook status (update)'),
      space_id: z.string().optional().describe('Optional space ID to scope the webhook (create)'),
      payload: z.any().optional().describe('Required for process: the raw webhook payload from ClickUp (JSON object)'),
      signature: z.string().optional().describe('The X-Signature header value for HMAC validation (process)'),
      secret: z.string().optional().describe('The webhook secret for HMAC validation (process)'),
    },
    async ({ action, workspace_id, webhook_id, endpoint, events, status, space_id, payload, signature, secret }) => {
      try {
        switch (action) {
          case 'list': {
            if (!workspace_id) throw new Error('workspace_id required for list');
            const result = await webhooksClient.getWebhooks(workspace_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'create': {
            if (!workspace_id || !endpoint || !events?.length) throw new Error('workspace_id, endpoint, and events required for create');
            const result = await webhooksClient.createWebhook(workspace_id, endpoint, events, space_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'update': {
            if (!webhook_id) throw new Error('webhook_id required for update');
            const result = await webhooksClient.updateWebhook(webhook_id, endpoint, events, status);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'delete': {
            if (!webhook_id) throw new Error('webhook_id required for delete');
            await webhooksClient.deleteWebhook(webhook_id);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
          }
          case 'process': {
            if (!payload) throw new Error('payload is required for process');
            const result = parseWebhookPayload(payload, secret, signature);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
        }
      } catch (error: any) {
        console.error('[WebhookTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with webhooks: ${error.message}` }], isError: true };
      }
    }
  );
}
