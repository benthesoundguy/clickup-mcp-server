export class TasksClient {
    constructor(client) {
        this.client = client;
    }
    /**
     * Get tasks from a specific list
     * @param listId The ID of the list to get tasks from
     * @param params Optional parameters for filtering tasks
     * @returns A list of tasks
     */
    async getTasksFromList(listId, params) {
        return this.client.get(`/list/${listId}/task`, params);
    }
    // Removed pseudo endpoints for getting tasks from spaces and folders
    /**
     * Get a specific task by ID
     * @param taskId The ID of the task to get
     * @param params Optional parameters (include_subtasks)
     * @returns The task details
     */
    async getTask(taskId, params) {
        return this.client.get(`/task/${taskId}`, params);
    }
    /**
     * Create a new task in a list
     * @param listId The ID of the list to create the task in
     * @param params The task parameters
     * @returns The created task
     */
    async createTask(listId, params) {
        return this.client.post(`/list/${listId}/task`, params);
    }
    /**
     * Update an existing task
     * @param taskId The ID of the task to update
     * @param params The task parameters to update
     * @returns The updated task
     */
    async updateTask(taskId, params) {
        return this.client.put(`/task/${taskId}`, params);
    }
    /**
     * Delete a task
     * @param taskId The ID of the task to delete
     * @returns Success message
     */
    async deleteTask(taskId) {
        return this.client.delete(`/task/${taskId}`);
    }
    /**
     * Get subtasks of a specific task
     * @param taskId The ID of the task to get subtasks for
     * @returns A list of subtasks
     */
    async getSubtasks(taskId) {
        try {
            // First, we need to get the task to find its list ID
            const task = await this.getTask(taskId);
            if (!task.list || !task.list.id) {
                throw new Error('Task does not have a list ID');
            }
            // Then, get all tasks from the list with subtasks included
            const result = await this.getTasksFromList(task.list.id, { subtasks: true });
            // Filter tasks to find those that have the specified task as parent
            return result.tasks.filter(task => task.parent === taskId);
        }
        catch (error) {
            console.error(`Error getting subtasks for task ${taskId}:`, error);
            return [];
        }
    }
    /**
     * Get members assigned to a task.
     */
    async getTaskMembers(taskId) {
        const res = await this.client.get(`/task/${taskId}/member`);
        return res.members;
    }
    /**
     * Create multiple tasks in a list in a single operation.
     * Tasks are created sequentially via the API. If continueOnError is true,
     * failures for individual tasks are collected and remaining tasks continue.
     * @param listId The ID of the list to create tasks in
     * @param tasks Array of task creation parameters
     * @param continueOnError Whether to continue if an individual task fails
     * @returns Results for each task with status and any errors
     */
    async bulkCreateTasks(listId, tasks, continueOnError = false) {
        const results = [];
        for (let i = 0; i < tasks.length; i++) {
            try {
                const task = await this.createTask(listId, tasks[i]);
                results.push({ index: i, status: 'created', task });
            }
            catch (error) {
                const errorMessage = error.message || 'Unknown error';
                if (continueOnError) {
                    results.push({ index: i, status: 'failed', error: errorMessage });
                }
                else {
                    results.push({ index: i, status: 'failed', error: errorMessage });
                    // Return partial results + the error
                    throw { partial: results, error: new Error(errorMessage) };
                }
            }
        }
        return { results };
    }
    /**
     * Update multiple tasks. Each entry requires a task_id and the fields to update.
     * If continueOnError is true, failures for individual tasks are collected.
     */
    async bulkUpdateTasks(updates, continueOnError = false) {
        const results = [];
        for (let i = 0; i < updates.length; i++) {
            try {
                const { task_id, ...params } = updates[i];
                await this.updateTask(task_id, params);
                results.push({ task_id, status: 'updated' });
            }
            catch (error) {
                const msg = error.message || 'Unknown error';
                if (continueOnError) {
                    results.push({ task_id: updates[i].task_id, status: 'failed', error: msg });
                }
                else {
                    throw { partial: results, error: new Error(msg) };
                }
            }
        }
        return { results };
    }
}
export const createTasksClient = (client) => {
    return new TasksClient(client);
};
//# sourceMappingURL=tasks.js.map