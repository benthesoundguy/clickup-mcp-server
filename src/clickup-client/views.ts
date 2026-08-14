import { ClickUpClient } from './index.js';

/** View types verified to work against the live API (2026-08-14). "form" is rejected. */
export const VIEW_TYPES = [
  'list', 'board', 'calendar', 'table', 'timeline',
  'workload', 'activity', 'map', 'gantt', 'conversation', 'doc',
] as const;
export type ViewType = typeof VIEW_TYPES[number];

/** Legacy numeric types this server used to advertise → real API strings. */
export const LEGACY_VIEW_TYPE_MAP: Record<number, ViewType> = {
  1: 'list', 2: 'board', 3: 'calendar', 4: 'gantt',
  6: 'map', 7: 'timeline', 8: 'activity', 9: 'workload', 10: 'table',
};

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

  /**
   * Create a view on a list.
   * ClickUp's view `type` is a STRING ("board", "calendar", ...). Passing a
   * number is silently accepted and always yields a LIST view — verified live
   * 2026-08-14, which is why every created view used to come back as a list.
   */
  async createListView(listId: string, name: string, type: ViewType): Promise<View> {
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
