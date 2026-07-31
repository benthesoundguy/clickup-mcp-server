import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createViewsClient } from '../clickup-client/views.js';
import { shapeTaskList } from './helpers.js';

const clickUpClient = createClickUpClient();
const viewsClient = createViewsClient(clickUpClient);

export function setupViewTools(server: McpServer): void {
  server.tool(
    'views',
    'Manage ClickUp views and view configurations. Use action to list, create, get, update, delete views, '
    + 'set filters/grouping/sorting/settings, or get tasks in a view.',
    {
      action: z.enum([
        'list', 'create', 'get', 'update', 'delete',
        'set_filters', 'set_grouping', 'set_sorting', 'set_settings',
        'view_tasks'
      ]).describe('Action to perform'),

      // Core fields
      list_id: z.string().optional().describe('Required for list, create: the list ID'),
      view_id: z.string().optional().describe('Required for get, update, delete, set_*, view_tasks'),
      name: z.string().optional().describe('View name (create, update)'),
      type: z.number().int().min(1).max(10).optional().describe('View type 1-10 (create): 1=List, 2=Board, 3=Calendar, 4=Gantt, 5=Mind Map, 6=Map, 7=Timeline, 8=Activity, 9=Box, 10=Table'),

      // Configuration fields
      filters: z.array(z.object({
        field: z.string().describe('Field to filter on, e.g. "status", "assignee", "dueDate", "tag"'),
        op: z.string().describe('ClickUp filter operator (field-dependent). Verified working: "EQ", "ANY". Others include "ALL", "NOT ANY", "GT", "LT", "IS SET", "IS NOT SET".'),
        values: z.array(z.any()).optional().describe('Values to compare against')
      })).optional().describe('Filter objects for set_filters, combined with AND. Example: [{field:"status",op:"ANY",values:["in progress"]}]'),
      group_by: z.string().optional().describe('Field to group by (set_grouping)'),
      group_direction: z.enum(['asc', 'desc']).optional().describe('Grouping direction (set_grouping)'),
      sort_by: z.string().optional().describe('Field to sort by (set_sorting)'),
      sort_direction: z.enum(['asc', 'desc']).optional().describe('Sorting direction (set_sorting)'),
      settings: z.record(z.any()).optional().describe(
        'View-type-specific settings object for set_settings (updatable fields only)'),

      // View tasks
      page: z.number().optional().describe('Page number for pagination (view_tasks)'),
    },
    async ({ action, list_id, view_id, name, type, filters, group_by, group_direction,
             sort_by, sort_direction, settings, page }) => {
      try {
        switch (action) {
          case 'list': {
            if (!list_id) throw new Error('list_id required for list');
            const views = await viewsClient.getListViews(list_id);
            return { content: [{ type: 'text', text: JSON.stringify(views) }] };
          }
          case 'create': {
            if (!list_id || !name || !type) throw new Error('list_id, name, and type required for create');
            const view = await viewsClient.createListView(list_id, name, type);
            return { content: [{ type: 'text', text: JSON.stringify(view) }] };
          }
          case 'get': {
            if (!view_id) throw new Error('view_id required for get');
            const view = await viewsClient.getView(view_id);
            return { content: [{ type: 'text', text: JSON.stringify(view) }] };
          }
          case 'update': {
            if (!view_id) throw new Error('view_id required for update');
            const changes: any = {};
            if (name !== undefined) changes.name = name;
            if (type !== undefined) changes.type = type;
            const view = await viewsClient.updateView(view_id, changes);
            return { content: [{ type: 'text', text: JSON.stringify(view) }] };
          }
          case 'delete': {
            if (!view_id) throw new Error('view_id required for delete');
            await viewsClient.deleteView(view_id);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
          }
          case 'set_filters': {
            if (!view_id || !filters) throw new Error('view_id and filters required for set_filters');
            // Real view JSON (probe-verified): filters.fields[].op, container op AND/OR
            const view = await viewsClient.updateView(view_id, {
              filters: { op: 'AND', fields: filters, search: '', show_closed: false }
            });
            return { content: [{ type: 'text', text: JSON.stringify(view) }] };
          }
          case 'set_grouping': {
            if (!view_id || !group_by) throw new Error('view_id and group_by required for set_grouping');
            // grouping.dir is an integer: 1 = ascending, -1 = descending (probe-verified)
            const grouping: any = {
              field: group_by,
              dir: group_direction === 'desc' ? -1 : 1,
              collapsed: [],
              ignore: false
            };
            const view = await viewsClient.updateView(view_id, { grouping });
            return { content: [{ type: 'text', text: JSON.stringify(view) }] };
          }
          case 'set_sorting': {
            if (!view_id || !sort_by) throw new Error('view_id and sort_by required for set_sorting');
            // The view key is `sorting` (not `sortings`); dir: 1 = asc, -1 = desc
            const sorting = { fields: [{ field: sort_by, dir: sort_direction === 'desc' ? -1 : 1 }] };
            const view = await viewsClient.updateView(view_id, { sorting });
            return { content: [{ type: 'text', text: JSON.stringify(view) }] };
          }
          case 'set_settings': {
            if (!view_id || !settings) throw new Error('view_id and settings required for set_settings');
            const view = await viewsClient.updateView(view_id, settings);
            return { content: [{ type: 'text', text: JSON.stringify(view) }] };
          }
          case 'view_tasks': {
            if (!view_id) throw new Error('view_id required for view_tasks');
            const result = await viewsClient.getViewTasks(view_id, page);
            return { content: [{ type: 'text', text: JSON.stringify(shapeTaskList(result.tasks ?? [])) }] };
          }
        }
      } catch (error: any) {
        console.error('[ViewTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with views: ${error.message}` }], isError: true };
      }
    }
  );
}
