import { ClickUpClient } from './index.js';

// Doc interface based on v3 API response
export interface Doc {
  id: string;
  name: string;
  date_created: number;
  date_updated: number;
  parent?: {
    id: string;
    type: number;
  };
  public: boolean;
  workspace_id: number;
  creator: number;
  deleted: boolean;
  type: number;
  content?: string;
}

export interface GetDocsParams {
  cursor?: string;
  deleted?: boolean;
  archived?: boolean;
  limit?: number;
}

export interface SearchDocsParams {
  query: string;
  cursor?: string;
}

export class DocsClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  /**
   * Get docs from a specific workspace (v3 API)
   */
  async getDocsFromWorkspace(workspaceId: string, params?: GetDocsParams): Promise<{ docs: Doc[], next_cursor: string }> {
    return this.client.get(`/workspaces/${workspaceId}/docs`, params as Record<string, unknown>, { api: 'v3' });
  }

  /**
   * Get the pages of a doc (v3 API)
   * @param contentFormat The format to return the content in (text/md or text/plain)
   */
  async getDocPages(workspaceId: string, docId: string, contentFormat: string = 'text/md'): Promise<any> {
    return this.client.get(
      `/workspaces/${workspaceId}/docs/${docId}/pages`,
      { max_page_depth: -1, content_format: contentFormat },
      { api: 'v3' }
    );
  }

  /**
   * Search docs in a workspace by name (case-insensitive substring).
   * The API has no free-text doc search endpoint (the old
   * /team/{id}/docs/search route is dead — smoke-verified), so this pages
   * through the v3 doc listing and filters locally.
   */
  async searchDocs(workspaceId: string, params: SearchDocsParams): Promise<{ docs: Doc[], next_cursor: string }> {
    const needle = params.query.toLowerCase();
    const matches: Doc[] = [];
    let cursor: string | undefined = params.cursor;
    for (let page = 0; page < 10; page++) {
      const res: { docs: Doc[]; next_cursor: string } = await this.getDocsFromWorkspace(workspaceId, { cursor, limit: 100 });
      for (const doc of res.docs ?? []) {
        if (doc.name?.toLowerCase().includes(needle)) matches.push(doc);
      }
      cursor = res.next_cursor || undefined;
      if (!cursor) break;
    }
    return { docs: matches, next_cursor: cursor ?? '' };
  }

  /**
   * Create a doc in a workspace (v3 API: POST /workspaces/{id}/docs).
   * Parent container types: 4 = space, 5 = folder, 6 = list.
   * The doc is created with one page holding the provided content.
   */
  async createDoc(
    workspaceId: string,
    name: string,
    parent?: { id: string; type: number },
    visibility: string = 'PRIVATE'
  ): Promise<Doc> {
    const body: Record<string, unknown> = { name, create_page: true, visibility };
    if (parent) body.parent = parent;
    return this.client.post(`/workspaces/${workspaceId}/docs`, body, { api: 'v3' });
  }

  /** Create a doc attached to a list. */
  async createDocInList(workspaceId: string, listId: string, title: string): Promise<Doc> {
    return this.createDoc(workspaceId, title, { id: listId, type: 6 });
  }

  /** Create a doc attached to a folder. */
  async createDocInFolder(workspaceId: string, folderId: string, title: string): Promise<Doc> {
    return this.createDoc(workspaceId, title, { id: folderId, type: 5 });
  }

  /**
   * Create a new page in a doc (v3 API, workspace-scoped route)
   */
  async createDocPage(workspaceId: string, docId: string, title: string, content: string, subTitle?: string, parentPageId?: string): Promise<any> {
    const body: Record<string, unknown> = { name: title, content };
    if (subTitle) body.sub_title = subTitle;
    if (parentPageId) body.parent_page_id = parentPageId;
    return this.client.post(`/workspaces/${workspaceId}/docs/${docId}/pages`, body, { api: 'v3' });
  }

  /**
   * Update an existing page (v3 API, workspace-scoped route)
   */
  async updateDocPage(workspaceId: string, docId: string, pageId: string, title?: string, content?: string, subTitle?: string): Promise<any> {
    const body: Record<string, unknown> = {};
    if (title !== undefined) body.name = title;
    if (content !== undefined) body.content = content;
    if (subTitle !== undefined) body.sub_title = subTitle;
    return this.client.put(`/workspaces/${workspaceId}/docs/${docId}/pages/${pageId}`, body, { api: 'v3' });
  }
}

export const createDocsClient = (client: ClickUpClient): DocsClient => {
  return new DocsClient(client);
};
