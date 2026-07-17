import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createGroupsClient } from '../clickup-client/groups.js';
const clickUpClient = createClickUpClient();
const groupsClient = createGroupsClient(clickUpClient);
export function setupGroupTools(server) {
    server.tool('groups', 'Manage user groups in a ClickUp workspace. Use action to list, create, update, or delete groups.', {
        action: z.enum(['list', 'create', 'update', 'delete']).describe('Action to perform'),
        workspace_id: z.string().describe('The ID of the workspace'),
        group_id: z.string().optional().describe('Required for update/delete: the group ID'),
        name: z.string().optional().describe('Required for create: the group name. Optional for update.')
    }, async ({ action, workspace_id, group_id, name }) => {
        try {
            switch (action) {
                case 'list': {
                    const result = await groupsClient.getGroups(workspace_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'create': {
                    if (!name)
                        throw new Error('name is required for create');
                    const result = await groupsClient.createGroup(workspace_id, name);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'update': {
                    if (!group_id || !name)
                        throw new Error('group_id and name are required for update');
                    const result = await groupsClient.updateGroup(workspace_id, group_id, name);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'delete': {
                    if (!group_id)
                        throw new Error('group_id is required for delete');
                    const result = await groupsClient.deleteGroup(workspace_id, group_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
            }
        }
        catch (error) {
            console.error('[GroupTools] Error:', error);
            return { content: [{ type: 'text', text: `Error with groups: ${error.message}` }], isError: true };
        }
    });
}
//# sourceMappingURL=group-tools.js.map