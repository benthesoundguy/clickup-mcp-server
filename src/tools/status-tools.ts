import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createListsClient } from '../clickup-client/lists.js';

const clickUpClient = createClickUpClient();
const listsClient = createListsClient(clickUpClient);

// ClickUp has no per-status endpoints: the only way to change a list's
// statuses is to PUT the whole array back. That makes every action here a
// read-modify-write, and makes silent no-ops easy to write by accident —
// e.g. filtering for a name that isn't present removes nothing and then
// reports success. Every action below verifies its precondition first.
//
// ClickUp also lower-cases status names on storage, so all name matching
// here is case-insensitive.

type Status = { status: string; color: string; type?: string; orderindex?: number; hide_label?: boolean };

const sameName = (a: string, b: string) => a?.toLowerCase() === b?.toLowerCase();

export function setupStatusTools(server: McpServer): void {
  server.tool(
    'statuses',
    'Manage custom statuses on a ClickUp list. "list" reads them; "create"/"update"/"delete" change one; '
    + '"reorder" changes only the order of existing statuses; "replace_all" overwrites the entire set. '
    + 'ClickUp stores status names lower-cased and requires exactly one status of type "open".',
    {
      action: z.enum(['list', 'create', 'update', 'delete', 'reorder', 'replace_all']).describe('Action to perform'),
      list_id: z.string().describe('The ID of the list to manage statuses on'),
      status_name: z.string().optional().describe('Required for create/update/delete: the status name (matched case-insensitively)'),
      new_name: z.string().optional().describe('Rename the status (update only)'),
      status_color: z.string().optional().describe('Hex color, e.g. "#4194f6" (create/update)'),
      status_type: z.enum(['open', 'custom', 'done', 'closed']).optional()
        .describe('Status type (create/update). Defaults to "custom". ClickUp allows exactly one "open" status per list.'),
      order: z.array(z.string()).optional()
        .describe('reorder only: every existing status name, in the desired order. Must be a permutation of the current set — it cannot add or remove statuses.'),
      all_statuses: z.array(z.object({
        status: z.string(),
        color: z.string().optional().describe('Hex color; defaults to grey if omitted'),
        type: z.string().optional().describe('open | custom | done | closed'),
        orderindex: z.number().optional(),
        hide_label: z.boolean().optional()
      })).optional().describe('replace_all only: the complete new status set. DESTRUCTIVE — any status not listed is deleted, along with its tasks\' status assignment.')
    },
    async ({ action, list_id, status_name, new_name, status_color, status_type, order, all_statuses }) => {
      try {
        const current: Status[] = await listsClient.getStatuses(list_id);

        const requireExisting = (name: string): number => {
          const idx = current.findIndex(s => sameName(s.status, name));
          if (idx === -1) {
            throw new Error(
              `Status "${name}" not found on this list. Current statuses: ${current.map(s => s.status).join(', ') || '(none)'}`
            );
          }
          return idx;
        };

        const assertOneOpen = (set: Status[]) => {
          const opens = set.filter(s => s.type === 'open').length;
          if (opens !== 1) {
            throw new Error(`ClickUp requires exactly one status of type "open"; this set has ${opens}.`);
          }
        };

        switch (action) {
          case 'list':
            return { content: [{ type: 'text', text: JSON.stringify(current) }] };

          case 'create': {
            if (!status_name) throw new Error('status_name is required for create');
            if (current.some(s => sameName(s.status, status_name))) {
              throw new Error(`Status "${status_name}" already exists on this list.`);
            }
            const next = [...current, {
              status: status_name,
              color: status_color || '#87909e',
              type: status_type || 'custom',
              orderindex: current.length,
            }];
            assertOneOpen(next);
            await listsClient.setStatuses(list_id, next);
            const after = await listsClient.getStatuses(list_id);
            if (!after.some((s: Status) => sameName(s.status, status_name))) {
              throw new Error(`Create reported success but "${status_name}" is not present on readback.`);
            }
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, created: status_name, statuses: after }) }] };
          }

          case 'update': {
            if (!status_name) throw new Error('status_name is required for update');
            const idx = requireExisting(status_name);
            const next = [...current];
            next[idx] = {
              ...next[idx],
              status: new_name ?? next[idx].status,
              color: status_color ?? next[idx].color,
              type: status_type ?? next[idx].type,
            };
            assertOneOpen(next);
            await listsClient.setStatuses(list_id, next);
            const after = await listsClient.getStatuses(list_id);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, updated: status_name, statuses: after }) }] };
          }

          case 'delete': {
            if (!status_name) throw new Error('status_name is required for delete');
            const idx = requireExisting(status_name);
            if (current[idx].type === 'open') {
              throw new Error(`"${status_name}" is the list's only "open" status and cannot be deleted. Create another open status first, or use update to change its type.`);
            }
            const next = current.filter((_, i) => i !== idx);
            await listsClient.setStatuses(list_id, next);
            const after = await listsClient.getStatuses(list_id);
            if (after.some((s: Status) => sameName(s.status, status_name))) {
              throw new Error(`Delete reported success but "${status_name}" is still present on readback.`);
            }
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, deleted: status_name, statuses: after }) }] };
          }

          case 'reorder': {
            if (!order?.length) throw new Error('order (an array of every existing status name) is required for reorder');
            if (order.length !== current.length) {
              throw new Error(`reorder needs all ${current.length} existing status names; got ${order.length}. Use replace_all to add or remove statuses.`);
            }
            const next = order.map(name => current[requireExisting(name)]);
            const seen = new Set(next.map(s => s.status.toLowerCase()));
            if (seen.size !== current.length) throw new Error('reorder contains duplicate status names.');
            await listsClient.setStatuses(list_id, next.map((s, i) => ({ ...s, orderindex: i })));
            const after = await listsClient.getStatuses(list_id);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, statuses: after }) }] };
          }

          case 'replace_all': {
            if (!all_statuses?.length) throw new Error('all_statuses is required for replace_all');
            const next: Status[] = all_statuses.map((s, i) => ({
              status: s.status,
              color: s.color || '#87909e',
              type: s.type,
              orderindex: s.orderindex ?? i,
              hide_label: s.hide_label,
            }));
            assertOneOpen(next);
            const removed = current
              .filter(c => !next.some(n => sameName(n.status, c.status)))
              .map(c => c.status);
            await listsClient.setStatuses(list_id, next);
            const after = await listsClient.getStatuses(list_id);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, removed, statuses: after }) }] };
          }
        }
      } catch (error: any) {
        console.error('[StatusTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with statuses: ${error.message}` }], isError: true };
      }
    }
  );
}
