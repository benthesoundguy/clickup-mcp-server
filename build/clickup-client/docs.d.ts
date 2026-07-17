import { ClickUpClient } from './index.js';
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
export declare class DocsClient {
    private client;
    constructor(client: ClickUpClient);
    /**
     * Get docs from a specific workspace
     * @param workspaceId The ID of the workspace to get docs from
     * @param params Optional parameters for filtering docs
     * @returns A list of docs
     */
    getDocsFromWorkspace(workspaceId: string, params?: GetDocsParams): Promise<{
        docs: Doc[];
        next_cursor: string;
    }>;
    /**
     * Get the pages of a doc
     * @param workspaceId The ID of the workspace
     * @param docId The ID of the doc
     * @param contentFormat The format to return the content in (text/md or text/plain)
     * @returns The pages of the doc
     */
    getDocPages(workspaceId: string, docId: string, contentFormat?: string): Promise<any>;
    /**
     * Search for docs in a workspace
     * @param workspaceId The ID of the workspace to search in
     * @param params The search parameters
     * @returns A list of docs matching the search query
     */
    searchDocs(workspaceId: string, params: SearchDocsParams): Promise<{
        docs: Doc[];
        next_cursor: string;
    }>;
    /**
     * Create a new doc in a list
     * @param listId The ID of the list to create the doc in
     * @param title The title of the doc
     * @param content The content of the doc (HTML format)
     * @returns The created doc
     */
    createDocInList(listId: string, title: string, content: string, templateId?: string): Promise<Doc>;
    /**
     * Create a new doc in a folder
     * @param folderId The ID of the folder to create the doc in
     * @param title The title of the doc
     * @param content The content of the doc (HTML format)
     * @returns The created doc
     */
    createDocInFolder(folderId: string, title: string, content: string, templateId?: string): Promise<Doc>;
    /**
     * Update an existing doc
     * @param docId The ID of the doc to update
     * @param title The new title of the doc
     * @param content The new content of the doc (HTML format)
     * @returns The updated doc
     */
    updateDoc(docId: string, title?: string, content?: string): Promise<Doc>;
    /**
     * Delete a page from a doc.
     */
    deleteDocPage(docId: string, pageId: string): Promise<any>;
    /**
     * Create a new page in a doc.
     */
    createDocPage(docId: string, title: string, content: string, subTitle?: string, parentPageId?: string): Promise<any>;
    /**
     * Update an existing page.
     */
    updateDocPage(docId: string, pageId: string, title?: string, content?: string, subTitle?: string): Promise<any>;
}
export declare const createDocsClient: (client: ClickUpClient) => DocsClient;
