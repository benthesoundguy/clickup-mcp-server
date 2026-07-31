import { ClickUpClient } from './index.js';

// ClickUp Chat API v3 client.
// Every route lives under /api/v3/workspaces/{workspace_id}/chat/...
// (verified live 2026-07-31 — the previous v2-shaped /workspace/{id}/channel
// paths do not exist). All operations therefore require a workspace_id.

export interface GetChannelsParams {
  cursor?: string;
  limit?: number;
  description_format?: string;   // text/md or text/plain
  is_follower?: boolean;
  include_hidden?: boolean;
  room_types?: string[];         // e.g. CHANNEL, DM, GROUP_DM
}

export interface CreateChannelRequest {
  name: string;
  description?: string;
  topic?: string;
  user_ids?: string[];
  visibility?: 'PUBLIC' | 'PRIVATE';
}

export interface UpdateChannelRequest {
  name?: string;
  description?: string;
  topic?: string;
  visibility?: 'PUBLIC' | 'PRIVATE';
  content_format?: string;
  archived?: boolean;
}

export interface GetMessagesParams {
  cursor?: string;
  limit?: number;
  content_format?: string;
}

export interface SendMessageRequest {
  content: string;
  content_format?: string;       // text/md (default) or text/plain
  type?: string;                 // "message" (default)
  post_data?: { title?: string; subtype?: { id: string } };
}

export class ChatClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  private chatPath(workspaceId: string, rest: string): string {
    return `/workspaces/${workspaceId}/chat${rest}`;
  }

  // ── Channels ─────────────────────────────────────────────────────────

  async getChannels(workspaceId: string, params?: GetChannelsParams): Promise<any> {
    return this.client.get(this.chatPath(workspaceId, '/channels'), params, { api: 'v3' });
  }

  async getChannel(workspaceId: string, channelId: string): Promise<any> {
    return this.client.get(this.chatPath(workspaceId, `/channels/${channelId}`), undefined, { api: 'v3' });
  }

  async createChannel(workspaceId: string, request: CreateChannelRequest): Promise<any> {
    return this.client.post(this.chatPath(workspaceId, '/channels'), request, { api: 'v3' });
  }

  /** Create (or fetch existing) direct message between the authorized user and the given users. */
  async createDirectMessage(workspaceId: string, userIds: string[]): Promise<any> {
    return this.client.post(this.chatPath(workspaceId, '/channels/direct_message'), { user_ids: userIds }, { api: 'v3' });
  }

  async updateChannel(workspaceId: string, channelId: string, changes: UpdateChannelRequest): Promise<any> {
    return this.client.patch(this.chatPath(workspaceId, `/channels/${channelId}`), changes, { api: 'v3' });
  }

  async deleteChannel(workspaceId: string, channelId: string): Promise<any> {
    return this.client.delete(this.chatPath(workspaceId, `/channels/${channelId}`), { api: 'v3' });
  }

  // ── Channel people ───────────────────────────────────────────────────

  async getChannelMembers(workspaceId: string, channelId: string, params?: { cursor?: string; limit?: number }): Promise<any> {
    return this.client.get(this.chatPath(workspaceId, `/channels/${channelId}/members`), params, { api: 'v3' });
  }

  async getChannelFollowers(workspaceId: string, channelId: string, params?: { cursor?: string; limit?: number }): Promise<any> {
    return this.client.get(this.chatPath(workspaceId, `/channels/${channelId}/followers`), params, { api: 'v3' });
  }

  // ── Messages ─────────────────────────────────────────────────────────

  async getChannelMessages(workspaceId: string, channelId: string, params?: GetMessagesParams): Promise<any> {
    return this.client.get(this.chatPath(workspaceId, `/channels/${channelId}/messages`), params, { api: 'v3' });
  }

  async sendMessage(workspaceId: string, channelId: string, message: SendMessageRequest): Promise<any> {
    return this.client.post(
      this.chatPath(workspaceId, `/channels/${channelId}/messages`),
      { type: 'message', ...message },
      { api: 'v3' }
    );
  }

  async updateMessage(workspaceId: string, messageId: string, content: string, contentFormat?: string): Promise<any> {
    const body: Record<string, unknown> = { content };
    if (contentFormat) body.content_format = contentFormat;
    return this.client.patch(this.chatPath(workspaceId, `/messages/${messageId}`), body, { api: 'v3' });
  }

  async deleteMessage(workspaceId: string, messageId: string): Promise<any> {
    return this.client.delete(this.chatPath(workspaceId, `/messages/${messageId}`), { api: 'v3' });
  }

  // ── Replies ──────────────────────────────────────────────────────────

  async getMessageReplies(workspaceId: string, messageId: string, params?: GetMessagesParams): Promise<any> {
    return this.client.get(this.chatPath(workspaceId, `/messages/${messageId}/replies`), params, { api: 'v3' });
  }

  async createReply(workspaceId: string, messageId: string, message: SendMessageRequest): Promise<any> {
    return this.client.post(
      this.chatPath(workspaceId, `/messages/${messageId}/replies`),
      { type: 'message', ...message },
      { api: 'v3' }
    );
  }

  // ── Reactions & mentions ─────────────────────────────────────────────

  async getMessageReactions(workspaceId: string, messageId: string, params?: { cursor?: string; limit?: number }): Promise<any> {
    return this.client.get(this.chatPath(workspaceId, `/messages/${messageId}/reactions`), params, { api: 'v3' });
  }

  async createMessageReaction(workspaceId: string, messageId: string, reaction: string): Promise<any> {
    return this.client.post(this.chatPath(workspaceId, `/messages/${messageId}/reactions`), { reaction }, { api: 'v3' });
  }

  async deleteMessageReaction(workspaceId: string, messageId: string, reaction: string): Promise<any> {
    return this.client.delete(this.chatPath(workspaceId, `/messages/${messageId}/reactions/${encodeURIComponent(reaction)}`), { api: 'v3' });
  }

  async getTaggedUsers(workspaceId: string, messageId: string): Promise<any> {
    return this.client.get(this.chatPath(workspaceId, `/messages/${messageId}/tagged_users`), undefined, { api: 'v3' });
  }
}

export const createChatClient = (client: ClickUpClient): ChatClient => {
  return new ChatClient(client);
};
