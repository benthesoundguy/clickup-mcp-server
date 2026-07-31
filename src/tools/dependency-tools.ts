import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createDependenciesClient } from '../clickup-client/dependencies.js';

const clickUpClient = createClickUpClient();
const dependenciesClient = createDependenciesClient(clickUpClient);

export function setupDependencyTools(server: McpServer): void {
  server.tool(
    'dependencies',
    'Manage task dependencies. Use action "create" to make one task depend on another, '
    + '"delete" to remove that link, or "get" to read a task\'s dependencies. '
    + 'For dependency graph analysis, conflicts, and blocked-task detection across a list, '
    + 'use project_intelligence with report "dependencies".',
    {
      action: z.enum(['create', 'get', 'delete']).describe('Action to perform'),
      task_id: z.string().describe('The task the dependency belongs to'),
      depends_on: z.string().optional().describe('Required for create/delete: the task that task_id depends on (is blocked by)'),
    },
    async ({ action, task_id, depends_on }) => {
      try {
        switch (action) {
          case 'create': {
            if (!depends_on) throw new Error('depends_on required for create');
            await dependenciesClient.addDependency(task_id, depends_on);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
          }
          case 'get': {
            const result = await dependenciesClient.getTaskDependencies(task_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'delete': {
            if (!depends_on) throw new Error('depends_on required for delete');
            await dependenciesClient.removeDependency(task_id, depends_on);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
          }
        }
      } catch (error: any) {
        console.error('[DependencyTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with dependencies: ${error.message}` }], isError: true };
      }
    }
  );
}
