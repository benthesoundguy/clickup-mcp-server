import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createRemindersClient } from '../clickup-client/reminders.js';

const clickUpClient = createClickUpClient();
const remindersClient = createRemindersClient(clickUpClient);

export function setupReminderTools(server: McpServer): void {
  server.tool(
    'reminders',
    'Manage personal reminders in ClickUp. Use action "list" to search/filter, "create" to add, or "update" to modify or complete.',
    {
      action: z.enum(['list', 'create', 'update']).describe('Action to perform'),
      reminder_id: z.string().optional().describe('Required for update: the ID of the reminder'),
      title: z.string().optional().describe('Required for create: title for the reminder'),
      due_date: z.string().optional().describe('Due date in YYYY-MM-DD or YYYY-MM-DD HH:MM format'),
      description: z.string().optional().describe('Description (create/update)'),
      is_completed: z.boolean().optional().describe('Mark completed/incomplete (update only)'),
      due_date_status: z.enum(['TODO', 'LATER', 'DELETED']).optional().describe('Filter by due date status (list only)'),
      reminder_type: z.enum(['ASSIGNED_COMMENT', 'UNANSWERED_MENTION', 'APPROVAL', 'SAVED', 'REMINDER']).optional().describe('Filter by type (list only)'),
      is_overdue: z.boolean().optional().describe('Filter overdue (list only)'),
      cursor: z.string().optional().describe('Pagination cursor (list only)'),
      limit: z.number().optional().describe('Max results (list only)')
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'list': {
            const result = await remindersClient.getReminders({
              due_date_status: params.due_date_status,
              reminder_type: params.reminder_type,
              is_overdue: params.is_overdue,
              is_completed: params.is_completed,
              cursor: params.cursor,
              limit: params.limit
            });
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'create': {
            if (!params.title || !params.due_date) throw new Error('title and due_date are required for create');
            const result = await remindersClient.createReminder(params.title, params.due_date, params.description);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'update': {
            if (!params.reminder_id) throw new Error('reminder_id is required for update');
            const result = await remindersClient.updateReminder(
              params.reminder_id, params.title, params.description,
              params.due_date, params.is_completed
            );
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
        }
      } catch (error: any) {
        console.error('[ReminderTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with reminders: ${error.message}` }], isError: true };
      }
    }
  );
}
