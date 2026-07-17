export function createGroupsClient(client) {
    return {
        /** Get all user groups in a workspace. */
        async getGroups(workspaceId) {
            return client.get(`/team/${workspaceId}/group`);
        },
        /** Create a new user group in a workspace. */
        async createGroup(workspaceId, name) {
            return client.post(`/team/${workspaceId}/group`, { name });
        },
        /** Update a user group's name. */
        async updateGroup(workspaceId, groupId, name) {
            return client.put(`/team/${workspaceId}/group/${groupId}`, { name });
        },
        /** Delete a user group from the workspace. */
        async deleteGroup(workspaceId, groupId) {
            return client.delete(`/team/${workspaceId}/group/${groupId}`);
        }
    };
}
//# sourceMappingURL=groups.js.map