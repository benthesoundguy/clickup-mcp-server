import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createRemindersClient } from '../clickup-client/reminders.js';

const clickUpClient = createClickUpClient();
const remindersClient = createRemindersClient(clickUpClient);

export function setupReminderTools(server: McpServer): void {
  server.tool(
    'reminders_create',
    'Create a personal reminder in ClickUp. Note: the ClickUp API only supports '
    + 'creating reminders — they cannot be listed, updated, or deleted via API.',
    {
      title: z.string().describe('Title for the reminder'),
      due_date: z.string().describe('Due date in YYYY-MM-DD or YYYY-MM-DD HH:MM format'),
      description: z.string().optional().describe('Optional description'),
    },
    async ({ title, due_date, description }) => {
      try {
        const result = await remindersClient.createReminder(title, due_date, description);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error: any) {
        console.error('[ReminderTools] Error:', error);
        return { content: [{ type: 'text', text: `Error creating reminder: ${error.message}` }], isError: true };
      }
    }
  );
}
