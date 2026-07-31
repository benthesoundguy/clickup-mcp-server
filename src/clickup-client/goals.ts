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
  /**
   * Create a key result (target) on a goal.
   * @param type one of: number, currency, boolean, percentage, automatic
   */
  async createKeyResult(
    goalId: string,
    name: string,
    type: string,
    opts: { stepsStart?: number; stepsEnd?: number; unit?: string; owners?: number[]; taskIds?: string[]; listIds?: string[] } = {}
  ): Promise<any> {
    return this.client.post(`/goal/${goalId}/key_result`, {
      name,
      type,
      steps_start: opts.stepsStart ?? 0,
      steps_end: opts.stepsEnd ?? 100,
      unit: opts.unit,
      owners: opts.owners ?? [],
      task_ids: opts.taskIds ?? [],
      list_ids: opts.listIds ?? [],
    });
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
