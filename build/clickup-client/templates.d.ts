import { ClickUpClient } from './index.js';
export declare function createTemplatesClient(client: ClickUpClient): {
    /** Get all task templates in a workspace. */
    getTaskTemplates(workspaceId: string): Promise<any>;
    /** Get all list item templates in a workspace list. */
    getListTemplates(workspaceId: string, listId: string): Promise<any>;
    /** Get all folder item templates in a workspace folder. */
    getFolderTemplates(workspaceId: string, folderId: string): Promise<any>;
};
