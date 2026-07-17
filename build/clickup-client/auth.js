export class AuthClient {
    constructor(client) {
        this.client = client;
    }
    /**
     * Get the authorized user's information
     * @returns The authorized user's information
     */
    async getAuthorizedUser() {
        try {
            return await this.client.get('/user');
        }
        catch (error) {
            console.error('Error getting authorized user:', error);
            throw error;
        }
    }
    /**
     * Get the workspaces (teams) that the authorized user belongs to
     * @returns A list of workspaces
     */
    async getWorkspaces() {
        try {
            return await this.client.get('/team');
        }
        catch (error) {
            console.error('Error getting workspaces:', error);
            throw error;
        }
    }
    /**
     * Get the spaces in a workspace
     * @param workspaceId The ID of the workspace to get spaces from
     * @returns A list of spaces
     */
    async getSpaces(workspaceId) {
        try {
            return await this.client.get(`/team/${workspaceId}/space`);
        }
        catch (error) {
            console.error('Error getting spaces:', error);
            throw error;
        }
    }
    /**
     * Get the folders in a space
     * @param spaceId The ID of the space to get folders from
     * @returns A list of folders
     */
    async getFolders(spaceId) {
        try {
            return await this.client.get(`/space/${spaceId}/folder`);
        }
        catch (error) {
            console.error('Error getting folders:', error);
            throw error;
        }
    }
    /**
     * Get the lists in a folder
     * @param folderId The ID of the folder to get lists from
     * @returns A list of lists
     */
    async getLists(folderId) {
        try {
            return await this.client.get(`/folder/${folderId}/list`);
        }
        catch (error) {
            console.error('Error getting lists:', error);
            throw error;
        }
    }
    /**
     * Get the lists in a space
     * @param spaceId The ID of the space to get lists from
     * @returns A list of lists
     */
    async getListsFromSpace(spaceId) {
        try {
            return await this.client.get(`/space/${spaceId}/list`);
        }
        catch (error) {
            console.error('Error getting lists from space:', error);
            throw error;
        }
    }
    /**
     * Get the seats information for a workspace
     * @param workspaceId The ID of the workspace to get seats information for
     * @returns Seats information including used, total, and available seats
     */
    async getWorkspaceSeats(workspaceId) {
        try {
            return await this.client.get(`/team/${workspaceId}/seats`);
        }
        catch (error) {
            console.error('Error getting workspace seats:', error);
            throw error;
        }
    }
}
export const createAuthClient = (client) => {
    return new AuthClient(client);
};
//# sourceMappingURL=auth.js.map