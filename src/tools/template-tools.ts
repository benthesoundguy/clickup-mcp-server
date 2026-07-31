import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createTemplatesClient } from '../clickup-client/templates.js';

const clickUpClient = createClickUpClient();
const templatesClient = createTemplatesClient(clickUpClient);

export function setupTemplateTools(server: McpServer): void {
  server.tool(
    'templates',
    'Get available task templates in a ClickUp workspace. (The API only exposes task '
    + 'templates; to create a list from a list template use lists_create_from_template_in_folder '
    + 'or lists_create_from_template_in_space.)',
    {
      workspace_id: z.string().describe('The ID of the workspace'),
      page: z.number().optional().describe('Page number (0-based, default 0)')
    },
    async ({ workspace_id, page }) => {
      try {
        const result = await templatesClient.getTaskTemplates(workspace_id, page ?? 0);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        console.error('[TemplateTools] Error:', error);
        return { content: [{ type: 'text', text: `Error getting templates: ${error.message}` }], isError: true };
      }
    }
  );
}
