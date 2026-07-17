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
    subtasks?: Task[];
    parent?: string;
    top_level_parent?: string;
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
export declare class TasksClient {
    private client;
    constructor(client: ClickUpClient);
    /**
     * Get tasks from a specific list
     * @param listId The ID of the list to get tasks from
     * @param params Optional parameters for filtering tasks
     * @returns A list of tasks
     */
    getTasksFromList(listId: string, params?: GetTasksParams): Promise<{
        tasks: Task[];
    }>;
    /**
     * Get a specific task by ID
     * @param taskId The ID of the task to get
     * @param params Optional parameters (include_subtasks)
     * @returns The task details
     */
    getTask(taskId: string, params?: {
        include_subtasks?: boolean;
    }): Promise<Task>;
    /**
     * Create a new task in a list
     * @param listId The ID of the list to create the task in
     * @param params The task parameters
     * @returns The created task
     */
    createTask(listId: string, params: CreateTaskParams): Promise<Task>;
    /**
     * Update an existing task
     * @param taskId The ID of the task to update
     * @param params The task parameters to update
     * @returns The updated task
     */
    updateTask(taskId: string, params: UpdateTaskParams): Promise<Task>;
    /**
     * Delete a task
     * @param taskId The ID of the task to delete
     * @returns Success message
     */
    deleteTask(taskId: string): Promise<{
        success: boolean;
    }>;
    /**
     * Get subtasks of a specific task
     * @param taskId The ID of the task to get subtasks for
     * @returns A list of subtasks
     */
    getSubtasks(taskId: string): Promise<Task[]>;
    /**
     * Get members assigned to a task.
     */
    getTaskMembers(taskId: string): Promise<any>;
    /**
     * Create multiple tasks in a list in a single operation.
     * Tasks are created sequentially via the API. If continueOnError is true,
     * failures for individual tasks are collected and remaining tasks continue.
     * @param listId The ID of the list to create tasks in
     * @param tasks Array of task creation parameters
     * @param continueOnError Whether to continue if an individual task fails
     * @returns Results for each task with status and any errors
     */
    bulkCreateTasks(listId: string, tasks: CreateTaskParams[], continueOnError?: boolean): Promise<{
        results: Array<{
            index: number;
            status: string;
            task?: Task;
            error?: string;
        }>;
    }>;
    /**
     * Update multiple tasks. Each entry requires a task_id and the fields to update.
     * If continueOnError is true, failures for individual tasks are collected.
     */
    bulkUpdateTasks(updates: Array<{
        task_id: string;
    } & UpdateTaskParams>, continueOnError?: boolean): Promise<{
        results: Array<{
            task_id: string;
            status: string;
            error?: string;
        }>;
    }>;
}
export declare const createTasksClient: (client: ClickUpClient) => TasksClient;
