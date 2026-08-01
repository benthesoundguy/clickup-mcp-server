import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient, getAllPages } from '../clickup-client/index.js';
import { createTasksClient, CreateTaskParams, UpdateTaskParams } from '../clickup-client/tasks.js';
import { createListsClient } from '../clickup-client/lists.js';
import { createFoldersClient } from '../clickup-client/folders.js';
import { createAuthClient } from '../clickup-client/auth.js';
import { shapeTaskList, normalizeTaskDates } from './helpers.js';

// Create clients
const clickUpClient = createClickUpClient();
const tasksClient = createTasksClient(clickUpClient);
const listsClient = createListsClient(clickUpClient);
const foldersClient = createFoldersClient(clickUpClient);
const authClient = createAuthClient(clickUpClient);

export function setupTaskTools(server: McpServer): void {
  // Workspace and Auth tools
  server.tool(
    'workspaces_seats_get',
    'Get information about seats (user licenses) in a ClickUp workspace. Returns details about seat allocation and availability.',
    { workspace_id: z.string().describe('The ID of the workspace to get seats information for') },
    async ({ workspace_id }) => {
      try {
        const result = await authClient.getWorkspaceSeats(workspace_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error getting workspace seats:', error);
        return {
          content: [{ type: 'text', text: `Error getting workspace seats: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'workspaces_list',
    'Get a list of all ClickUp workspaces accessible to the authenticated user. Returns workspace IDs, names, and metadata.',
    {},
    async () => {
      try {
        const result = await authClient.getWorkspaces();
        return {
          content: [{ type: 'text', text: JSON.stringify(result.teams) }]
        };
      } catch (error: any) {
        console.error('Error getting workspaces:', error);
        return {
          content: [{ type: 'text', text: `Error getting workspaces: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  // Task tools
  server.tool(
    'tasks_list',
    'Get tasks from a ClickUp list. Returns a lean view by default (id, name, status, '
    + 'assignees, dates, priority, url); pass detail:"full" for complete task objects or '
    + 'fields:[...] to pick specific fields. Fetches all pages automatically unless page is given.',
    {
      list_id: z.string().describe('The ID of the list to get tasks from'),
      include_closed: z.boolean().optional().describe('Whether to include closed tasks'),
      subtasks: z.boolean().optional().describe('Whether to include subtasks in the results'),
      page: z.number().optional().describe('Fetch a single specific page (0-based) instead of all pages'),
      order_by: z.string().optional().describe('The field to order by'),
      reverse: z.boolean().optional().describe('Whether to reverse the order'),
      detail: z.enum(['lean', 'full']).optional().describe('Response shape: lean (default) or full raw task objects'),
      fields: z.array(z.string()).optional().describe('Specific task fields to return (overrides detail)')
    },
    async ({ list_id, detail, fields, page, ...params }) => {
      try {
        let tasks: any[];
        let complete = true;
        if (page !== undefined) {
          const result = await tasksClient.getTasksFromList(list_id, { ...params, page });
          tasks = result.tasks ?? [];
        } else {
          const paged = await getAllPages(
            async (p) => ({ items: (await tasksClient.getTasksFromList(list_id, { ...params, page: p })).tasks ?? [] }),
            { pageSize: 100, maxPages: 20 }
          );
          tasks = paged.items;
          complete = paged.complete;
        }
        return { content: [{ type: 'text', text: JSON.stringify(shapeTaskList(tasks, { detail, fields, complete })) }] };
      } catch (error: any) {
        console.error('Error getting tasks:', error);
        return {
          content: [{ type: 'text', text: `Error getting tasks: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'tasks_get',
    'Get detailed information about a specific ClickUp task. Returns comprehensive task data including description, assignees, status, and dates.',
    {
      task_id: z.string().describe('The ID of the task to get'),
      include_subtasks: z.boolean().optional().describe('Whether to include subtasks in the task details')
    },
    async ({ task_id, include_subtasks }) => {
      try {
        const task = await tasksClient.getTask(task_id, { include_subtasks });
        return {
          content: [{ type: 'text', text: JSON.stringify(task) }]
        };
      } catch (error: any) {
        console.error('Error getting task details:', error);
        return {
          content: [{ type: 'text', text: `Error getting task details: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'tasks_create',
    'Create a new task in a ClickUp list with specified properties like name, description, assignees, status, and dates.',
    {
      list_id: z.string().describe('The ID of the list to create the task in'),
      name: z.string().describe('The name of the task'),
      description: z.string().optional().describe('The description of the task'),
      assignees: z.array(z.number()).optional().describe('The IDs of the users to assign to the task'),
      tags: z.array(z.string()).optional().describe('The tags to add to the task'),
      status: z.string().optional().describe('The status of the task'),
      priority: z.number().optional().describe('The priority of the task (1-4)'),
      due_date: z.union([z.number(), z.string()]).optional().describe('Due date: Unix ms, "YYYY-MM-DD", or "YYYY-MM-DD HH:MM" (local time)'),
      due_date_time: z.boolean().optional().describe('Whether the due date includes a time (inferred from the date format if omitted)'),
      time_estimate: z.number().optional().describe('The time estimate for the task (in milliseconds)'),
      start_date: z.union([z.number(), z.string()]).optional().describe('Start date: Unix ms, "YYYY-MM-DD", or "YYYY-MM-DD HH:MM" (local time)'),
      start_date_time: z.boolean().optional().describe('Whether the start date includes a time (inferred from the date format if omitted)'),
      notify_all: z.boolean().optional().describe('Whether to notify all assignees'),
      parent: z.string().optional().describe('The ID of the parent task'),
      task_type: z.string().optional().describe('Task type name — e.g. "Bug", "Feature", "Milestone". Must match an existing task type in the workspace.')
    },
    async ({ list_id, ...taskParams }) => {
      try {
        const result = await tasksClient.createTask(list_id, normalizeTaskDates(taskParams) as CreateTaskParams);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error creating task:', error);
        return {
          content: [{ type: 'text', text: `Error creating task: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'tasks_update',
    'Update an existing ClickUp task\'s properties including name, description, assignees, status, and dates.',
    {
      task_id: z.string().describe('The ID of the task to update'),
      name: z.string().optional().describe('The new name of the task'),
      description: z.string().optional().describe('The new description of the task'),
      assignees: z.array(z.number()).optional().describe('The IDs of the users to assign to the task'),
      status: z.string().optional().describe('The new status of the task'),
      priority: z.number().optional().describe('The new priority of the task (1-4)'),
      due_date: z.union([z.number(), z.string()]).optional().describe('Due date: Unix ms, "YYYY-MM-DD", or "YYYY-MM-DD HH:MM" (local time)'),
      due_date_time: z.boolean().optional().describe('Whether the due date includes a time (inferred from the date format if omitted)'),
      time_estimate: z.number().optional().describe('The new time estimate for the task (in milliseconds)'),
      start_date: z.union([z.number(), z.string()]).optional().describe('Start date: Unix ms, "YYYY-MM-DD", or "YYYY-MM-DD HH:MM" (local time)'),
      start_date_time: z.boolean().optional().describe('Whether the start date includes a time (inferred from the date format if omitted)'),
      notify_all: z.boolean().optional().describe('Whether to notify all assignees'),
      task_type: z.string().optional().describe('Task type name — e.g. "Bug", "Feature", "Milestone". Must match an existing task type in the workspace.')
    },
    async ({ task_id, ...taskParams }) => {
      try {
        const result = await tasksClient.updateTask(task_id, normalizeTaskDates(taskParams) as UpdateTaskParams);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error updating task:', error);
        return {
          content: [{ type: 'text', text: `Error updating task: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  // List and Folder tools
  server.tool(
    'lists_search',
    'Search for lists in a ClickUp folder or space. Returns list details including name and content.',
    {
      container_type: z.enum(['folder', 'space']).describe('The type of container to get lists from'),
      container_id: z.string().describe('The ID of the container to get lists from')
    },
    async ({ container_type, container_id }) => {
      try {
        let result;
        if (container_type === 'folder') {
          result = await foldersClient.getListsFromFolder(container_id);
        } else if (container_type === 'space') {
          result = await listsClient.getListsFromSpace(container_id);
        } else {
          throw new Error('Invalid container_type. Must be one of: folder, space');
        }
        
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error(`Error getting lists from ${container_type}:`, error);
        return {
          content: [{ type: 'text', text: `Error getting lists: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'folders_create',
    'Create a new folder in a ClickUp space with the specified name.',
    {
      space_id: z.string().describe('The ID of the space to create the folder in'),
      name: z.string().describe('The name of the folder')
    },
    async ({ space_id, name }) => {
      try {
        const result = await foldersClient.createFolder(space_id, { name });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error creating folder:', error);
        return {
          content: [{ type: 'text', text: `Error creating folder: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'folders_update',
    'Update an existing ClickUp folder\'s name.',
    {
      folder_id: z.string().describe('The ID of the folder to update'),
      name: z.string().describe('The new name of the folder')
    },
    async ({ folder_id, name }) => {
      try {
        const result = await foldersClient.updateFolder(folder_id, { name });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error updating folder:', error);
        return {
          content: [{ type: 'text', text: `Error updating folder: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'folders_delete',
    'Delete a folder from ClickUp. Removes the folder and its contents.',
    {
      folder_id: z.string().describe('The ID of the folder to delete')
    },
    async ({ folder_id }) => {
      try {
        const result = await foldersClient.deleteFolder(folder_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error deleting folder:', error);
        return {
          content: [{ type: 'text', text: `Error deleting folder: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'lists_list_in_space',
    'Get lists that are not in any folder within a ClickUp space.',
    {
      space_id: z.string().describe('The ID of the space to get folderless lists from')
    },
    async ({ space_id }) => {
      try {
        const result = await listsClient.getListsFromSpace(space_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error getting folderless lists:', error);
        return {
          content: [{ type: 'text', text: `Error getting folderless lists: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'lists_create',
    'Create a new list in a ClickUp folder or space with the specified name.',
    {
      container_type: z.enum(['folder', 'space']).describe('The type of container to create the list in'),
      container_id: z.string().describe('The ID of the container to create the list in'),
      name: z.string().describe('The name of the list')
    },
    async ({ container_type, container_id, name }) => {
      try {
        let result;
        if (container_type === 'folder') {
          result = await listsClient.createListInFolder(container_id, { name });
        } else if (container_type === 'space') {
          result = await listsClient.createFolderlessList(container_id, { name });
        } else {
          throw new Error('Invalid container_type. Must be one of: folder, space');
        }
        
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error(`Error creating list in ${container_type}:`, error);
        return {
          content: [{ type: 'text', text: `Error creating list: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'lists_create_in_space',
    'Create a new list directly in a ClickUp space without placing it in a folder.',
    {
      space_id: z.string().describe('The ID of the space to create the folderless list in'),
      name: z.string().describe('The name of the folderless list')
    },
    async ({ space_id, name }) => {
      try {
        const result = await listsClient.createFolderlessList(space_id, { name });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error creating folderless list:', error);
        return {
          content: [{ type: 'text', text: `Error creating folderless list: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'lists_get',
    'Get details about a specific ClickUp list including its name and content.',
    {
      list_id: z.string().describe('The ID of the list to get')
    },
    async ({ list_id }) => {
      try {
        const result = await listsClient.getList(list_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error getting list:', error);
        return {
          content: [{ type: 'text', text: `Error getting list: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'lists_update',
    'Update an existing ClickUp list\'s name.',
    {
      list_id: z.string().describe('The ID of the list to update'),
      name: z.string().describe('The new name of the list')
    },
    async ({ list_id, name }) => {
      try {
        const result = await listsClient.updateList(list_id, { name });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error updating list:', error);
        return {
          content: [{ type: 'text', text: `Error updating list: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'lists_delete',
    'Delete a list from ClickUp. Removes the list and its tasks.',
    {
      list_id: z.string().describe('The ID of the list to delete')
    },
    async ({ list_id }) => {
      try {
        const result = await listsClient.deleteList(list_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error deleting list:', error);
        return {
          content: [{ type: 'text', text: `Error deleting list: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'tasks_move',
    'MOVE a task to a different home list (a true move, not a link). '
    + 'Prefer this over tasks_link/tasks_unlink when relocating a task. '
    + 'status_mappings is only needed when the task\'s current status does not exist in the destination list.',
    {
      workspace_id: z.string().describe('The workspace ID'),
      task_id: z.string().describe('The task to move'),
      list_id: z.string().describe('The destination list (becomes the task\'s new home list)'),
      status_mappings: z.array(z.object({
        from_status: z.string(),
        to_status: z.string()
      })).optional().describe('Map statuses that don\'t exist in the destination: [{from_status, to_status}]')
    },
    async ({ workspace_id, task_id, list_id, status_mappings }) => {
      try {
        const result = await tasksClient.moveTask(workspace_id, task_id, list_id, status_mappings);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error: any) {
        console.error('Error moving task:', error);
        return { content: [{ type: 'text', text: `Error moving task: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'tasks_link',
    'Add an existing task to an ADDITIONAL list (tasks-in-multiple-lists). '
    + 'The task keeps its home list. To relocate a task, use tasks_move instead — '
    + 'link+unlink is not a move and can leave the task in two lists if interrupted.',
    {
      list_id: z.string().describe('The ID of the list to add the task to'),
      task_id: z.string().describe('The ID of the task to add')
    },
    async ({ list_id, task_id }) => {
      try {
        const result = await listsClient.addTaskToList(list_id, task_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error adding task to list:', error);
        return {
          content: [{ type: 'text', text: `Error adding task to list: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'tasks_unlink',
    'Remove a task from an ADDITIONAL list it was linked to (tasks-in-multiple-lists). '
    + 'Refuses to remove a task from its home list — use tasks_move for that.',
    {
      list_id: z.string().describe('The ID of the list to remove the task from'),
      task_id: z.string().describe('The ID of the task to remove')
    },
    async ({ list_id, task_id }) => {
      try {
        // Guard: unlinking from the home list is not a valid operation and
        // half-executed link/unlink sequences have stranded tasks before.
        const task = await tasksClient.getTask(task_id);
        if (task.list?.id && String(task.list.id) === String(list_id)) {
          return {
            content: [{ type: 'text', text: `Refused: list ${list_id} is this task's HOME list. Unlinking from the home list is not supported — use tasks_move to relocate the task instead.` }],
            isError: true
          };
        }
        const result = await listsClient.removeTaskFromList(list_id, task_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error removing task from list:', error);
        return {
          content: [{ type: 'text', text: `Error removing task from list: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'lists_create_from_template_in_folder',
    'Create a new list in a ClickUp folder using an existing template.',
    {
      folder_id: z.string().describe('The ID of the folder to create the list in'),
      template_id: z.string().describe('The ID of the template to use'),
      name: z.string().describe('The name of the list')
    },
    async ({ folder_id, template_id, name }) => {
      try {
        const result = await listsClient.createListFromTemplateInFolder(folder_id, template_id, { name });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error creating list from template in folder:', error);
        return {
          content: [{ type: 'text', text: `Error creating list from template in folder: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'lists_create_from_template_in_space',
    'Create a new list in a ClickUp space using an existing template.',
    {
      space_id: z.string().describe('The ID of the space to create the list in'),
      template_id: z.string().describe('The ID of the template to use'),
      name: z.string().describe('The name of the list')
    },
    async ({ space_id, template_id, name }) => {
      try {
        const result = await listsClient.createListFromTemplateInSpace(space_id, template_id, { name });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error: any) {
        console.error('Error creating list from template in space:', error);
        return {
          content: [{ type: 'text', text: `Error creating list from template in space: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'tasks_delete',
    'Delete a ClickUp task permanently.',
    { task_id: z.string().describe('The ID of the task to delete') },
    async ({ task_id }) => {
      try {
        console.error(`[TaskTools] Deleting task ${task_id}...`);
        await tasksClient.deleteTask(task_id);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true }) }]
        };
      } catch (error: any) {
        console.error('Error deleting task:', error);
        return {
          content: [{ type: 'text', text: `Error deleting task: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'tasks_members_list',
    'Get members assigned to a ClickUp task. Returns user IDs, usernames, and emails.',
    { task_id: z.string().describe('The ID of the task to get members for') },
    async ({ task_id }) => {
      try {
        console.error(`[TaskTools] Getting members for task ${task_id}...`);
        const members = await tasksClient.getTaskMembers(task_id);
        return { content: [{ type: 'text', text: JSON.stringify(members) }] };
      } catch (error: any) {
        console.error('[TaskTools] Error getting task members:', error);
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'lists_members_list',
    'Get members assigned to a ClickUp list. Returns user IDs, usernames, and emails.',
    { list_id: z.string().describe('The ID of the list to get members for') },
    async ({ list_id }) => {
      try {
        console.error(`[TaskTools] Getting members for list ${list_id}...`);
        const members = await listsClient.getListMembers(list_id);
        return { content: [{ type: 'text', text: JSON.stringify(members) }] };
      } catch (error: any) {
        console.error('[TaskTools] Error getting list members:', error);
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'tasks_create_bulk',
    'Create multiple tasks in a ClickUp list in a single operation. More efficient than creating tasks individually. Supports up to 50 tasks per call.',
    {
      list_id: z.string().describe('The ID of the list to create tasks in'),
      tasks: z.array(z.object({
        name: z.string().describe('Task name'),
        description: z.string().optional().describe('Task description'),
        assignees: z.array(z.number()).optional().describe('Assignee user IDs'),
        tags: z.array(z.string()).optional().describe('Tag names'),
        status: z.string().optional().describe('Task status'),
        priority: z.number().optional().describe('Priority (1-4)'),
        due_date: z.union([z.number(), z.string()]).optional().describe('Due date: Unix ms, "YYYY-MM-DD", or "YYYY-MM-DD HH:MM"'),
        time_estimate: z.number().optional().describe('Time estimate in milliseconds'),
        parent: z.string().optional().describe('Parent task ID for subtasks')
      })).min(1).max(50).describe('Array of tasks to create (1-50)'),
      continue_on_error: z.boolean().optional().default(false).describe('Continue creating remaining tasks if one fails')
    },
    async ({ list_id, tasks, continue_on_error }) => {
      try {
        const result = await tasksClient.bulkCreateTasks(list_id, tasks.map(t => normalizeTaskDates({ ...t })) as any, continue_on_error);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            summary: `Created ${result.succeeded} of ${tasks.length} tasks${result.failed ? `, ${result.failed} failed` : ''}${result.stopped_early ? ' (stopped at first failure)' : ''}`,
            succeeded: result.succeeded,
            failed: result.failed,
            results: result.results.map(r => ({ index: r.index, status: r.status, task_id: r.task?.id, error: r.error }))
          }) }],
          ...(result.failed > 0 ? { isError: true } : {})
        };
      } catch (error: any) {
        console.error('[TaskTools] Error bulk creating tasks:', error);
        return { content: [{ type: 'text', text: `Error bulk creating tasks: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'tasks_update_bulk',
    'Update multiple existing ClickUp tasks in a single operation. Each entry must include a task_id and the fields to update. '
    + 'Can batch-change status across tasks (set status per task) or batch-reassign (set assignees array per task). '
    + 'Tags cannot be set here — use tags_assign, which supports bulk assignments. Supports up to 50 tasks per call.',
    {
      updates: z.array(z.object({
        task_id: z.string().describe('The ID of the task to update'),
        name: z.string().optional(),
        description: z.string().optional(),
        assignees: z.array(z.number()).optional(),
        status: z.string().optional(),
        priority: z.number().optional(),
        due_date: z.union([z.number(), z.string()]).optional().describe('Unix ms, "YYYY-MM-DD", or "YYYY-MM-DD HH:MM"'),
        time_estimate: z.number().optional(),
        start_date: z.union([z.number(), z.string()]).optional().describe('Unix ms, "YYYY-MM-DD", or "YYYY-MM-DD HH:MM"'),
        notify_all: z.boolean().optional()
      })).min(1).max(50).describe('Array of task updates (1-50)'),
      continue_on_error: z.boolean().optional().default(false).describe('Continue if an individual task update fails')
    },
    async ({ updates, continue_on_error }) => {
      try {
        const result = await tasksClient.bulkUpdateTasks(updates.map(u => normalizeTaskDates({ ...u })) as any, continue_on_error);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            summary: `Updated ${result.succeeded} of ${updates.length} tasks${result.failed ? `, ${result.failed} failed` : ''}${result.stopped_early ? ' (stopped at first failure)' : ''}`,
            succeeded: result.succeeded,
            failed: result.failed,
            results: result.results
          }) }],
          ...(result.failed > 0 ? { isError: true } : {})
        };
      } catch (error: any) {
        console.error('[TaskTools] Error bulk updating tasks:', error);
        return { content: [{ type: 'text', text: `Error bulk updating tasks: ${error.message}` }], isError: true };
      }
    }
  );
}
