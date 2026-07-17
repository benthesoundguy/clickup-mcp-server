import { ClickUpClient } from './index.js';

export function createGroupsClient(client: ClickUpClient) {
  return {
    /** Get all user groups in a workspace. */
    async getGroups(workspaceId: string): Promise<any> {
      return client.get(`/team/${workspaceId}/group`);
    },

    /** Create a new user group in a workspace. */
    async createGroup(workspaceId: string, name: string): Promise<any> {
      return client.post(`/team/${workspaceId}/group`, { name });
    },

    /** Update a user group's name. */
    async updateGroup(workspaceId: string, groupId: string, name: string): Promise<any> {
      return client.put(`/team/${workspaceId}/group/${groupId}`, { name });
    },

    /** Delete a user group from the workspace. */
    async deleteGroup(workspaceId: string, groupId: string): Promise<any> {
      return client.delete(`/team/${workspaceId}/group/${groupId}`);
    }
  };
}
