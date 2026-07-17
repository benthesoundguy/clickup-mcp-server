import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createListsClient } from '../clickup-client/lists.js';
const clickUpClient = createClickUpClient();
const listsClient = createListsClient(clickUpClient);
export function setupStatusTools(server) {
    server.tool('statuses', 'Manage custom statuses on ClickUp lists. Use action to list current statuses, create, update, delete, or reorder them.', {
        action: z.enum(['list', 'create', 'update', 'delete', 'reorder']).describe('Action to perform'),
        list_id: z.string().describe('The ID of the list to manage statuses on'),
        status_name: z.string().optional().describe('Required for create/update: the status name'),
        status_color: z.string().optional().describe('Hex color for the status, e.g. "#000000"'),
        status_order: z.number().optional().describe('Order index for the status (reorder only)'),
        all_statuses: z.array(z.object({
            status: z.string(),
            color: z.string(),
            orderindex: z.number().optional(),
            hide_label: z.boolean().optional()
        })).optional().describe('Full statuses array for create/update/delete/reorder operations')
    }, async ({ action, list_id, status_name, status_color, status_order, all_statuses }) => {
        try {
            switch (action) {
                case 'list': {
                    const statuses = await listsClient.getStatuses(list_id);
                    return { content: [{ type: 'text', text: JSON.stringify(statuses, null, 2) }] };
                }
                case 'create':
                case 'update':
                case 'delete':
                case 'reorder': {
                    const current = await listsClient.getStatuses(list_id);
                    let updated = [...current];
                    if (action === 'create') {
                        if (!status_name)
                            throw new Error('status_name is required for create');
                        updated.push({
                            status: status_name,
                            color: status_color || '#000000',
                            orderindex: status_order ?? updated.length
                        });
                    }
                    else if (action === 'update') {
                        if (!status_name)
                            throw new Error('status_name is required for update');
                        const idx = updated.findIndex((s) => s.status === status_name);
                        if (idx === -1)
                            throw new Error(`Status "${status_name}" not found`);
                        updated[idx] = { ...updated[idx], status: status_name, color: status_color || updated[idx].color };
                    }
                    else if (action === 'delete') {
                        if (!status_name)
                            throw new Error('status_name is required for delete');
                        updated = updated.filter((s) => s.status !== status_name);
                    }
                    else if (action === 'reorder') {
                        if (all_statuses) {
                            updated = all_statuses.map((s, i) => ({
                                ...s, orderindex: s.orderindex ?? i
                            }));
                        }
                    }
                    const result = await listsClient.setStatuses(list_id, updated);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
            }
        }
        catch (error) {
            console.error('[StatusTools] Error:', error);
            return { content: [{ type: 'text', text: `Error with statuses: ${error.message}` }], isError: true };
        }
    });
}
//# sourceMappingURL=status-tools.js.map