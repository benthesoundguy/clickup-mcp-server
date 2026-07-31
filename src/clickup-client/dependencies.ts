import { ClickUpClient } from './index.js';

// ClickUp v2 exposes exactly two dependency write operations:
//   POST   /task/{id}/dependency   (body: depends_on OR dependency_of)
//   DELETE /task/{id}/dependency   (query: depends_on / dependency_of)
// Everything else (graph analysis, conflicts, workspace-level views) is
// computed locally — see project-intelligence.ts. The previous versions of
// this client called ~10 endpoints that do not exist in the public API
// (verified dead by live probe on 2026-07-31).

export class DependenciesClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  /** Make taskId depend on dependsOn (taskId is blocked by dependsOn). */
  async addDependency(taskId: string, dependsOn: string): Promise<void> {
    await this.client.post(`/task/${taskId}/dependency`, { depends_on: dependsOn });
  }

  /** Remove the dependency of taskId on dependsOn. */
  async removeDependency(taskId: string, dependsOn: string): Promise<void> {
    await this.client.delete(`/task/${taskId}/dependency`, {
      params: { depends_on: dependsOn }
    });
  }

  /** Read a task's dependencies (returned on the task object). */
  async getTaskDependencies(taskId: string): Promise<any> {
    const task = await this.client.get(`/task/${taskId}`);
    return task.dependencies || [];
  }
}

export const createDependenciesClient = (client: ClickUpClient): DependenciesClient =>
  new DependenciesClient(client);
