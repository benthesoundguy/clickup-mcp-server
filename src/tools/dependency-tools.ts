import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createDependenciesClient } from '../clickup-client/dependencies.js';

const clickUpClient = createClickUpClient();
const dependenciesClient = createDependenciesClient(clickUpClient);

export function setupDependencyTools(server: McpServer): void {
  // ── Tool 1: dependencies — task-level CRUD + analysis ─────────────────
  server.tool(
    'dependencies',
    'Manage task dependencies. Use action to create, get, update, delete, view dependency graph, check/resolve conflicts, view timeline impact, or bulk create.',
    {
      action: z.enum(['create', 'get', 'update', 'delete', 'graph', 'conflicts', 'resolve', 'bulk', 'timeline'])
        .describe('Action to perform'),
      task_id: z.string().optional().describe('Required for create, get, graph, conflicts, resolve, timeline'),
      depends_on: z.string().optional().describe('Required for create, conflicts: the task this one depends on'),
      dependency_id: z.string().optional().describe('Required for update, delete'),
      dependency_type: z.string().optional().describe('Dependency type (create, update)'),
      workspace_id: z.string().optional().describe('Required for bulk'),
      dependencies: z.array(z.object({
        task_id: z.string(),
        depends_on: z.string(),
        dependency_type: z.string().optional()
      })).optional().describe('Array of dependencies for bulk create'),
    },
    async ({ action, task_id, depends_on, dependency_id, dependency_type, workspace_id, dependencies }) => {
      try {
        switch (action) {
          case 'create': {
            if (!task_id || !depends_on) throw new Error('task_id and depends_on required for create');
            await dependenciesClient.addDependency(task_id, depends_on);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
          }
          case 'get': {
            if (!task_id) throw new Error('task_id required for get');
            const result = await dependenciesClient.getTaskDependencies(task_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'update': {
            if (!dependency_id) throw new Error('dependency_id required for update');
            const result = await dependenciesClient.updateDependency(dependency_id, dependency_type);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'delete': {
            if (!dependency_id) throw new Error('dependency_id required for delete');
            await dependenciesClient.deleteDependency(dependency_id);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
          }
          case 'graph': {
            if (!task_id) throw new Error('task_id required for graph');
            const result = await dependenciesClient.getDependencyGraph(task_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'conflicts': {
            if (!task_id || !depends_on) throw new Error('task_id and depends_on required for conflicts');
            const result = await dependenciesClient.checkDependencyConflicts(task_id, depends_on);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'resolve': {
            if (!task_id) throw new Error('task_id required for resolve');
            const result = await dependenciesClient.resolveDependencyConflicts(task_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'bulk': {
            if (!workspace_id || !dependencies?.length) throw new Error('workspace_id and dependencies required for bulk');
            const result = await dependenciesClient.bulkCreateDependencies(workspace_id, dependencies);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'timeline': {
            if (!task_id) throw new Error('task_id required for timeline');
            const result = await dependenciesClient.getDependencyTimelineImpact(task_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
        }
      } catch (error: any) {
        console.error('[DependencyTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with dependencies: ${error.message}` }], isError: true };
      }
    }
  );

  // ── Tool 2: dependencies_workspace — workspace-level + portability ────
  server.tool(
    'dependencies_workspace',
    'Manage dependencies at the workspace level. Use action to list all dependencies, view stats, or export/import the dependency graph.',
    {
      action: z.enum(['list', 'stats', 'export', 'import']).describe('Action to perform'),
      workspace_id: z.string().describe('The ID of the workspace'),
      page: z.number().optional().describe('Page number for paginated results (list)'),
      data: z.any().optional().describe('Dependency graph data to import (import)'),
    },
    async ({ action, workspace_id, page, data }) => {
      try {
        switch (action) {
          case 'list': {
            const result = await dependenciesClient.getWorkspaceDependencies(workspace_id, page);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'stats': {
            const result = await dependenciesClient.getDependencyStats(workspace_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'export': {
            const result = await dependenciesClient.exportDependencyGraph(workspace_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'import': {
            if (!data) throw new Error('data required for import');
            const result = await dependenciesClient.importDependencyGraph(workspace_id, data);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
        }
      } catch (error: any) {
        console.error('[DependencyTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with workspace dependencies: ${error.message}` }], isError: true };
      }
    }
  );
}
