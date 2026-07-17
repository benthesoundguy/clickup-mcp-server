import { ClickUpClient } from './index.js';

export function createTemplatesClient(client: ClickUpClient) {
  return {
    /** Get all task templates in a workspace. */
    async getTaskTemplates(workspaceId: string): Promise<any> {
      return client.get(`/team/${workspaceId}/task/template`);
    },

    /** Get all list item templates in a workspace list. */
    async getListTemplates(workspaceId: string, listId: string): Promise<any> {
      return client.get(`/team/${workspaceId}/list/${listId}/item/template`);
    },

    /** Get all folder item templates in a workspace folder. */
    async getFolderTemplates(workspaceId: string, folderId: string): Promise<any> {
      return client.get(`/team/${workspaceId}/folder/${folderId}/item/template`);
    }
  };
}
