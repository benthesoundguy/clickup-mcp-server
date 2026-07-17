export class SpacesClient {
    constructor(client) {
        this.client = client;
    }
    /**
     * Get spaces from a specific workspace
     * @param workspaceId The ID of the workspace to get spaces from
     * @returns A list of spaces
     */
    async getSpacesFromWorkspace(workspaceId) {
        // Use the v2 API endpoint for spaces
        const response = await this.client.get(`/team/${workspaceId}/space`);
        return response.spaces;
    }
    /**
     * Get a specific space by ID
     * @param spaceId The ID of the space to get
     * @returns The space details
     */
    async getSpace(spaceId) {
        const response = await this.client.get(`/space/${spaceId}`);
        return response;
    }
}
export const createSpacesClient = (client) => {
    return new SpacesClient(client);
};
//# sourceMappingURL=spaces.js.map