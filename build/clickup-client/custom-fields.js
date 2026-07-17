export class CustomFieldsClient {
    constructor(client) {
        this.client = client;
    }
    /**
     * Get custom field definitions for a list.
     */
    async getListFields(listId) {
        const res = await this.client.get(`/list/${listId}/field`);
        return res.fields;
    }
    /**
     * Get custom field definitions for a folder.
     */
    async getFolderFields(folderId) {
        const res = await this.client.get(`/folder/${folderId}/field`);
        return res.fields;
    }
    /**
     * Get custom field definitions for a space.
     */
    async getSpaceFields(spaceId) {
        const res = await this.client.get(`/space/${spaceId}/field`);
        return res.fields;
    }
    /**
     * Get custom field definitions for an entire workspace.
     */
    async getWorkspaceFields(workspaceId) {
        const res = await this.client.get(`/team/${workspaceId}/field`);
        return res.fields;
    }
    /**
     * Create a custom field definition on a list.
     */
    async createField(scopeId, params) {
        return this.client.post(`/list/${scopeId}/field`, params);
    }
    /**
     * Get all custom field values on a task. Returns fields with their current values.
     */
    async getTaskFieldValues(taskId) {
        const res = await this.client.get(`/task/${taskId}`, { include: ['custom_fields'] });
        return res.custom_fields || [];
    }
    /**
     * Set the value of a custom field on a task.
     * The value format depends on field type (dropdown: option UUID, date: timestamp ms, etc.).
     */
    async setTaskFieldValue(taskId, fieldId, value) {
        return this.client.post(`/task/${taskId}/field/${fieldId}`, { value });
    }
    /**
     * Remove/clear a custom field value from a task.
     */
    async removeTaskFieldValue(taskId, fieldId) {
        return this.client.delete(`/task/${taskId}/field/${fieldId}`);
    }
    /**
     * Update a custom field definition.
     */
    async updateField(fieldId, params) {
        return this.client.put(`/field/${fieldId}`, params);
    }
    /**
     * Delete a custom field definition.
     */
    async deleteField(fieldId) {
        return this.client.delete(`/field/${fieldId}`);
    }
    /**
     * Set custom field values on multiple tasks.
     */
    async bulkSetFieldValues(updates, continueOnError) {
        const results = [];
        for (let i = 0; i < updates.length; i++) {
            try {
                await this.setTaskFieldValue(updates[i].task_id, updates[i].field_id, updates[i].value);
                results.push({ task_id: updates[i].task_id, field_id: updates[i].field_id, status: 'set' });
            }
            catch (error) {
                if (continueOnError) {
                    results.push({ task_id: updates[i].task_id, field_id: updates[i].field_id, status: 'failed', error: error.message });
                }
                else {
                    throw { partial: results, error: new Error(error.message) };
                }
            }
        }
        return { results };
    }
}
export const createCustomFieldsClient = (client) => new CustomFieldsClient(client);
//# sourceMappingURL=custom-fields.js.map