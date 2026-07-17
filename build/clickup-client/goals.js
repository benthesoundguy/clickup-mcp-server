export class GoalsClient {
    constructor(client) {
        this.client = client;
    }
    /** Get all goals in a workspace (folder). */
    async getGoals(workspaceId) {
        return this.client.get(`/team/${workspaceId}/goal`);
    }
    /** Create a new goal in a workspace. */
    async createGoal(workspaceId, name, dueDate) {
        return this.client.post(`/team/${workspaceId}/goal`, { name, due_date: dueDate });
    }
    /** Get a specific goal by ID. */
    async getGoal(goalId) {
        return this.client.get(`/goal/${goalId}`);
    }
    /** Update a goal's name and/or due date. */
    async updateGoal(goalId, name, dueDate) {
        return this.client.put(`/goal/${goalId}`, { name, due_date: dueDate });
    }
    /** Delete a goal. */
    async deleteGoal(goalId) {
        return this.client.delete(`/goal/${goalId}`);
    }
    /** Create a key result under a goal. */
    async createKeyResult(goalId, name, type, targetValue, unit) {
        return this.client.post(`/goal/${goalId}/key_result`, { name, type, target_value: targetValue, unit });
    }
    /** Update a key result's name. */
    async updateKeyResult(goalId, keyResultId, name) {
        return this.client.put(`/goal/${goalId}/key_result/${keyResultId}`, { name });
    }
    /** Delete a key result. */
    async deleteKeyResult(goalId, keyResultId) {
        return this.client.delete(`/goal/${goalId}/key_result/${keyResultId}`);
    }
}
export const createGoalsClient = (client) => new GoalsClient(client);
//# sourceMappingURL=goals.js.map