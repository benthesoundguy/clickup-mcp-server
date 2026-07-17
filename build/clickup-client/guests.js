export function createGuestsClient(client) {
    return {
        async inviteGuest(workspaceId, email, canEditTags) {
            return client.post(`/team/${workspaceId}/guest`, { email, can_edit_tags: canEditTags });
        },
        async getGuest(workspaceId, guestId) {
            return client.get(`/team/${workspaceId}/guest/${guestId}`);
        },
        async editGuest(workspaceId, guestId, data) {
            return client.put(`/team/${workspaceId}/guest/${guestId}`, data);
        },
        async removeGuest(workspaceId, guestId) {
            return client.delete(`/team/${workspaceId}/guest/${guestId}`);
        },
        async addToTask(guestId, taskId, permissionLevel) {
            return client.post(`/guest/${guestId}/task/${taskId}`, { permission_level: permissionLevel || 'read' });
        },
        async removeFromTask(guestId, taskId) {
            return client.delete(`/guest/${guestId}/task/${taskId}`);
        },
        async addToList(guestId, listId, permissionLevel) {
            return client.post(`/guest/${guestId}/list/${listId}`, { permission_level: permissionLevel || 'read' });
        },
        async removeFromList(guestId, listId) {
            return client.delete(`/guest/${guestId}/list/${listId}`);
        },
        async addToFolder(guestId, folderId, permissionLevel) {
            return client.post(`/guest/${guestId}/folder/${folderId}`, { permission_level: permissionLevel || 'read' });
        },
        async removeFromFolder(guestId, folderId) {
            return client.delete(`/guest/${guestId}/folder/${folderId}`);
        }
    };
}
//# sourceMappingURL=guests.js.map