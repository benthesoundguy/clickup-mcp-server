import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createGuestsClient } from '../clickup-client/guests.js';

const clickUpClient = createClickUpClient();
const guestsClient = createGuestsClient(clickUpClient);

export function setupGuestTools(server: McpServer): void {
  server.tool(
    'guests_invite',
    'Invite a guest to a ClickUp workspace.',
    {
      workspace_id: z.string().describe('The ID of the workspace'),
      email: z.string().describe('The email address of the guest'),
      can_edit_tags: z.boolean().optional().describe('Whether the guest can edit tags')
    },
    async ({ workspace_id, email, can_edit_tags }) => {
      try {
        const result = await guestsClient.inviteGuest(workspace_id, email, can_edit_tags);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'guests_get',
    'Get details about a specific guest in the workspace.',
    {
      workspace_id: z.string().describe('The ID of the workspace'),
      guest_id: z.number().describe('The ID of the guest')
    },
    async ({ workspace_id, guest_id }) => {
      try {
        const result = await guestsClient.getGuest(workspace_id, guest_id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'guests_update',
    'Update a guest\'s permissions or details in the workspace.',
    {
      workspace_id: z.string().describe('The ID of the workspace'),
      guest_id: z.number().describe('The ID of the guest'),
      can_edit_tags: z.boolean().optional().describe('Whether the guest can edit tags')
    },
    async ({ workspace_id, guest_id, ...data }) => {
      try {
        const result = await guestsClient.editGuest(workspace_id, guest_id, data);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'guests_remove',
    'Remove a guest from the workspace entirely.',
    {
      workspace_id: z.string().describe('The ID of the workspace'),
      guest_id: z.number().describe('The ID of the guest to remove')
    },
    async ({ workspace_id, guest_id }) => {
      try {
        const result = await guestsClient.removeGuest(workspace_id, guest_id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'guests_attach',
    'Grant a guest access to a specific location (task, list, or folder).',
    {
      guest_id: z.number().describe('The ID of the guest'),
      location_type: z.enum(['task', 'list', 'folder']).describe('The type of location'),
      location_id: z.string().describe('The ID of the task, list, or folder'),
      permission_level: z.string().optional().describe('Permission level (read, write, comment)')
    },
    async ({ guest_id, location_type, location_id, permission_level }) => {
      try {
        let result;
        switch (location_type) {
          case 'task':
            result = await guestsClient.addToTask(guest_id, location_id, permission_level);
            break;
          case 'list':
            result = await guestsClient.addToList(guest_id, location_id, permission_level);
            break;
          case 'folder':
            result = await guestsClient.addToFolder(guest_id, location_id, permission_level);
            break;
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'guests_detach',
    'Remove a guest\'s access from a task, list, or folder.',
    {
      guest_id: z.number().describe('The ID of the guest'),
      location_type: z.enum(['task', 'list', 'folder']).describe('The type of location'),
      location_id: z.string().describe('The ID of the task, list, or folder')
    },
    async ({ guest_id, location_type, location_id }) => {
      try {
        let result;
        switch (location_type) {
          case 'task':
            result = await guestsClient.removeFromTask(guest_id, location_id);
            break;
          case 'list':
            result = await guestsClient.removeFromList(guest_id, location_id);
            break;
          case 'folder':
            result = await guestsClient.removeFromFolder(guest_id, location_id);
            break;
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
