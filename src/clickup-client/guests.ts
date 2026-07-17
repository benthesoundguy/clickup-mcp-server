import { ClickUpClient } from './index.js';

export function createGuestsClient(client: ClickUpClient) {
  return {
    async inviteGuest(workspaceId: string, email: string, canEditTags?: boolean): Promise<any> {
      return client.post(`/team/${workspaceId}/guest`, { email, can_edit_tags: canEditTags });
    },
    async getGuest(workspaceId: string, guestId: number): Promise<any> {
      return client.get(`/team/${workspaceId}/guest/${guestId}`);
    },
    async editGuest(workspaceId: string, guestId: number, data: Record<string, any>): Promise<any> {
      return client.put(`/team/${workspaceId}/guest/${guestId}`, data);
    },
    async removeGuest(workspaceId: string, guestId: number): Promise<any> {
      return client.delete(`/team/${workspaceId}/guest/${guestId}`);
    },
    async addToTask(guestId: number, taskId: string, permissionLevel?: string): Promise<any> {
      return client.post(`/guest/${guestId}/task/${taskId}`, { permission_level: permissionLevel || 'read' });
    },
    async removeFromTask(guestId: number, taskId: string): Promise<any> {
      return client.delete(`/guest/${guestId}/task/${taskId}`);
    },
    async addToList(guestId: number, listId: string, permissionLevel?: string): Promise<any> {
      return client.post(`/guest/${guestId}/list/${listId}`, { permission_level: permissionLevel || 'read' });
    },
    async removeFromList(guestId: number, listId: string): Promise<any> {
      return client.delete(`/guest/${guestId}/list/${listId}`);
    },
    async addToFolder(guestId: number, folderId: string, permissionLevel?: string): Promise<any> {
      return client.post(`/guest/${guestId}/folder/${folderId}`, { permission_level: permissionLevel || 'read' });
    },
    async removeFromFolder(guestId: number, folderId: string): Promise<any> {
      return client.delete(`/guest/${guestId}/folder/${folderId}`);
    }
  };
}
