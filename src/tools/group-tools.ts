import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createGroupsClient } from '../clickup-client/groups.js';

const clickUpClient = createClickUpClient();
const groupsClient = createGroupsClient(clickUpClient);

export function setupGroupTools(server: McpServer): void {
  server.tool(
    'groups',
    'Manage user groups in a ClickUp workspace. Use action to list, create, update, or delete groups.',
    {
      action: z.enum(['list', 'create', 'update', 'delete']).describe('Action to perform'),
      workspace_id: z.string().optional().describe('Required for list/create: the workspace ID'),
      group_id: z.string().optional().describe('Required for update/delete: the group ID'),
      name: z.string().optional().describe('Required for create: the group name. Optional for update.'),
      add_members: z.array(z.number()).optional().describe('User IDs to add to the group (create/update)'),
      remove_members: z.array(z.number()).optional().describe('User IDs to remove from the group (update)')
    },
    async ({ action, workspace_id, group_id, name, add_members, remove_members }) => {
      try {
        switch (action) {
          case 'list': {
            if (!workspace_id) throw new Error('workspace_id is required for list');
            const result = await groupsClient.getGroups(workspace_id);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'create': {
            if (!workspace_id || !name) throw new Error('workspace_id and name are required for create');
            const result = await groupsClient.createGroup(workspace_id, name, add_members);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'update': {
            if (!group_id) throw new Error('group_id is required for update');
            const changes: { name?: string; members?: { add?: number[]; rem?: number[] } } = {};
            if (name) changes.name = name;
            if (add_members?.length || remove_members?.length) {
              changes.members = { add: add_members, rem: remove_members };
            }
            const result = await groupsClient.updateGroup(group_id, changes);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'delete': {
            if (!group_id) throw new Error('group_id is required for delete');
            const result = await groupsClient.deleteGroup(group_id);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
        }
      } catch (error: any) {
        console.error('[GroupTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with groups: ${error.message}` }], isError: true };
      }
    }
  );
}
