import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createCustomFieldsClient } from '../clickup-client/custom-fields.js';

const clickUpClient = createClickUpClient();
const customFieldsClient = createCustomFieldsClient(clickUpClient);

export function setupCustomFieldValueTools(server: McpServer): void {
  server.tool(
    'custom_fields_values',
    'Get, set, remove, or bulk-set custom field values on ClickUp tasks. '
    + 'Use "get" to read all field values on a task, "set" to write a value, "remove" to clear it, '
    + 'or "bulk_set" to set values across multiple tasks in one operation. '
    + 'For dropdown/labels fields, pass the option UUID (get UUIDs from custom_fields tool with action="list"). '
    + 'For date fields, pass a Unix timestamp in milliseconds. '
    + 'For people fields, pass {add:[user_ids], rem:[user_ids]}. '
    + 'For location fields, pass {lat:number, lng:number, formatted_address?:string}.',
    {
      action: z.enum(['get', 'set', 'remove', 'bulk_set']).describe('Action to perform'),
      task_id: z.string().optional().describe('Required for get, set, remove: the task ID'),
      field_id: z.string().optional().describe('Required for set, remove: the custom field ID'),
      value: z.any().optional().describe(
        'Required for set: the RAW value — do NOT wrap it in {"value": ...} '
        + '(the server adds that wrapper; double-wrapping causes FIELD_018). Format depends on field type:\n'
        + 'text/url/email/phone → string\n'
        + 'number/rating → number\n'
        + 'checkbox → boolean\n'
        + 'date → Unix timestamp ms\n'
        + 'dropdown → option UUID\n'
        + 'labels → array of option UUIDs\n'
        + 'people → {add:[ids], rem:[ids]}\n'
        + 'location → {lat, lng, formatted_address}'
      ),
      updates: z.array(z.object({
        task_id: z.string(),
        field_id: z.string(),
        value: z.any()
      })).optional().describe('bulk_set only: array of {task_id, field_id, value} objects'),
      continue_on_error: z.boolean().optional().default(false).describe('Continue if an individual update fails (bulk_set)'),
    },
    async ({ action, task_id, field_id, value, updates, continue_on_error }) => {
      try {
        // Defensive unwrap: callers who mirror ClickUp's REST body sometimes
        // pass {value: X} as the value; the client adds that wrapper itself,
        // and the double-wrapped form fails with FIELD_018. Unwrap it here.
        const unwrap = (v: any) =>
          v && typeof v === 'object' && !Array.isArray(v)
            && Object.keys(v).length === 1 && 'value' in v
            ? v.value : v;
        value = unwrap(value);
        updates = updates?.map(u => ({ ...u, value: unwrap(u.value) }));

        switch (action) {
          case 'get': {
            if (!task_id) throw new Error('task_id required for get');
            const result = await customFieldsClient.getTaskFieldValues(task_id);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'set': {
            if (!task_id || !field_id) throw new Error('task_id and field_id required for set');
            if (value === undefined) throw new Error('value required for set (pass the raw value, not {"value": ...})');
            const result = await customFieldsClient.setTaskFieldValue(task_id, field_id, value);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, task_id, field_id, ...(<object>result) }) }] };
          }
          case 'remove': {
            if (!task_id || !field_id) throw new Error('task_id and field_id required for remove');
            await customFieldsClient.removeTaskFieldValue(task_id, field_id);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
          }
          case 'bulk_set': {
            if (!updates?.length) throw new Error('updates array required for bulk_set');
            const result = await customFieldsClient.bulkSetFieldValues(updates as any, continue_on_error);
            return {
              content: [{ type: 'text', text: JSON.stringify({
                summary: `Set ${result.succeeded} of ${updates.length} field values${result.failed ? `, ${result.failed} failed` : ''}${result.stopped_early ? ' (stopped at first failure)' : ''}`,
                succeeded: result.succeeded,
                failed: result.failed,
                results: result.results
              }) }],
              ...(result.failed > 0 ? { isError: true } : {})
            };
          }
        }
      } catch (error: any) {
        console.error('[CustomFieldValueTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with custom field values: ${error.message}` }], isError: true };
      }
    }
  );
}
