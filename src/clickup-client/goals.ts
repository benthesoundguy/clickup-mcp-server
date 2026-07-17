import { ClickUpClient } from './index.js';

export class GoalsClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  /** Get all goals in a workspace (folder). */
  async getGoals(workspaceId: string): Promise<any> {
    return this.client.get(`/team/${workspaceId}/goal`);
  }

  /** Create a new goal in a workspace. */
  async createGoal(workspaceId: string, name: string, dueDate?: number): Promise<any> {
    return this.client.post(`/team/${workspaceId}/goal`, { name, due_date: dueDate });
  }

  /** Get a specific goal by ID. */
  async getGoal(goalId: string): Promise<any> {
    return this.client.get(`/goal/${goalId}`);
  }

  /** Update a goal's name and/or due date. */
  async updateGoal(goalId: string, name?: string, dueDate?: number): Promise<any> {
    return this.client.put(`/goal/${goalId}`, { name, due_date: dueDate });
  }

  /** Delete a goal. */
  async deleteGoal(goalId: string): Promise<any> {
    return this.client.delete(`/goal/${goalId}`);
  }

  /** Create a key result under a goal. */
  async createKeyResult(goalId: string, name: string, type: string, targetValue?: number, unit?: string): Promise<any> {
    return this.client.post(`/goal/${goalId}/key_result`, { name, type, target_value: targetValue, unit });
  }

  /** Update a key result's name. */
  async updateKeyResult(goalId: string, keyResultId: string, name?: string): Promise<any> {
    return this.client.put(`/goal/${goalId}/key_result/${keyResultId}`, { name });
  }

  /** Delete a key result. */
  async deleteKeyResult(goalId: string, keyResultId: string): Promise<any> {
    return this.client.delete(`/goal/${goalId}/key_result/${keyResultId}`);
  }
}

export const createGoalsClient = (client: ClickUpClient): GoalsClient =>
  new GoalsClient(client);
