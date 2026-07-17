import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createCustomFieldsClient } from '../clickup-client/custom-fields.js';

// Create clients
const clickUpClient = createClickUpClient();
const customFieldsClient = createCustomFieldsClient(clickUpClient);

export function setupCustomFieldTools(server: McpServer): void {
  // Register get_list_custom_fields tool
  server.tool(
    'get_list_custom_fields',
    'Get custom field definitions for a list. Returns field IDs, names, types, '
    + 'and dropdown option UUIDs (essential before setting field values). '
    + 'Check the `required` field before creating tasks with check_required_custom_fields=true.',
    { list_id: z.string().describe('The ID of the list to get custom fields from') },
    async ({ list_id }) => {
      try {
        console.error(`[CustomFieldTools] Getting fields for list ${list_id}...`);
        const fields = await customFieldsClient.getListFields(list_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(fields, null, 2) }]
        };
      } catch (error: any) {
        console.error('Error getting list custom fields:', error);
        return {
          content: [{ type: 'text', text: `Error getting list custom fields: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  // Register get_folder_custom_fields tool
  server.tool(
    'get_folder_custom_fields',
    'Get custom field definitions for a folder. Returns field IDs, names, types, and dropdown option UUIDs.',
    { folder_id: z.string().describe('The ID of the folder to get custom fields from') },
    async ({ folder_id }) => {
      try {
        console.error(`[CustomFieldTools] Getting fields for folder ${folder_id}...`);
        const fields = await customFieldsClient.getFolderFields(folder_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(fields, null, 2) }]
        };
      } catch (error: any) {
        console.error('Error getting folder custom fields:', error);
        return {
          content: [{ type: 'text', text: `Error getting folder custom fields: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  // Register get_space_custom_fields tool
  server.tool(
    'get_space_custom_fields',
    'Get custom field definitions for a space. Returns field IDs, names, types, and dropdown option UUIDs.',
    { space_id: z.string().describe('The ID of the space to get custom fields from') },
    async ({ space_id }) => {
      try {
        console.error(`[CustomFieldTools] Getting fields for space ${space_id}...`);
        const fields = await customFieldsClient.getSpaceFields(space_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(fields, null, 2) }]
        };
      } catch (error: any) {
        console.error('Error getting space custom fields:', error);
        return {
          content: [{ type: 'text', text: `Error getting space custom fields: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  // Register get_workspace_custom_fields tool
  server.tool(
    'get_workspace_custom_fields',
    'Get custom field definitions for an entire workspace. Returns field IDs, names, types, and dropdown option UUIDs.',
    { workspace_id: z.string().describe('The ID of the workspace to get custom fields from') },
    async ({ workspace_id }) => {
      try {
        console.error(`[CustomFieldTools] Getting fields for workspace ${workspace_id}...`);
        const fields = await customFieldsClient.getWorkspaceFields(workspace_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(fields, null, 2) }]
        };
      } catch (error: any) {
        console.error('Error getting workspace custom fields:', error);
        return {
          content: [{ type: 'text', text: `Error getting workspace custom fields: ${error.message}` }],
          isError: true
        };
      }
    }
  );
}
