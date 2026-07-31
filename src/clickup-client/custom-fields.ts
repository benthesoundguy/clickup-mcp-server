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

  // NOTE: field definition update (PUT /field/{id}) and delete
  // (DELETE /field/{id}) were removed — live probing (2026-07-31) confirmed
  // those routes do not exist. Field definitions can be created and read,
  // but only edited/deleted in the ClickUp UI.

  /**
   * Set custom field values on multiple tasks, sequentially with pacing.
   * Never throws for individual failures — returns a full result set with
   * counts; with continueOnError false, stops at the first failure and
   * marks the rest skipped.
   */
  async bulkSetFieldValues(
    updates: Array<{ task_id: string; field_id: string; value: any }>,
    continueOnError?: boolean
  ): Promise<{ results: Array<{ task_id: string; field_id: string; status: string; error?: string }>; succeeded: number; failed: number; stopped_early?: boolean }> {
    const results: Array<{ task_id: string; field_id: string; status: string; error?: string }> = [];
    let succeeded = 0, failed = 0;
    for (let i = 0; i < updates.length; i++) {
      if (i > 0) await new Promise<void>(r => setTimeout(r, 150));
      const { task_id, field_id, value } = updates[i];
      try {
        await this.setTaskFieldValue(task_id, field_id, value);
        results.push({ task_id, field_id, status: 'set' });
        succeeded++;
      } catch (error: any) {
        results.push({ task_id, field_id, status: 'failed', error: error.message });
        failed++;
        if (!continueOnError) {
          for (let j = i + 1; j < updates.length; j++) {
            results.push({ task_id: updates[j].task_id, field_id: updates[j].field_id, status: 'skipped' });
          }
          return { results, succeeded, failed, stopped_early: true };
        }
      }
    }
    return { results, succeeded, failed };
  }
}

export const createCustomFieldsClient = (client: ClickUpClient): CustomFieldsClient =>
  new CustomFieldsClient(client);
