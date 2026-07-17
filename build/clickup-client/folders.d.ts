import { ClickUpClient } from './index.js';
export interface Folder {
    id: string;
    name: string;
}
export interface GetFoldersParams {
}
export interface List {
    id: string;
    name: string;
}
export interface GetListsParams {
}
export declare class FoldersClient {
    private client;
    constructor(client: ClickUpClient);
    /**
     * Get folders from a specific space
     * @param spaceId The ID of the space to get folders from
     * @param params Optional parameters for filtering folders
     * @returns A list of folders
     */
    getFoldersFromSpace(spaceId: string, params?: GetFoldersParams): Promise<{
        folders: Folder[];
    }>;
    /**
     * Get lists from a specific folder
     * @param folderId The ID of the folder to get lists from
     * @param params Optional parameters for filtering lists
     * @returns A list of lists
     */
    getListsFromFolder(folderId: string, params?: GetListsParams): Promise<{
        lists: List[];
    }>;
    /**
     * Create a new folder in a space
     * @param spaceId The ID of the space to create the folder in
     * @param params The folder parameters
     * @returns The created folder
     */
    createFolder(spaceId: string, params: {
        name: string;
    }): Promise<Folder>;
    /**
     * Update an existing folder
     * @param folderId The ID of the folder to update
     * @param params The folder parameters to update
     * @returns The updated folder
     */
    updateFolder(folderId: string, params: {
        name: string;
    }): Promise<Folder>;
    /**
     * Delete a folder
     * @param folderId The ID of the folder to delete
     * @returns Success message
     */
    deleteFolder(folderId: string): Promise<{
        success: boolean;
    }>;
}
export declare const createFoldersClient: (client: ClickUpClient) => FoldersClient;
