import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createCustomFieldsClient } from '../clickup-client/custom-fields.js';
const clickUpClient = createClickUpClient();
const customFieldsClient = createCustomFieldsClient(clickUpClient);
export function setupCustomFieldTools(server) {
    server.tool('custom_fields', 'List, create, update, or delete custom field definitions. Use "list" to get field schemas, "create" to add a field, "update" to modify it, or "delete" to remove it.', {
        action: z.enum(['list', 'create', 'update', 'delete']).describe('Action to perform'),
        scope_type: z.enum(['list', 'folder', 'space', 'workspace']).optional().describe('The scope level (list, create)'),
        scope_id: z.string().optional().describe('The ID of the list, folder, space, or workspace (list, create)'),
        field_id: z.string().optional().describe('Required for update, delete: the custom field ID'),
        name: z.string().optional().describe('Required for create: the field name. Optional for update.'),
        type: z.string().optional().describe('Required for create: field type (text, number, date, checkbox, dropdown, etc.)'),
        required: z.boolean().optional().describe('Whether the field is required'),
        options: z.array(z.object({
            name: z.string(),
            orderindex: z.number()
        })).optional().describe('Dropdown options (required for dropdown type)'),
    }, async ({ action, scope_type, scope_id, field_id, name, type, required, options }) => {
        try {
            switch (action) {
                case 'list': {
                    let result;
                    switch (scope_type) {
                        case 'list':
                            result = await customFieldsClient.getListFields(scope_id);
                            break;
                        case 'folder':
                            result = await customFieldsClient.getFolderFields(scope_id);
                            break;
                        case 'space':
                            result = await customFieldsClient.getSpaceFields(scope_id);
                            break;
                        case 'workspace':
                            result = await customFieldsClient.getWorkspaceFields(scope_id);
                            break;
                        default: throw new Error('scope_type and scope_id required for list');
                    }
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'create': {
                    if (!scope_id || !name || !type)
                        throw new Error('scope_id, name, and type required for create');
                    const result = await customFieldsClient.createField(scope_id, { name, type, required, options });
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'update': {
                    if (!field_id)
                        throw new Error('field_id required for update');
                    const mappedOptions = options?.map(o => ({ name: o.name, orderindex: o.orderindex ?? 0 }));
                    const result = await customFieldsClient.updateField(field_id, { name, required, options: mappedOptions });
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'delete': {
                    if (!field_id)
                        throw new Error('field_id required for delete');
                    await customFieldsClient.deleteField(field_id);
                    return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
                }
            }
        }
        catch (error) {
            console.error('[CustomFieldTools] Error:', error);
            return { content: [{ type: 'text', text: `Error with custom fields: ${error.message}` }], isError: true };
        }
    });
}
//# sourceMappingURL=custom-field-tools.js.map