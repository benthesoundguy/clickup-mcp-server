export class ChecklistsClient {
    constructor(client) {
        this.client = client;
    }
    /**
     * Create a new checklist in a task
     * @param taskId The ID of the task to create the checklist in
     * @param params The checklist parameters
     * @returns The created checklist
     */
    async createChecklist(taskId, params) {
        return this.client.post(`/task/${taskId}/checklist`, params);
    }
    /**
     * Update an existing checklist
     * @param checklistId The ID of the checklist to update
     * @param params The checklist parameters to update
     * @returns The updated checklist
     */
    async updateChecklist(checklistId, params) {
        return this.client.put(`/checklist/${checklistId}`, params);
    }
    /**
     * Delete a checklist
     * @param checklistId The ID of the checklist to delete
     * @returns Success message
     */
    async deleteChecklist(checklistId) {
        return this.client.delete(`/checklist/${checklistId}`);
    }
    /**
     * Create a new checklist item in a checklist
     * @param checklistId The ID of the checklist to create the item in
     * @param params The checklist item parameters
     * @returns The created checklist item
     */
    async createChecklistItem(checklistId, params) {
        return this.client.post(`/checklist/${checklistId}/checklist_item`, params);
    }
    /**
     * Update an existing checklist item
     * @param checklistId The ID of the checklist containing the item
     * @param checklistItemId The ID of the checklist item to update
     * @param params The checklist item parameters to update
     * @returns The updated checklist item
     */
    async updateChecklistItem(checklistId, checklistItemId, params) {
        return this.client.put(`/checklist/${checklistId}/checklist_item/${checklistItemId}`, params);
    }
    /**
     * Delete a checklist item
     * @param checklistId The ID of the checklist containing the item
     * @param checklistItemId The ID of the checklist item to delete
     * @returns Success message
     */
    async deleteChecklistItem(checklistId, checklistItemId) {
        return this.client.delete(`/checklist/${checklistId}/checklist_item/${checklistItemId}`);
    }
}
export const createChecklistsClient = (client) => {
    return new ChecklistsClient(client);
};
//# sourceMappingURL=checklists.js.map