import { ClickUpClient } from './index.js';

export class TagsClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  /** Get all tags in a space. */
  async getSpaceTags(spaceId: string): Promise<any> {
    const res = await this.client.get<any>(`/space/${spaceId}/tag`);
    return res.tags;
  }

  /** Create a new tag in a space. Body must be wrapped in `{ tag: { ... } }`. */
  async createSpaceTag(spaceId: string, name: string, tagBg?: string, tagFg?: string): Promise<void> {
    const body: any = { tag: { name } };
    if (tagBg) body.tag.tag_bg = tagBg;
    if (tagFg) body.tag.tag_fg = tagFg;
    await this.client.post(`/space/${spaceId}/tag`, body);
  }

  /** Edit an existing space tag. */
  async editSpaceTag(spaceId: string, tagName: string, name?: string, tagBg?: string, tagFg?: string): Promise<void> {
    const body: any = { tag: {} };
    if (name) body.tag.name = name;
    if (tagBg) body.tag.tag_bg = tagBg;
    if (tagFg) body.tag.tag_fg = tagFg;
    await this.client.put(`/space/${spaceId}/tag/${encodeURIComponent(tagName)}`, body);
  }

  /** Delete a tag from a space. */
  async deleteSpaceTag(spaceId: string, tagName: string): Promise<void> {
    await this.client.delete(`/space/${spaceId}/tag/${encodeURIComponent(tagName)}`);
  }

  /** Add a tag to a task. */
  async addTagToTask(taskId: string, tagName: string): Promise<void> {
    await this.client.post(`/task/${taskId}/tag/${encodeURIComponent(tagName)}`);
  }

  /** Remove a tag from a task. */
  async removeTagFromTask(taskId: string, tagName: string): Promise<void> {
    await this.client.delete(`/task/${taskId}/tag/${encodeURIComponent(tagName)}`);
  }
}

export const createTagsClient = (client: ClickUpClient): TagsClient =>
  new TagsClient(client);
