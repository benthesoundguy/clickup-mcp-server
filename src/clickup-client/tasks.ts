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
   * Create multiple tasks in a list in a single operation.
   * Tasks are created sequentially via the API. If continueOnError is true,
   * failures for individual tasks are collected and remaining tasks continue.
   * @param listId The ID of the list to create tasks in
   * @param tasks Array of task creation parameters
   * @param continueOnError Whether to continue if an individual task fails
   * @returns Results for each task with status and any errors
   */
  async bulkCreateTasks(
    listId: string,
    tasks: CreateTaskParams[],
    continueOnError: boolean = false
  ): Promise<{ results: Array<{ index: number; status: string; task?: Task; error?: string }> }> {
    const results: Array<{ index: number; status: string; task?: Task; error?: string }> = [];

    for (let i = 0; i < tasks.length; i++) {
      try {
        const task = await this.createTask(listId, tasks[i]);
        results.push({ index: i, status: 'created', task });
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error';
        if (continueOnError) {
          results.push({ index: i, status: 'failed', error: errorMessage });
        } else {
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
  async bulkUpdateTasks(
    updates: Array<{ task_id: string } & UpdateTaskParams>,
    continueOnError: boolean = false
  ): Promise<{ results: Array<{ task_id: string; status: string; error?: string }> }> {
    const results: Array<{ task_id: string; status: string; error?: string }> = [];

    for (let i = 0; i < updates.length; i++) {
      try {
        const { task_id, ...params } = updates[i];
        await this.updateTask(task_id, params);
        results.push({ task_id, status: 'updated' });
      } catch (error: any) {
        const msg = error.message || 'Unknown error';
        if (continueOnError) {
          results.push({ task_id: updates[i].task_id, status: 'failed', error: msg });
        } else {
          throw { partial: results, error: new Error(msg) };
        }
      }
    }

    return { results };
  }
}

export const createTasksClient = (client: ClickUpClient): TasksClient => {
  return new TasksClient(client);
};
