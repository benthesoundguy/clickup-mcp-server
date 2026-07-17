import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createTagsClient } from '../clickup-client/tags.js';
const clickUpClient = createClickUpClient();
const tagsClient = createTagsClient(clickUpClient);
export function setupTagTools(server) {
    server.tool('tags', 'Manage space tags. Use action to list, create, update, or delete tags in a space.', {
        action: z.enum(['list', 'create', 'update', 'delete']).describe('Action to perform'),
        space_id: z.string().describe('The ID of the space'),
        name: z.string().optional().describe('Required for create: the tag name. For update: new name.'),
        tag_name: z.string().optional().describe('Required for update/delete: the current tag name'),
        tag_bg: z.string().optional().describe('Background color hex for create/update, e.g. "#000000"'),
        tag_fg: z.string().optional().describe('Foreground color hex for create/update, e.g. "#FFFFFF"')
    }, async ({ action, space_id, name, tag_name, tag_bg, tag_fg }) => {
        try {
            switch (action) {
                case 'list': {
                    const tags = await tagsClient.getSpaceTags(space_id);
                    return { content: [{ type: 'text', text: JSON.stringify(tags, null, 2) }] };
                }
                case 'create': {
                    if (!name)
                        throw new Error('name is required for create');
                    await tagsClient.createSpaceTag(space_id, name, tag_bg, tag_fg);
                    return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
                }
                case 'update': {
                    if (!tag_name)
                        throw new Error('tag_name is required for update');
                    await tagsClient.editSpaceTag(space_id, tag_name, name, tag_bg, tag_fg);
                    return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
                }
                case 'delete': {
                    if (!tag_name)
                        throw new Error('tag_name is required for delete');
                    await tagsClient.deleteSpaceTag(space_id, tag_name);
                    return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
                }
            }
        }
        catch (error) {
            console.error('[TagTools] Error:', error);
            return { content: [{ type: 'text', text: `Error with tags: ${error.message}` }], isError: true };
        }
    });
    server.tool('tags_assign', 'Add a tag to a ClickUp task. The tag must already exist in the space.', { task_id: z.string(), tag_name: z.string().describe('The name of the tag to add') }, async ({ task_id, tag_name }) => {
        try {
            await tagsClient.addTagToTask(task_id, tag_name);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
        }
        catch (error) {
            console.error('[TagTools] Error assigning tag:', error);
            return { content: [{ type: 'text', text: `Error assigning tag: ${error.message}` }], isError: true };
        }
    });
    server.tool('tags_unassign', 'Remove a tag from a ClickUp task.', { task_id: z.string(), tag_name: z.string() }, async ({ task_id, tag_name }) => {
        try {
            await tagsClient.removeTagFromTask(task_id, tag_name);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
        }
        catch (error) {
            console.error('[TagTools] Error unassigning tag:', error);
            return { content: [{ type: 'text', text: `Error unassigning tag: ${error.message}` }], isError: true };
        }
    });
}
//# sourceMappingURL=tag-tools.js.map