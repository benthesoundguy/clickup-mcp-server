export function createSearchClient(client) {
    return {
        async searchWorkspace(teamId, params) {
            return client.post(`/team/${teamId}/search`, params);
        }
    };
}
//# sourceMappingURL=search.js.map