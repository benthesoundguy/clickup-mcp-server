import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createTimeTrackingClient } from '../clickup-client/time-tracking.js';
import { coerceDate, coerceDuration } from './helpers.js';

const clickUpClient = createClickUpClient();
const timeTrackingClient = createTimeTrackingClient(clickUpClient);

export function setupTimeTrackingTools(server: McpServer): void {
  server.tool(
    'time_entries_list',
    'Get time entries for a ClickUp team/workspace. Supports filtering by task, date range, and assignees.',
    {
      team_id: z.string().describe('The ID of the team (workspace) to get time entries for'),
      task_id: z.string().optional().describe('Filter by task ID (supports custom IDs like DEV-1234)'),
      start_date: z.string().optional().describe('Start date filter in YYYY-MM-DD or YYYY-MM-DD HH:MM format'),
      end_date: z.string().optional().describe('End date filter in YYYY-MM-DD or YYYY-MM-DD HH:MM format'),
      assignee: z.array(z.string()).optional().describe('Filter by assignee user IDs. Pass "any" to get all users entries'),
      is_billable: z.boolean().optional().describe('Filter by billable status')
    },
    async ({ team_id, ...params }) => {
      try {
        const result = await timeTrackingClient.getTimeEntries(team_id, params);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error: any) {
        console.error('[TimeTrackingTools] Error listing time entries:', error);
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'time_entry_create',
    'Create a manual time entry on a task. Requires team_id, task_id, start, and EITHER duration OR end_time.',
    {
      team_id: z.string().describe('The ID of the team (workspace) to create the time entry in'),
      task_id: z.string().describe('The ID of the task to attach the time to'),
      start: z.union([z.number(), z.string()]).describe('Start time: Unix ms, "YYYY-MM-DD HH:MM", or "YYYY-MM-DD"'),
      duration: z.union([z.number(), z.string()]).optional().describe('Duration: milliseconds, or "90m" / "1h 30m" / "1.5h". Provide this or end_time.'),
      end_time: z.union([z.number(), z.string()]).optional().describe('End time: Unix ms or "YYYY-MM-DD HH:MM". Provide this or duration.'),
      description: z.string().optional().describe('Description for the time entry'),
      billable: z.boolean().optional().describe('Whether this time is billable'),
      tags: z.array(z.string()).optional().describe('Array of tag names to assign to the time entry')
    },
    async ({ team_id, task_id, start, duration, end_time, description, billable, tags }) => {
      try {
        if (duration === undefined && end_time === undefined) {
          throw new Error('Provide either duration or end_time — ClickUp rejects an entry with neither.');
        }
        const data: any = { task_id, start: coerceDate(start).ms };
        if (duration !== undefined) data.duration = coerceDuration(duration);
        if (end_time !== undefined) data.end_time = coerceDate(end_time).ms;
        if (description) data.description = description;
        if (billable !== undefined) data.billable = billable;
        if (tags) data.tags = tags;
        const result = await timeTrackingClient.createTimeEntry(team_id, data);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error: any) {
        console.error('[TimeTrackingTools] Error creating time entry:', error);
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'time_entry_update',
    'Update an existing time entry. Supports changing start, duration, end time, description, and billable status.',
    {
      team_id: z.string().describe('The ID of the team (workspace) containing the time entry'),
      entry_id: z.string().describe('The ID of the time entry to update'),
      start: z.union([z.number(), z.string()]).optional().describe('New start time: Unix ms or "YYYY-MM-DD HH:MM"'),
      duration: z.union([z.number(), z.string()]).optional().describe('New duration: milliseconds, or "90m" / "1h 30m"'),
      end_time: z.union([z.number(), z.string()]).optional().describe('New end time: Unix ms or "YYYY-MM-DD HH:MM"'),
      description: z.string().optional().describe('New description for the time entry'),
      billable: z.boolean().optional().describe('Whether this time is billable'),
      tags: z.array(z.string()).optional().describe('Array of tag names to assign to the time entry')
    },
    async ({ team_id, entry_id, ...data }) => {
      try {
        const patch: any = { ...data };
        if (patch.start !== undefined) patch.start = coerceDate(patch.start).ms;
        if (patch.end_time !== undefined) patch.end_time = coerceDate(patch.end_time).ms;
        if (patch.duration !== undefined) patch.duration = coerceDuration(patch.duration);
        const result = await timeTrackingClient.updateTimeEntry(team_id, entry_id, patch);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error: any) {
        console.error('[TimeTrackingTools] Error updating time entry:', error);
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'time_entry_delete',
    'Delete a time entry by ID.',
    {
      team_id: z.string().describe('The ID of the team (workspace) containing the time entry'),
      entry_id: z.string().describe('The ID of the time entry to delete')
    },
    async ({ team_id, entry_id }) => {
      try {
        const result = await timeTrackingClient.deleteTimeEntry(team_id, entry_id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error: any) {
        console.error('[TimeTrackingTools] Error deleting time entry:', error);
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'time_tracking_start',
    'Start the timer on a ClickUp task. Only one timer can run at a time. Supports optional description and billable status.',
    {
      team_id: z.string().describe('The ID of the team (workspace) to start tracking in'),
      task_id: z.string().optional().describe('The ID of the task to start tracking (supports custom IDs like DEV-1234)'),
      description: z.string().optional().describe('Description for the time entry'),
      billable: z.boolean().optional().describe('Whether this time is billable'),
      tags: z.array(z.string()).optional().describe('Array of tag names to assign to the time entry')
    },
    async ({ team_id, task_id, description, billable, tags }) => {
      try {
        const data: any = {};
        if (task_id) data.task_id = task_id;
        if (description) data.description = description;
        if (billable !== undefined) data.billable = billable;
        if (tags) data.tags = tags;
        const result = await timeTrackingClient.startTimer(team_id, data);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error: any) {
        console.error('[TimeTrackingTools] Error starting timer:', error);
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'time_tracking_stop',
    'Stop the currently running timer. Returns the completed time entry details.',
    {
      team_id: z.string().describe('The ID of the team (workspace) to stop tracking in'),
      description: z.string().optional().describe('Description to update or add to the time entry'),
      tags: z.array(z.string()).optional().describe('Array of tag names to assign to the time entry')
    },
    async ({ team_id, description, tags }) => {
      try {
        const data: any = {};
        if (description) data.description = description;
        if (tags) data.tags = tags;
        const result = await timeTrackingClient.stopTimer(team_id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error: any) {
        console.error('[TimeTrackingTools] Error stopping timer:', error);
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'time_tracking_current',
    'Get the currently running time entry, if any. Returns the active time entry details or an empty response.',
    {
      team_id: z.string().describe('The ID of the team (workspace) to check for running time entry')
    },
    async ({ team_id }) => {
      try {
        const result = await timeTrackingClient.getRunningTimeEntry(team_id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error: any) {
        console.error('[TimeTrackingTools] Error getting running time entry:', error);
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
