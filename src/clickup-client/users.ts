import { ClickUpClient } from './index.js';

export function createUsersClient(client: ClickUpClient) {
  return {
    /** Get all users in a workspace. */
    async getUsers(workspaceId: string): Promise<any> {
      return client.get(`/team/${workspaceId}/user`);
    },

    /** Invite a user to a workspace. */
    async inviteUser(workspaceId: string, email: string, admin?: boolean): Promise<any> {
      return client.post(`/team/${workspaceId}/user`, { email, admin });
    },

    /** Edit a user's details in the workspace. */
    async editUser(workspaceId: string, userId: number, data: Record<string, any>): Promise<any> {
      return client.put(`/team/${workspaceId}/user/${userId}`, data);
    },

    /** Remove a user from the workspace. */
    async removeUser(workspaceId: string, userId: number): Promise<any> {
      return client.delete(`/team/${workspaceId}/user/${userId}`);
    }
  };
}
