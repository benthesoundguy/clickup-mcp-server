import { ClickUpClient } from './index.js';

export interface Task {
  id: string;
  name: string;
  description?: string;
  status?: {
    status: string;
    color: string;
  };
  date_created?: string;
  date_updated?: string;
  date_closed?: string;
  creator?: {
    id: number;
    username: string;
    email: string;
  };
  assignees?: Array<{
    id: number;
    username: string;
    email: string;
  }>;
  priority?: {
    id: string;
    priority: string;
    color: string;
  };
  due_date?: string | null;
  start_date?: string | null;
  time_estimate?: number | null;
  time_spent?: number | null;
  custom_fields?: Array<any>;
  list?: {
    id: string;
    name: string;
  };
  folder?: {
    id: string;
    name: string;
  };
  space?: {
    id: string;
    name: string;
  };
  url: string;
  subtasks?: Task[]; // Add subtasks property
  parent?: string; // Add parent property
  top_level_parent?: string; // Add top_level_parent property
}

export interface CreateTaskParams {
  name: string;
  description?: string;
  assignees?: number[];
  tags?: string[];
  status?: string;
  priority?: number;
  due_date?: number;
  due_date_time?: boolean;
  time_estimate?: number;
  start_date?: number;
  start_date_time?: boolean;
  notify_all?: boolean;
  parent?: string;
  links_to?: string;
  check_required_custom_fields?: boolean;
  custom_fields?: Array<{
    id: string;
    value: any;
  }>;
  task_type?: string;
}

export interface UpdateTaskParams {
  name?: string;
  description?: string;
  assignees?: number[];
  status?: string;
  priority?: number;
  due_date?: number;
  due_date_time?: boolean;
  time_estimate?: number;
  start_date?: number;
  start_date_time?: boolean;
  notify_all?: boolean;
  parent?: string;
  custom_fields?: Array<{
    id: string;
    value: any;
  }>;
  task_type?: string;
}

export interface GetTasksParams {
  page?: number;
  order_by?: string;
  reverse?: boolean;
  subtasks?: boolean;
  statuses?: string[];
  include_closed?: boolean;
  assignees?: number[];
  due_date_gt?: number;
  due_date_lt?: number;
  date_created_gt?: number;
  date_created_lt?: number;
  date_updated_gt?: number;
  date_updated_lt?: number;
  custom_fields?: Array<{
    field_id: string;
    operator: string;
    value: any;
  }>;
}

export class TasksClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  /**
   * Get tasks from a specific list
   * @param listId The ID of the list to get tasks from
   * @param params Optional parameters for filtering tasks
   * @returns A list of tasks
   */
  async getTasksFromList(listId: string, params?: GetTasksParams): Promise<{ tasks: Task[] }> {
    return this.client.get(`/list/${listId}/task`, params);
  }

  // Removed pseudo endpoints for getting tasks from spaces and folders

  /**
   * Get a specific task by ID
   * @param taskId The ID of the task to get
   * @param params Optional parameters (include_subtasks)
   * @returns The task details
   */
  async getTask(taskId: string, params?: { include_subtasks?: boolean }): Promise<Task> {
    return this.client.get(`/task/${taskId}`, params);
  }

  /**
   * Create a new task in a list
   * @param listId The ID of the list to create the task in
   * @param params The task parameters
   * @returns The created task
   */
  async createTask(listId: string, params: CreateTaskParams): Promise<Task> {
    return this.client.post(`/list/${listId}/task`, params);
  }

  /**
   * Update an existing task
   * @param taskId The ID of the task to update
   * @param params The task parameters to update
   * @returns The updated task
   */
  async updateTask(taskId: string, params: UpdateTaskParams): Promise<Task> {
    return this.client.put(`/task/${taskId}`, params);
  }

  /**
   * Delete a task
   * @param taskId The ID of the task to delete
   * @returns Success message
   */
  async deleteTask(taskId: string): Promise<{ success: boolean }> {
    return this.client.delete(`/task/${taskId}`);
  }

  /**
   * Get subtasks of a specific task
   * @param taskId The ID of the task to get subtasks for
   * @returns A list of subtasks
   */
  async getSubtasks(taskId: string): Promise<Task[]> {
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
    } catch (error) {
      console.error(`Error getting subtasks for task ${taskId}:`, error);
      return [];
    }
  }

  /**
   * Get members assigned to a task.
   */
  async getTaskMembers(taskId: string): Promise<any> {
    const res = await this.client.get<any>(`/task/${taskId}/member`);
    return res.members;
  }

  /**
   * Create multiple tasks in a list, sequentially with pacing so serial
   * writes stay under ClickUp's rate limit. Never throws for individual
   * task failures — always returns a full result set with counts.
   * @param continueOnError When false, stops at the first failure (remaining
   *                        tasks are reported as skipped).
   */
  async bulkCreateTasks(
    listId: string,
    tasks: CreateTaskParams[],
    continueOnError: boolean = false
  ): Promise<BulkResult<{ index: number; status: string; task?: Task; error?: string }>> {
    const results: Array<{ index: number; status: string; task?: Task; error?: string }> = [];
    let succeeded = 0, failed = 0;

    for (let i = 0; i < tasks.length; i++) {
      if (i > 0) await bulkPause();
      try {
        const task = await this.createTask(listId, tasks[i]);
        results.push({ index: i, status: 'created', task });
        succeeded++;
      } catch (error: any) {
        results.push({ index: i, status: 'failed', error: error.message || 'Unknown error' });
        failed++;
        if (!continueOnError) {
          for (let j = i + 1; j < tasks.length; j++) {
            results.push({ index: j, status: 'skipped' });
          }
          return { results, succeeded, failed, stopped_early: true };
        }
      }
    }
    return { results, succeeded, failed };
  }

  /**
   * Update multiple tasks. Same result contract as bulkCreateTasks.
   */
  async bulkUpdateTasks(
    updates: Array<{ task_id: string } & UpdateTaskParams>,
    continueOnError: boolean = false
  ): Promise<BulkResult<{ task_id: string; status: string; error?: string }>> {
    const results: Array<{ task_id: string; status: string; error?: string }> = [];
    let succeeded = 0, failed = 0;

    for (let i = 0; i < updates.length; i++) {
      if (i > 0) await bulkPause();
      const { task_id, ...params } = updates[i];
      try {
        await this.updateTask(task_id, params);
        results.push({ task_id, status: 'updated' });
        succeeded++;
      } catch (error: any) {
        results.push({ task_id, status: 'failed', error: error.message || 'Unknown error' });
        failed++;
        if (!continueOnError) {
          for (let j = i + 1; j < updates.length; j++) {
            results.push({ task_id: updates[j].task_id, status: 'skipped' });
          }
          return { results, succeeded, failed, stopped_early: true };
        }
      }
    }
    return { results, succeeded, failed };
  }
}

export interface BulkResult<T> {
  results: T[];
  succeeded: number;
  failed: number;
  stopped_early?: boolean;
}

// Pause between serial bulk writes (~150ms keeps well under 100 req/min).
const bulkPause = () => new Promise<void>(r => setTimeout(r, 150));

export const createTasksClient = (client: ClickUpClient): TasksClient => {
  return new TasksClient(client);
};
