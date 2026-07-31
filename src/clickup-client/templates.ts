import { ClickUpClient } from './index.js';

// Only task template listing exists in the public API
// (GET /team/{id}/taskTemplate — verified live 2026-07-31; the previous
// /task/template path and the list/folder item-template paths are dead).
// Lists CAN still be created from templates — see lists.ts
// createListFromTemplateInFolder / createListFromTemplateInSpace.

export function createTemplatesClient(client: ClickUpClient) {
  return {
    /** Get task templates in a workspace (paged, 0-based). */
    async getTaskTemplates(workspaceId: string, page: number = 0): Promise<any> {
      return client.get(`/team/${workspaceId}/taskTemplate`, { page });
    }
  };
}
