import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createTemplatesClient } from '../clickup-client/templates.js';

const clickUpClient = createClickUpClient();
const templatesClient = createTemplatesClient(clickUpClient);

export function setupTemplateTools(server: McpServer): void {
  server.tool(
    'templates',
    'Get available templates in a ClickUp workspace. Scope type determines which templates are returned (task, list, or folder templates).',
    {
      workspace_id: z.string().describe('The ID of the workspace'),
      scope_type: z.enum(['task', 'list', 'folder']).describe('The type of templates to get'),
      scope_id: z.string().optional().describe('The ID of the list or folder (required for list/folder scope)')
    },
    async ({ workspace_id, scope_type, scope_id }) => {
      try {
        switch (scope_type) {
          case 'task': {
            const result = await templatesClient.getTaskTemplates(workspace_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'list': {
            if (!scope_id) throw new Error('scope_id is required for list templates');
            const result = await templatesClient.getListTemplates(workspace_id, scope_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'folder': {
            if (!scope_id) throw new Error('scope_id is required for folder templates');
            const result = await templatesClient.getFolderTemplates(workspace_id, scope_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
        }
      } catch (error: any) {
        console.error('[TemplateTools] Error:', error);
        return { content: [{ type: 'text', text: `Error getting templates: ${error.message}` }], isError: true };
      }
    }
  );
}
