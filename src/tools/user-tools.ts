import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createUsersClient } from '../clickup-client/users.js';

const clickUpClient = createClickUpClient();
const usersClient = createUsersClient(clickUpClient);

export function setupUserTools(server: McpServer): void {
  server.tool(
    'users_list',
    'List all users in a ClickUp workspace.',
    {
      workspace_id: z.string().describe('The ID of the workspace')
    },
    async ({ workspace_id }) => {
      try {
        const result = await usersClient.getUsers(workspace_id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'users_invite',
    'Invite a user to a ClickUp workspace by email.',
    {
      workspace_id: z.string().describe('The ID of the workspace'),
      email: z.string().describe('The email address of the user to invite'),
      admin: z.boolean().optional().describe('Whether the user should be an admin')
    },
    async ({ workspace_id, email, admin }) => {
      try {
        const result = await usersClient.inviteUser(workspace_id, email, admin);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'users_update',
    "Update a user's details in the workspace.",
    {
      workspace_id: z.string().describe('The ID of the workspace'),
      user_id: z.number().describe('The ID of the user to update'),
      data: z.record(z.any()).describe('The fields to update on the user')
    },
    async ({ workspace_id, user_id, data }) => {
      try {
        const result = await usersClient.editUser(workspace_id, user_id, data);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'users_remove',
    'Remove a user from a ClickUp workspace.',
    {
      workspace_id: z.string().describe('The ID of the workspace'),
      user_id: z.number().describe('The ID of the user to remove')
    },
    async ({ workspace_id, user_id }) => {
      try {
        const result = await usersClient.removeUser(workspace_id, user_id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
