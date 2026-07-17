import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createGoalsClient } from '../clickup-client/goals.js';
const clickUpClient = createClickUpClient();
const goalsClient = createGoalsClient(clickUpClient);
export function setupGoalTools(server) {
    server.tool('goals_list', 'Get all goals in a ClickUp workspace.', { workspace_id: z.string().describe('The ID of the workspace') }, async ({ workspace_id }) => {
        try {
            const result = await goalsClient.getGoals(workspace_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (error) {
            console.error('[GoalTools] Error listing goals:', error);
            return { content: [{ type: 'text', text: `Error listing goals: ${error.message}` }], isError: true };
        }
    });
    server.tool('goals_create', 'Create a new goal in a ClickUp workspace.', {
        workspace_id: z.string().describe('The ID of the workspace'),
        name: z.string().describe('The name of the goal'),
        due_date: z.number().optional().describe('Due date as Unix timestamp in milliseconds')
    }, async ({ workspace_id, name, due_date }) => {
        try {
            const result = await goalsClient.createGoal(workspace_id, name, due_date);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (error) {
            console.error('[GoalTools] Error creating goal:', error);
            return { content: [{ type: 'text', text: `Error creating goal: ${error.message}` }], isError: true };
        }
    });
    server.tool('goals_get', 'Get details of a specific ClickUp goal by ID.', { goal_id: z.string().describe('The ID of the goal') }, async ({ goal_id }) => {
        try {
            const result = await goalsClient.getGoal(goal_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (error) {
            console.error('[GoalTools] Error getting goal:', error);
            return { content: [{ type: 'text', text: `Error getting goal: ${error.message}` }], isError: true };
        }
    });
    server.tool('goals_update', 'Update a ClickUp goal name and/or due date.', {
        goal_id: z.string().describe('The ID of the goal to update'),
        name: z.string().optional().describe('New name for the goal'),
        due_date: z.number().optional().describe('New due date as Unix timestamp in milliseconds')
    }, async ({ goal_id, name, due_date }) => {
        try {
            const result = await goalsClient.updateGoal(goal_id, name, due_date);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (error) {
            console.error('[GoalTools] Error updating goal:', error);
            return { content: [{ type: 'text', text: `Error updating goal: ${error.message}` }], isError: true };
        }
    });
    server.tool('goals_delete', 'Delete a ClickUp goal by ID.', { goal_id: z.string().describe('The ID of the goal to delete') }, async ({ goal_id }) => {
        try {
            const result = await goalsClient.deleteGoal(goal_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (error) {
            console.error('[GoalTools] Error deleting goal:', error);
            return { content: [{ type: 'text', text: `Error deleting goal: ${error.message}` }], isError: true };
        }
    });
    server.tool('goals_key_results_create', 'Create a key result under a ClickUp goal.', {
        goal_id: z.string().describe('The ID of the goal'),
        name: z.string().describe('The name of the key result'),
        type: z.string().describe('The type of key result (e.g. "number", "currency", "percentage", "automatic")'),
        target_value: z.number().optional().describe('The target value for the key result'),
        unit: z.string().optional().describe('The unit for the key result value')
    }, async ({ goal_id, name, type, target_value, unit }) => {
        try {
            const result = await goalsClient.createKeyResult(goal_id, name, type, target_value, unit);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (error) {
            console.error('[GoalTools] Error creating key result:', error);
            return { content: [{ type: 'text', text: `Error creating key result: ${error.message}` }], isError: true };
        }
    });
    server.tool('goals_key_results_update', 'Update a key result under a ClickUp goal.', {
        goal_id: z.string().describe('The ID of the goal containing the key result'),
        key_result_id: z.string().describe('The ID of the key result to update'),
        name: z.string().optional().describe('New name for the key result')
    }, async ({ goal_id, key_result_id, name }) => {
        try {
            const result = await goalsClient.updateKeyResult(goal_id, key_result_id, name);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (error) {
            console.error('[GoalTools] Error updating key result:', error);
            return { content: [{ type: 'text', text: `Error updating key result: ${error.message}` }], isError: true };
        }
    });
    server.tool('goals_key_results_delete', 'Delete a key result from a ClickUp goal.', {
        goal_id: z.string().describe('The ID of the goal containing the key result'),
        key_result_id: z.string().describe('The ID of the key result to delete')
    }, async ({ goal_id, key_result_id }) => {
        try {
            const result = await goalsClient.deleteKeyResult(goal_id, key_result_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (error) {
            console.error('[GoalTools] Error deleting key result:', error);
            return { content: [{ type: 'text', text: `Error deleting key result: ${error.message}` }], isError: true };
        }
    });
}
//# sourceMappingURL=goal-tools.js.map