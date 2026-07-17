export class DependenciesClient {
    constructor(client) {
        this.client = client;
    }
    // --- CRUD ---
    async addDependency(taskId, dependsOn) {
        await this.client.post(`/task/${taskId}/dependency`, { depends_on: dependsOn });
    }
    async removeDependency(taskId, dependsOn) {
        await this.client.delete(`/task/${taskId}/dependency`, {
            params: { depends_on: dependsOn }
        });
    }
    async getTaskDependencies(taskId) {
        const task = await this.client.get(`/task/${taskId}`, { include: ['dependencies'] });
        return task.dependencies || [];
    }
    async updateDependency(dependencyId, dependencyType) {
        return this.client.put(`/dependency/${dependencyId}`, { dependency_type: dependencyType });
    }
    async deleteDependency(dependencyId) {
        await this.client.delete(`/dependency/${dependencyId}`);
    }
    // --- Graph & Analysis ---
    async getDependencyGraph(taskId, direction) {
        return this.client.get(`/task/${taskId}/dependency`, {
            ...(direction ? { direction } : {})
        });
    }
    async checkDependencyConflicts(taskId, dependsOn) {
        return this.client.get(`/task/${taskId}/dependency/${dependsOn}/conflict`);
    }
    async resolveDependencyConflicts(taskId) {
        return this.client.post(`/task/${taskId}/dependency/conflicts/resolve`, {});
    }
    // --- Bulk ---
    async bulkCreateDependencies(workspaceId, dependencies) {
        return this.client.post(`/team/${workspaceId}/dependency`, { dependencies });
    }
    // --- Workspace-level ---
    async getWorkspaceDependencies(workspaceId, page) {
        return this.client.get(`/team/${workspaceId}/dependency`, page ? { page } : undefined);
    }
    async getDependencyStats(workspaceId) {
        return this.client.get(`/team/${workspaceId}/dependency/stats`);
    }
    async getDependencyTimelineImpact(taskId) {
        return this.client.get(`/task/${taskId}/dependency/timeline`);
    }
    async exportDependencyGraph(workspaceId) {
        return this.client.get(`/team/${workspaceId}/dependency/export`);
    }
    async importDependencyGraph(workspaceId, data) {
        return this.client.post(`/team/${workspaceId}/dependency/import`, data);
    }
}
export const createDependenciesClient = (client) => new DependenciesClient(client);
//# sourceMappingURL=dependencies.js.map