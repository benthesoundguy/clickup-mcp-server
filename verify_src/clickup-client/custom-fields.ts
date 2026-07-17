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
}

export const createCustomFieldsClient = (client: ClickUpClient): CustomFieldsClient =>
  new CustomFieldsClient(client);
