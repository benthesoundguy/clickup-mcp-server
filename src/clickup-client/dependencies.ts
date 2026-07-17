import { ClickUpClient } from './index.js';

export interface CreateDependencyRequest {
  depends_on: string;
  dependency_type?: string;
}

export interface UpdateDependencyRequest {
  dependency_type?: string;
}

export class DependenciesClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  // --- CRUD ---

  async addDependency(taskId: string, dependsOn: string): Promise<void> {
    await this.client.post(`/task/${taskId}/dependency`, { depends_on: dependsOn });
  }

  async removeDependency(taskId: string, dependsOn: string): Promise<void> {
    await this.client.delete(`/task/${taskId}/dependency`, {
      params: { depends_on: dependsOn }
    });
  }

  async getTaskDependencies(taskId: string): Promise<any> {
    const task = await this.client.get(`/task/${taskId}`, { include: ['dependencies'] });
    return task.dependencies || [];
  }

  async updateDependency(dependencyId: string, dependencyType?: string): Promise<any> {
    return this.client.put(`/dependency/${dependencyId}`, { dependency_type: dependencyType });
  }

  async deleteDependency(dependencyId: string): Promise<void> {
    await this.client.delete(`/dependency/${dependencyId}`);
  }

  // --- Graph & Analysis ---

  async getDependencyGraph(taskId: string, direction?: 'inbound' | 'outbound'): Promise<any> {
    return this.client.get(`/task/${taskId}/dependency`, {
      ...(direction ? { direction } : {})
    });
  }

  async checkDependencyConflicts(taskId: string, dependsOn: string): Promise<any> {
    return this.client.get(`/task/${taskId}/dependency/${dependsOn}/conflict`);
  }

  async resolveDependencyConflicts(taskId: string): Promise<any> {
    return this.client.post(`/task/${taskId}/dependency/conflicts/resolve`, {});
  }

  // --- Bulk ---

  async bulkCreateDependencies(workspaceId: string, dependencies: Array<{ task_id: string; depends_on: string; dependency_type?: string }>): Promise<any> {
    return this.client.post(`/team/${workspaceId}/dependency`, { dependencies });
  }

  // --- Workspace-level ---

  async getWorkspaceDependencies(workspaceId: string, page?: number): Promise<any> {
    return this.client.get(`/team/${workspaceId}/dependency`, page ? { page } : undefined);
  }

  async getDependencyStats(workspaceId: string): Promise<any> {
    return this.client.get(`/team/${workspaceId}/dependency/stats`);
  }

  async getDependencyTimelineImpact(taskId: string): Promise<any> {
    return this.client.get(`/task/${taskId}/dependency/timeline`);
  }

  async exportDependencyGraph(workspaceId: string): Promise<any> {
    return this.client.get(`/team/${workspaceId}/dependency/export`);
  }

  async importDependencyGraph(workspaceId: string, data: any): Promise<any> {
    return this.client.post(`/team/${workspaceId}/dependency/import`, data);
  }
}

export const createDependenciesClient = (client: ClickUpClient): DependenciesClient =>
  new DependenciesClient(client);
