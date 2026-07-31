import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createCustomFieldsClient } from '../clickup-client/custom-fields.js';

const clickUpClient = createClickUpClient();
const customFieldsClient = createCustomFieldsClient(clickUpClient);

export function setupCustomFieldTools(server: McpServer): void {
  server.tool(
    'custom_fields',
    'List or create custom field definitions. Use "list" to get field schemas at any scope, '
    + 'or "create" to add a field to a list. (The ClickUp API does not support editing or '
    + 'deleting field definitions — that requires the ClickUp UI.)',
    {
      action: z.enum(['list', 'create']).describe('Action to perform'),
      scope_type: z.enum(['list', 'folder', 'space', 'workspace']).optional().describe('The scope level (list action). Create always targets a list.'),
      scope_id: z.string().optional().describe('The ID of the list, folder, space, or workspace'),
      name: z.string().optional().describe('Required for create: the field name'),
      type: z.string().optional().describe('Required for create: field type (text, number, date, checkbox, drop_down, etc.)'),
      required: z.boolean().optional().describe('Whether the field is required (create)'),
      options: z.array(z.object({
        name: z.string(),
        orderindex: z.number()
      })).optional().describe('Dropdown options (required for drop_down type)'),
    },
    async ({ action, scope_type, scope_id, name, type, required, options }) => {
      try {
        switch (action) {
          case 'list': {
            let result;
            switch (scope_type) {
              case 'list': result = await customFieldsClient.getListFields(scope_id!); break;
              case 'folder': result = await customFieldsClient.getFolderFields(scope_id!); break;
              case 'space': result = await customFieldsClient.getSpaceFields(scope_id!); break;
              case 'workspace': result = await customFieldsClient.getWorkspaceFields(scope_id!); break;
              default: throw new Error('scope_type and scope_id required for list');
            }
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'create': {
            if (!scope_id || !name || !type) throw new Error('scope_id (a list ID), name, and type required for create');
            const result = await customFieldsClient.createField(scope_id, { name, type, required, options });
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
        }
      } catch (error: any) {
        console.error('[CustomFieldTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with custom fields: ${error.message}` }], isError: true };
      }
    }
  );
}
