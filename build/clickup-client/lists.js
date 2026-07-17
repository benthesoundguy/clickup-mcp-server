export class ListsClient {
    constructor(client) {
        this.client = client;
    }
    async getListsFromSpace(spaceId, params) {
        return this.client.get(`/space/${spaceId}/list`, params);
    }
    async getListsFromFolder(folderId, params) {
        return this.client.get(`/folder/${folderId}/list`, params);
    }
    async createListInFolder(folderId, params) {
        return this.client.post(`/folder/${folderId}/list`, params);
    }
    async createFolderlessList(spaceId, params) {
        return this.client.post(`/space/${spaceId}/list`, params);
    }
    async getList(listId) {
        return this.client.get(`/list/${listId}`);
    }
    async updateList(listId, params) {
        return this.client.put(`/list/${listId}`, params);
    }
    async deleteList(listId) {
        return this.client.delete(`/list/${listId}`);
    }
    async addTaskToList(listId, taskId) {
        return this.client.post(`/list/${listId}/task/${taskId}`);
    }
    async removeTaskFromList(listId, taskId) {
        return this.client.delete(`/list/${listId}/task/${taskId}`);
    }
    async createListFromTemplateInFolder(folderId, templateId, params) {
        return this.client.post(`/folder/${folderId}/list/template/${templateId}`, params);
    }
    async createListFromTemplateInSpace(spaceId, templateId, params) {
        return this.client.post(`/space/${spaceId}/list/template/${templateId}`, params);
    }
    async getListMembers(listId) {
        return this.client.get(`/list/${listId}/member`);
    }
    async getStatuses(listId) {
        const res = await this.client.get(`/list/${listId}`);
        return res.statuses || [];
    }
    async setStatuses(listId, statuses, overrideExisting) {
        return this.client.put(`/list/${listId}`, {
            override_statuses: overrideExisting ?? true,
            statuses
        });
    }
}
export const createListsClient = (client) => {
    return new ListsClient(client);
};
//# sourceMappingURL=lists.js.map