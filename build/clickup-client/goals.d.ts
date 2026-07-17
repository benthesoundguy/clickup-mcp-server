import { ClickUpClient } from './index.js';
export declare class GoalsClient {
    private client;
    constructor(client: ClickUpClient);
    /** Get all goals in a workspace (folder). */
    getGoals(workspaceId: string): Promise<any>;
    /** Create a new goal in a workspace. */
    createGoal(workspaceId: string, name: string, dueDate?: number): Promise<any>;
    /** Get a specific goal by ID. */
    getGoal(goalId: string): Promise<any>;
    /** Update a goal's name and/or due date. */
    updateGoal(goalId: string, name?: string, dueDate?: number): Promise<any>;
    /** Delete a goal. */
    deleteGoal(goalId: string): Promise<any>;
    /** Create a key result under a goal. */
    createKeyResult(goalId: string, name: string, type: string, targetValue?: number, unit?: string): Promise<any>;
    /** Update a key result's name. */
    updateKeyResult(goalId: string, keyResultId: string, name?: string): Promise<any>;
    /** Delete a key result. */
    deleteKeyResult(goalId: string, keyResultId: string): Promise<any>;
}
export declare const createGoalsClient: (client: ClickUpClient) => GoalsClient;
