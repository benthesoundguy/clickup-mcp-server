import { ClickUpClient } from './index.js';

export interface View {
  id: string;
  name: string;
  type: string;
  [key: string]: any;
}

export class ViewsClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  /** Get all views on a list. */
  async getListViews(listId: string): Promise<View[]> {
    const res = await this.client.get<any>(`/list/${listId}/view`);
    return res.views;
  }

  /** Create a view on a list. Returns { view: { id, name, type, ... } }. */
  async createListView(listId: string, name: string, type: number): Promise<View> {
    const res = await this.client.post<any>(`/list/${listId}/view`, { name, type });
    return res.view;
  }

  /** Get a specific view by ID. */
  async getView(viewId: string): Promise<View> {
    return this.client.get<View>(`/view/${viewId}`);
  }

  /** Update a view. */
  async updateView(viewId: string, params: Record<string, any>): Promise<View> {
    const res = await this.client.put<any>(`/view/${viewId}`, params);
    return res.view;
  }

  /** Delete a view. */
  async deleteView(viewId: string): Promise<void> {
    await this.client.delete(`/view/${viewId}`);
  }

  /** Duplicate a view. */
  async duplicateView(viewId: string, name: string, includeContent?: boolean): Promise<View> {
    const res = await this.client.post<any>(`/view/${viewId}/duplicate`, { name, include_content: includeContent ?? true });
    return res.view;
  }

  /** Get tasks displayed in a view. */
  async getViewTasks(viewId: string, page?: number): Promise<{ tasks: any[] }> {
    return this.client.get<any>(`/view/${viewId}/task`, page ? { page } : undefined);
  }

  /** Add sharing to a view. */
  async addViewSharing(viewId: string, type: string, id: string, permissionLevel?: string): Promise<any> {
    return this.client.post(`/view/${viewId}/share`, { type, id, permission_level: permissionLevel });
  }

  /** Remove sharing from a view. */
  async removeViewSharing(viewId: string, type: string, id: string): Promise<any> {
    return this.client.delete(`/view/${viewId}/share`, { params: { type, id } });
  }
}

export const createViewsClient = (client: ClickUpClient): ViewsClient =>
  new ViewsClient(client);
