import { ClickUpClient } from './index.js';
export interface CustomFieldDefinition {
    id: string;
    name: string;
    type: string;
    type_config?: {
        options?: Array<{
            id: string;
            name: string;
            color: string | null;
            orderindex: number;
        }>;
        include_empty_option?: boolean;
    };
    date_created: string;
    hide_from_guests: boolean;
    required: boolean;
}
export declare class CustomFieldsClient {
    private client;
    constructor(client: ClickUpClient);
    /**
     * Get custom field definitions for a list.
     */
    getListFields(listId: string): Promise<CustomFieldDefinition[]>;
    /**
     * Get custom field definitions for a folder.
     */
    getFolderFields(folderId: string): Promise<CustomFieldDefinition[]>;
    /**
     * Get custom field definitions for a space.
     */
    getSpaceFields(spaceId: string): Promise<CustomFieldDefinition[]>;
    /**
     * Get custom field definitions for an entire workspace.
     */
    getWorkspaceFields(workspaceId: string): Promise<CustomFieldDefinition[]>;
    /**
     * Create a custom field definition on a list.
     */
    createField(scopeId: string, params: {
        name: string;
        type: string;
        required?: boolean;
        options?: Array<{
            name: string;
            orderindex: number;
        }>;
    }): Promise<any>;
    /**
     * Get all custom field values on a task. Returns fields with their current values.
     */
    getTaskFieldValues(taskId: string): Promise<any>;
    /**
     * Set the value of a custom field on a task.
     * The value format depends on field type (dropdown: option UUID, date: timestamp ms, etc.).
     */
    setTaskFieldValue(taskId: string, fieldId: string, value: any): Promise<any>;
    /**
     * Remove/clear a custom field value from a task.
     */
    removeTaskFieldValue(taskId: string, fieldId: string): Promise<any>;
    /**
     * Update a custom field definition.
     */
    updateField(fieldId: string, params: {
        name?: string;
        required?: boolean;
        options?: Array<{
            id?: string;
            name: string;
            orderindex?: number;
            color?: string;
        }>;
    }): Promise<any>;
    /**
     * Delete a custom field definition.
     */
    deleteField(fieldId: string): Promise<any>;
    /**
     * Set custom field values on multiple tasks.
     */
    bulkSetFieldValues(updates: Array<{
        task_id: string;
        field_id: string;
        value: any;
    }>, continueOnError?: boolean): Promise<any>;
}
export declare const createCustomFieldsClient: (client: ClickUpClient) => CustomFieldsClient;
