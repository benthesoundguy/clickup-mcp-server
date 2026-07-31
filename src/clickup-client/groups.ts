import { ClickUpClient } from './index.js';

// Paths verified live 2026-07-31: list is GET /group?team_id={id};
// update/delete operate on /group/{group_id}. (The previous
// /team/{id}/group/... read/update/delete paths are dead.)

export function createGroupsClient(client: ClickUpClient) {
  return {
    /** Get all user groups in a workspace. */
    async getGroups(workspaceId: string): Promise<any> {
      return client.get('/group', { team_id: workspaceId });
    },

    /** Create a new user group in a workspace. */
    async createGroup(workspaceId: string, name: string, memberIds?: number[]): Promise<any> {
      return client.post(`/team/${workspaceId}/group`, { name, members: memberIds });
    },

    /** Update a user group's name and/or membership. */
    async updateGroup(groupId: string, changes: { name?: string; members?: { add?: number[]; rem?: number[] } }): Promise<any> {
      return client.put(`/group/${groupId}`, changes);
    },

    /** Delete a user group. */
    async deleteGroup(groupId: string): Promise<any> {
      return client.delete(`/group/${groupId}`);
    }
  };
}
