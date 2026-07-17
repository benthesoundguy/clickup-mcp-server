export function createTemplatesClient(client) {
    return {
        /** Get all task templates in a workspace. */
        async getTaskTemplates(workspaceId) {
            return client.get(`/team/${workspaceId}/task/template`);
        },
        /** Get all list item templates in a workspace list. */
        async getListTemplates(workspaceId, listId) {
            return client.get(`/team/${workspaceId}/list/${listId}/item/template`);
        },
        /** Get all folder item templates in a workspace folder. */
        async getFolderTemplates(workspaceId, folderId) {
            return client.get(`/team/${workspaceId}/folder/${folderId}/item/template`);
        }
    };
}
//# sourceMappingURL=templates.js.map