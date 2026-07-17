export class FoldersClient {
    constructor(client) {
        this.client = client;
    }
    /**
     * Get folders from a specific space
     * @param spaceId The ID of the space to get folders from
     * @param params Optional parameters for filtering folders
     * @returns A list of folders
     */
    async getFoldersFromSpace(spaceId, params) {
        return this.client.get(`/space/${spaceId}/folder`, params);
    }
    /**
     * Get lists from a specific folder
     * @param folderId The ID of the folder to get lists from
     * @param params Optional parameters for filtering lists
     * @returns A list of lists
     */
    async getListsFromFolder(folderId, params) {
        return this.client.get(`/folder/${folderId}/list`, params);
    }
    /**
     * Create a new folder in a space
     * @param spaceId The ID of the space to create the folder in
     * @param params The folder parameters
     * @returns The created folder
     */
    async createFolder(spaceId, params) {
        return this.client.post(`/space/${spaceId}/folder`, params);
    }
    /**
     * Update an existing folder
     * @param folderId The ID of the folder to update
     * @param params The folder parameters to update
     * @returns The updated folder
     */
    async updateFolder(folderId, params) {
        return this.client.put(`/folder/${folderId}`, params);
    }
    /**
     * Delete a folder
     * @param folderId The ID of the folder to delete
     * @returns Success message
     */
    async deleteFolder(folderId) {
        return this.client.delete(`/folder/${folderId}`);
    }
}
export const createFoldersClient = (client) => {
    return new FoldersClient(client);
};
//# sourceMappingURL=folders.js.map