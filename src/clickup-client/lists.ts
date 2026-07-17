import { ClickUpClient } from './index.js';

export interface List {
  id: string;
  name: string;
}

export interface GetListsParams {
  // ...parameters for getting lists...
}

export interface CreateListParams {
  name: string;
}

export interface UpdateListParams {
  name?: string;
}

export class ListsClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  async getListsFromSpace(spaceId: string, params?: GetListsParams): Promise<{ lists: List[] }> {
    return this.client.get(`/space/${spaceId}/list`, params);
  }

  async getListsFromFolder(folderId: string, params?: GetListsParams): Promise<{ lists: List[] }> {
    return this.client.get(`/folder/${folderId}/list`, params);
  }

  async createListInFolder(folderId: string, params: CreateListParams): Promise<List> {
    return this.client.post(`/folder/${folderId}/list`, params);
  }

  async createFolderlessList(spaceId: string, params: CreateListParams): Promise<List> {
    return this.client.post(`/space/${spaceId}/list`, params);
  }

  async getList(listId: string): Promise<List> {
    return this.client.get(`/list/${listId}`);
  }

  async updateList(listId: string, params: UpdateListParams): Promise<List> {
    return this.client.put(`/list/${listId}`, params);
  }

  async deleteList(listId: string): Promise<{ success: boolean }> {
    return this.client.delete(`/list/${listId}`);
  }

  async addTaskToList(listId: string, taskId: string): Promise<{ success: boolean }> {
    return this.client.post(`/list/${listId}/task/${taskId}`);
  }

  async removeTaskFromList(listId: string, taskId: string): Promise<{ success: boolean }> {
    return this.client.delete(`/list/${listId}/task/${taskId}`);
  }

  async createListFromTemplateInFolder(folderId: string, templateId: string, params: CreateListParams): Promise<List> {
    return this.client.post(`/folder/${folderId}/list/template/${templateId}`, params);
  }

  async createListFromTemplateInSpace(spaceId: string, templateId: string, params: CreateListParams): Promise<List> {
    return this.client.post(`/space/${spaceId}/list/template/${templateId}`, params);
  }

  async getListMembers(listId: string): Promise<any> {
    return this.client.get(`/list/${listId}/member`);
  }

  async getStatuses(listId: string): Promise<any> {
    const res = await this.client.get<any>(`/list/${listId}`);
    return res.statuses || [];
  }

  async setStatuses(
    listId: string,
    statuses: Array<{ status: string; color: string; orderindex?: number; hide_label?: boolean }>,
    overrideExisting?: boolean
  ): Promise<any> {
    return this.client.put(`/list/${listId}`, {
      override_statuses: overrideExisting ?? true,
      statuses
    });
  }
}

export const createListsClient = (client: ClickUpClient): ListsClient => {
  return new ListsClient(client);
};
