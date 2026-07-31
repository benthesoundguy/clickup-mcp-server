import { ClickUpClient } from './index.js';

export function createUsersClient(client: ClickUpClient) {
  return {
    /**
     * Get all users in a workspace. There is no list-users endpoint in the
     * public API (GET /team/{id}/user is a dead route — smoke-verified);
     * members are returned on the workspace object from GET /team.
     */
    async getUsers(workspaceId: string): Promise<any> {
      const res = await client.get<any>('/team');
      const team = (res.teams ?? []).find((t: any) => String(t.id) === String(workspaceId));
      if (!team) throw new Error(`Workspace ${workspaceId} not found for this token`);
      return { members: team.members ?? [] };
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
