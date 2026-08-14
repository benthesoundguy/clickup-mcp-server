import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createTagsClient } from '../clickup-client/tags.js';

const clickUpClient = createClickUpClient();
const tagsClient = createTagsClient(clickUpClient);

export function setupTagTools(server: McpServer): void {
  server.tool(
    'tags',
    'Manage space tags. Use action to list, create, update, or delete tags in a space.',
    {
      action: z.enum(['list', 'create', 'update', 'delete']).describe('Action to perform'),
      space_id: z.string().describe('The ID of the space'),
      name: z.string().optional().describe('CREATE: the new tag name. UPDATE: the replacement name. Not used by list/delete.'),
      tag_name: z.string().optional().describe('UPDATE/DELETE: the EXISTING tag to act on. Not used by create — use `name` there. (ClickUp stores tag names lower-cased.)'),
      tag_bg: z.string().optional().describe('Background color hex for create/update, e.g. "#000000"'),
      tag_fg: z.string().optional().describe('Foreground color hex for create/update, e.g. "#FFFFFF"')
    },
    async ({ action, space_id, name, tag_name, tag_bg, tag_fg }) => {
      try {
        switch (action) {
          case 'list': {
            const tags = await tagsClient.getSpaceTags(space_id);
            return { content: [{ type: 'text', text: JSON.stringify(tags) }] };
          }
          case 'create': {
            if (!name) throw new Error('name is required for create');
            await tagsClient.createSpaceTag(space_id, name, tag_bg, tag_fg);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
          }
          case 'update': {
            if (!tag_name) throw new Error('tag_name is required for update');
            await tagsClient.editSpaceTag(space_id, tag_name, name, tag_bg, tag_fg);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
          }
          case 'delete': {
            if (!tag_name) throw new Error('tag_name is required for delete');
            await tagsClient.deleteSpaceTag(space_id, tag_name);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
          }
        }
      } catch (error: any) {
        console.error('[TagTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with tags: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'tags_assign',
    'Add tags to tasks. Single form: task_id + tag_name. Bulk form: assignments '
    + '[{task_id, tags:[...]}] — tags many tasks in one call with rate-limit pacing. '
    + 'Tags must already exist in the space.',
    {
      task_id: z.string().optional().describe('Single form: the task to tag'),
      tag_name: z.string().optional().describe('Single form: the tag to add'),
      assignments: z.array(z.object({
        task_id: z.string(),
        tags: z.array(z.string()).min(1)
      })).max(50).optional().describe('Bulk form: up to 50 {task_id, tags[]} entries'),
      continue_on_error: z.boolean().optional().default(true).describe('Bulk form: keep going if one assignment fails')
    },
    async ({ task_id, tag_name, assignments, continue_on_error }) => {
      try {
        if (assignments?.length) {
          const results: Array<{ task_id: string; tag: string; status: string; error?: string }> = [];
          let succeeded = 0, failed = 0, first = true;
          outer: for (const a of assignments) {
            for (const tag of a.tags) {
              if (!first) await new Promise<void>(r => setTimeout(r, 150));
              first = false;
              try {
                await tagsClient.addTagToTask(a.task_id, tag);
                results.push({ task_id: a.task_id, tag, status: 'assigned' });
                succeeded++;
              } catch (error: any) {
                results.push({ task_id: a.task_id, tag, status: 'failed', error: error.message });
                failed++;
                if (!continue_on_error) break outer;
              }
            }
          }
          return {
            content: [{ type: 'text', text: JSON.stringify({
              summary: `Assigned ${succeeded} tag(s)${failed ? `, ${failed} failed` : ''}`,
              succeeded, failed, results
            }) }],
            ...(failed > 0 ? { isError: true } : {})
          };
        }
        if (!task_id || !tag_name) throw new Error('Provide task_id + tag_name, or assignments[] for bulk');
        await tagsClient.addTagToTask(task_id, tag_name);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (error: any) {
        console.error('[TagTools] Error assigning tag:', error);
        return { content: [{ type: 'text', text: `Error assigning tag: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'tags_unassign',
    'Remove tags from tasks. Single form: task_id + tag_name. Bulk form: assignments [{task_id, tags:[...]}].',
    {
      task_id: z.string().optional().describe('Single form: the task'),
      tag_name: z.string().optional().describe('Single form: the tag to remove'),
      assignments: z.array(z.object({
        task_id: z.string(),
        tags: z.array(z.string()).min(1)
      })).max(50).optional().describe('Bulk form: up to 50 {task_id, tags[]} entries'),
      continue_on_error: z.boolean().optional().default(true)
    },
    async ({ task_id, tag_name, assignments, continue_on_error }) => {
      try {
        if (assignments?.length) {
          const results: Array<{ task_id: string; tag: string; status: string; error?: string }> = [];
          let succeeded = 0, failed = 0, first = true;
          outer: for (const a of assignments) {
            for (const tag of a.tags) {
              if (!first) await new Promise<void>(r => setTimeout(r, 150));
              first = false;
              try {
                await tagsClient.removeTagFromTask(a.task_id, tag);
                results.push({ task_id: a.task_id, tag, status: 'removed' });
                succeeded++;
              } catch (error: any) {
                results.push({ task_id: a.task_id, tag, status: 'failed', error: error.message });
                failed++;
                if (!continue_on_error) break outer;
              }
            }
          }
          return {
            content: [{ type: 'text', text: JSON.stringify({
              summary: `Removed ${succeeded} tag(s)${failed ? `, ${failed} failed` : ''}`,
              succeeded, failed, results
            }) }],
            ...(failed > 0 ? { isError: true } : {})
          };
        }
        if (!task_id || !tag_name) throw new Error('Provide task_id + tag_name, or assignments[] for bulk');
        await tagsClient.removeTagFromTask(task_id, tag_name);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (error: any) {
        console.error('[TagTools] Error unassigning tag:', error);
        return { content: [{ type: 'text', text: `Error unassigning tag: ${error.message}` }], isError: true };
      }
    }
  );
}
