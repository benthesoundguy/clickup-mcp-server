import { ClickUpClient } from './index.js';

export interface View {
  id: string;
  name: string;
  type: string;
  [key: string]: any;
}

// NOTE: view duplicate (POST /view/{id}/duplicate) and sharing
// (POST/DELETE /view/{id}/share) were removed — live probing (2026-07-31)
// confirmed those routes do not exist in the public API.

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

  /** Create a view on a list. */
  async createListView(listId: string, name: string, type: number): Promise<View> {
    const res = await this.client.post<any>(`/list/${listId}/view`, { name, type });
    return res.view;
  }

  /** Get a specific view by ID. Returns the bare view object. */
  async getView(viewId: string): Promise<View> {
    const res = await this.client.get<any>(`/view/${viewId}`);
    return res.view ?? res;
  }

  /**
   * Update a view. ClickUp's PUT /view/{id} expects the FULL view object —
   * sending a partial body clobbers or rejects unsent fields — so this
   * performs a read-modify-write: fetch the current view, merge the changes,
   * send the whole thing back.
   */
  async updateView(viewId: string, changes: Record<string, any>): Promise<View> {
    const current = await this.getView(viewId);
    const merged = { ...current, ...changes };
    const res = await this.client.put<any>(`/view/${viewId}`, merged);
    return res.view ?? res;
  }

  /** Delete a view. */
  async deleteView(viewId: string): Promise<void> {
    await this.client.delete(`/view/${viewId}`);
  }

  /** Get tasks displayed in a view. */
  async getViewTasks(viewId: string, page?: number): Promise<{ tasks: any[] }> {
    return this.client.get<any>(`/view/${viewId}/task`, page !== undefined ? { page } : undefined);
  }
}

export const createViewsClient = (client: ClickUpClient): ViewsClient =>
  new ViewsClient(client);
