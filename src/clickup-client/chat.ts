import { ClickUpClient } from './index.js';

export interface GetChannelMessagesParams {
  cursor?: string;
  limit?: number;
  content_format?: string;
}

export interface SendMessageParams {
  content: string;
  parent_message_id?: string;
  type?: string;
  content_format?: string;
  assignee?: string;
  group_assignee?: string;
  followers?: string[];
  post_title?: string;
  post_subtype_id?: string;
}

export interface GetMessageRepliesParams {
  cursor?: string;
  limit?: number;
  content_format?: string;
}

export interface CreateChannelRequest {
  name: string;
  type?: 'public' | 'private';
  team_member_ids?: number[];
  description?: string;
}

export interface CreateDirectMessageRequest {
  user_ids: number[];
  description?: string;
}

export class ChatClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  // --- Channel Management ---

  async getChannels(workspaceId: string): Promise<any> {
    return this.client.get(`/workspace/${workspaceId}/channel`);
  }

  async getChannel(channelId: string): Promise<any> {
    return this.client.get(`/channel/${channelId}`);
  }

  async createChannel(workspaceId: string, request: CreateChannelRequest): Promise<any> {
    return this.client.post(`/workspace/${workspaceId}/channel`, request);
  }

  async createDirectMessage(workspaceId: string, request: CreateDirectMessageRequest): Promise<any> {
    return this.client.post(`/workspace/${workspaceId}/channel`, {
      ...request,
      type: 'direct'
    });
  }

  async updateChannel(channelId: string, name?: string, description?: string): Promise<any> {
    const body: any = {};
    if (name !== undefined) body.name = name;
    if (description !== undefined) body.description = description;
    return this.client.put(`/channel/${channelId}`, body);
  }

  async deleteChannel(channelId: string): Promise<any> {
    return this.client.delete(`/channel/${channelId}`);
  }

  async searchChannels(workspaceId: string, query: string): Promise<any> {
    return this.client.get(`/workspace/${workspaceId}/channel`, { name: query });
  }

  async getChannelStats(channelId: string): Promise<any> {
    return this.client.get(`/channel/${channelId}`);
  }

  async markChannelAsRead(channelId: string): Promise<any> {
    return this.client.post(`/channel/${channelId}/read`, {});
  }

  // --- Channel Members ---

  async getChannelMembers(channelId: string): Promise<any> {
    return this.client.get(`/channel/${channelId}/member`);
  }

  async getChannelFollowers(channelId: string): Promise<any> {
    return this.client.get(`/channel/${channelId}/follower`);
  }

  async addChannelMember(channelId: string, userId: number): Promise<any> {
    return this.client.post(`/channel/${channelId}/member`, { user_id: userId });
  }

  async removeChannelMember(channelId: string, userId: number): Promise<any> {
    return this.client.delete(`/channel/${channelId}/member/${userId}`);
  }

  // --- Messages ---

  async getChannelMessages(channelId: string, params?: GetChannelMessagesParams): Promise<any> {
    return this.client.get(`/channel/${channelId}/message`, params);
  }

  async sendMessage(channelId: string, params: SendMessageParams): Promise<any> {
    return this.client.post(`/channel/${channelId}/message`, params);
  }

  async updateMessage(messageId: string, content: string): Promise<any> {
    return this.client.put(`/message/${messageId}`, { content });
  }

  async deleteMessage(messageId: string): Promise<any> {
    return this.client.delete(`/message/${messageId}`);
  }

  // --- Threaded Replies ---

  async getMessageReplies(messageId: string, params?: GetMessageRepliesParams): Promise<any> {
    return this.client.get(`/message/${messageId}/reply`, params);
  }

  async createReply(messageId: string, content: string): Promise<any> {
    return this.client.post(`/message/${messageId}/reply`, { content });
  }

  // --- Reactions ---

  async getMessageReactions(channelId: string, messageId: string): Promise<any> {
    return this.client.get(`/channel/${channelId}/message/${messageId}/reaction`);
  }

  async createMessageReaction(messageId: string, reaction: string): Promise<any> {
    return this.client.post(`/message/${messageId}/reaction`, { reaction });
  }

  async deleteMessageReaction(messageId: string, reaction: string): Promise<any> {
    return this.client.delete(`/message/${messageId}/reaction/${reaction}`);
  }

  // --- Extended ---

  async getTaggedUsers(channelId: string, messageId: string): Promise<any> {
    return this.client.get(`/channel/${channelId}/message/${messageId}/tagged`);
  }

  async getUnreadCount(channelId: string): Promise<any> {
    return this.client.get(`/channel/${channelId}/unread`);
  }

  async searchMessages(workspaceId: string, query: string): Promise<any> {
    return this.client.post(`/workspace/${workspaceId}/message/search`, { query });
  }
}

export const createChatClient = (client: ClickUpClient): ChatClient =>
  new ChatClient(client);
