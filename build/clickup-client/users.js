export function createUsersClient(client) {
    return {
        /** Get all users in a workspace. */
        async getUsers(workspaceId) {
            return client.get(`/team/${workspaceId}/user`);
        },
        /** Invite a user to a workspace. */
        async inviteUser(workspaceId, email, admin) {
            return client.post(`/team/${workspaceId}/user`, { email, admin });
        },
        /** Edit a user's details in the workspace. */
        async editUser(workspaceId, userId, data) {
            return client.put(`/team/${workspaceId}/user/${userId}`, data);
        },
        /** Remove a user from the workspace. */
        async removeUser(workspaceId, userId) {
            return client.delete(`/team/${workspaceId}/user/${userId}`);
        }
    };
}
//# sourceMappingURL=users.js.map