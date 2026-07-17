import { ClickUpClient } from './index.js';

export interface CustomFieldDefinition {
  id: string;
  name: string;
  type: string;
  type_config?: {
    options?: Array<{ id: string; name: string; color: string | null; orderindex: number }>;
    include_empty_option?: boolean;
  };
  date_created: string;
  hide_from_guests: boolean;
  required: boolean;
}

export class CustomFieldsClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  /**
   * Get custom field definitions for a list.
   */
  async getListFields(listId: string): Promise<CustomFieldDefinition[]> {
    const res = await this.client.get<any>(`/list/${listId}/field`);
    return res.fields;
  }

  /**
   * Get custom field definitions for a folder.
   */
  async getFolderFields(folderId: string): Promise<CustomFieldDefinition[]> {
    const res = await this.client.get<any>(`/folder/${folderId}/field`);
    return res.fields;
  }

  /**
   * Get custom field definitions for a space.
   */
  async getSpaceFields(spaceId: string): Promise<CustomFieldDefinition[]> {
    const res = await this.client.get<any>(`/space/${spaceId}/field`);
    return res.fields;
  }

  /**
   * Get custom field definitions for an entire workspace.
   */
  async getWorkspaceFields(workspaceId: string): Promise<CustomFieldDefinition[]> {
    const res = await this.client.get<any>(`/team/${workspaceId}/field`);
    return res.fields;
  }
  /**
   * Create a custom field definition on a list.
   */
  async createField(
    scopeId: string,
    params: {
      name: string;
      type: string;
      required?: boolean;
      options?: Array<{ name: string; orderindex: number }>;
    }
  ): Promise<any> {
    return this.client.post(`/list/${scopeId}/field`, params);
  }

  /**
   * Get all custom field values on a task. Returns fields with their current values.
   */
  async getTaskFieldValues(taskId: string): Promise<any> {
    const res = await this.client.get<any>(`/task/${taskId}`, { include: ['custom_fields'] });
    return res.custom_fields || [];
  }

  /**
   * Set the value of a custom field on a task.
   * The value format depends on field type (dropdown: option UUID, date: timestamp ms, etc.).
   */
  async setTaskFieldValue(taskId: string, fieldId: string, value: any): Promise<any> {
    return this.client.post(`/task/${taskId}/field/${fieldId}`, { value });
  }

  /**
   * Remove/clear a custom field value from a task.
   */
  async removeTaskFieldValue(taskId: string, fieldId: string): Promise<any> {
    return this.client.delete(`/task/${taskId}/field/${fieldId}`);
  }

  /**
   * Update a custom field definition.
   */
  async updateField(fieldId: string, params: { name?: string; required?: boolean; options?: Array<{ id?: string; name: string; orderindex?: number; color?: string }> }): Promise<any> {
    return this.client.put(`/field/${fieldId}`, params);
  }

  /**
   * Delete a custom field definition.
   */
  async deleteField(fieldId: string): Promise<any> {
    return this.client.delete(`/field/${fieldId}`);
  }

  /**
   * Set custom field values on multiple tasks.
   */
  async bulkSetFieldValues(updates: Array<{ task_id: string; field_id: string; value: any }>, continueOnError?: boolean): Promise<any> {
    const results: Array<{ task_id: string; field_id: string; status: string; error?: string }> = [];
    for (let i = 0; i < updates.length; i++) {
      try {
        await this.setTaskFieldValue(updates[i].task_id, updates[i].field_id, updates[i].value);
        results.push({ task_id: updates[i].task_id, field_id: updates[i].field_id, status: 'set' });
      } catch (error: any) {
        if (continueOnError) {
          results.push({ task_id: updates[i].task_id, field_id: updates[i].field_id, status: 'failed', error: error.message });
        } else {
          throw { partial: results, error: new Error(error.message) };
        }
      }
    }
    return { results };
  }
}

export const createCustomFieldsClient = (client: ClickUpClient): CustomFieldsClient =>
  new CustomFieldsClient(client);
