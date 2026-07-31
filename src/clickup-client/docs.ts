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
   * Search for docs in a workspace (v2 docs search endpoint).
   * A query of the form "space:<id>" searches by space instead of name.
   */
  async searchDocs(workspaceId: string, params: SearchDocsParams): Promise<{ docs: Doc[], next_cursor: string }> {
    const queryParams: Record<string, unknown> = { cursor: params.cursor };
    if (params.query.startsWith('space:')) {
      queryParams.space_id = params.query.substring(6);
    } else {
      queryParams.doc_name = params.query;
    }
    return this.client.get(`/team/${workspaceId}/docs/search`, queryParams);
  }

  /**
   * Create a new doc in a list (v3 API)
   */
  async createDocInList(listId: string, title: string, content: string, templateId?: string): Promise<Doc> {
    const body: Record<string, unknown> = { name: title, content };
    if (templateId) body.template_id = templateId;
    return this.client.post(`/lists/${listId}/docs`, body, { api: 'v3' });
  }

  /**
   * Create a new doc in a folder (v3 API)
   */
  async createDocInFolder(folderId: string, title: string, content: string, templateId?: string): Promise<Doc> {
    const body: Record<string, unknown> = { name: title, content };
    if (templateId) body.template_id = templateId;
    return this.client.post(`/folders/${folderId}/docs`, body, { api: 'v3' });
  }

  /**
   * Update an existing doc (v3 API)
   */
  async updateDoc(docId: string, title?: string, content?: string): Promise<Doc> {
    const body: Record<string, unknown> = {};
    if (title !== undefined) body.name = title;
    if (content !== undefined) body.content = content;
    return this.client.put(`/docs/${docId}`, body, { api: 'v3' });
  }

  /**
   * Delete a page from a doc (v3 API)
   */
  async deleteDocPage(docId: string, pageId: string): Promise<any> {
    return this.client.delete(`/docs/${docId}/pages/${pageId}`, { api: 'v3' });
  }

  /**
   * Create a new page in a doc (v3 API)
   */
  async createDocPage(docId: string, title: string, content: string, subTitle?: string, parentPageId?: string): Promise<any> {
    const body: Record<string, unknown> = { name: title, content };
    if (subTitle) body.sub_title = subTitle;
    if (parentPageId) body.parent_page_id = parentPageId;
    return this.client.post(`/docs/${docId}/pages`, body, { api: 'v3' });
  }

  /**
   * Update an existing page (v3 API)
   */
  async updateDocPage(docId: string, pageId: string, title?: string, content?: string, subTitle?: string): Promise<any> {
    const body: Record<string, unknown> = {};
    if (title !== undefined) body.name = title;
    if (content !== undefined) body.content = content;
    if (subTitle !== undefined) body.sub_title = subTitle;
    return this.client.put(`/docs/${docId}/pages/${pageId}`, body, { api: 'v3' });
  }
}

export const createDocsClient = (client: ClickUpClient): DocsClient => {
  return new DocsClient(client);
};
