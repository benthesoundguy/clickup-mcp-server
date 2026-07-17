import { ClickUpClient } from './index.js';
export interface ChecklistItem {
    id: string;
    name: string;
    orderindex: number;
    resolved: boolean;
    assignee: {
        id: number;
        username: string;
        email: string;
    } | null;
    parent: string | null;
}
export interface Checklist {
    id: string;
    task_id: string;
    name: string;
    orderindex: number;
    items: ChecklistItem[];
}
export interface CreateChecklistParams {
    name: string;
}
export interface UpdateChecklistParams {
    name: string;
}
export interface CreateChecklistItemParams {
    name: string;
    assignee?: number;
    resolved?: boolean;
}
export interface UpdateChecklistItemParams {
    name?: string;
    assignee?: number;
    resolved?: boolean;
}
export declare class ChecklistsClient {
    private client;
    constructor(client: ClickUpClient);
    /**
     * Create a new checklist in a task
     * @param taskId The ID of the task to create the checklist in
     * @param params The checklist parameters
     * @returns The created checklist
     */
    createChecklist(taskId: string, params: CreateChecklistParams): Promise<Checklist>;
    /**
     * Update an existing checklist
     * @param checklistId The ID of the checklist to update
     * @param params The checklist parameters to update
     * @returns The updated checklist
     */
    updateChecklist(checklistId: string, params: UpdateChecklistParams): Promise<Checklist>;
    /**
     * Delete a checklist
     * @param checklistId The ID of the checklist to delete
     * @returns Success message
     */
    deleteChecklist(checklistId: string): Promise<{
        success: boolean;
    }>;
    /**
     * Create a new checklist item in a checklist
     * @param checklistId The ID of the checklist to create the item in
     * @param params The checklist item parameters
     * @returns The created checklist item
     */
    createChecklistItem(checklistId: string, params: CreateChecklistItemParams): Promise<ChecklistItem>;
    /**
     * Update an existing checklist item
     * @param checklistId The ID of the checklist containing the item
     * @param checklistItemId The ID of the checklist item to update
     * @param params The checklist item parameters to update
     * @returns The updated checklist item
     */
    updateChecklistItem(checklistId: string, checklistItemId: string, params: UpdateChecklistItemParams): Promise<ChecklistItem>;
    /**
     * Delete a checklist item
     * @param checklistId The ID of the checklist containing the item
     * @param checklistItemId The ID of the checklist item to delete
     * @returns Success message
     */
    deleteChecklistItem(checklistId: string, checklistItemId: string): Promise<{
        success: boolean;
    }>;
}
export declare const createChecklistsClient: (client: ClickUpClient) => ChecklistsClient;
