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
export declare class ChatClient {
    private client;
    constructor(client: ClickUpClient);
    getChannels(workspaceId: string): Promise<any>;
    getChannel(channelId: string): Promise<any>;
    createChannel(workspaceId: string, request: CreateChannelRequest): Promise<any>;
    createDirectMessage(workspaceId: string, request: CreateDirectMessageRequest): Promise<any>;
    updateChannel(channelId: string, name?: string, description?: string): Promise<any>;
    deleteChannel(channelId: string): Promise<any>;
    searchChannels(workspaceId: string, query: string): Promise<any>;
    getChannelStats(channelId: string): Promise<any>;
    markChannelAsRead(channelId: string): Promise<any>;
    getChannelMembers(channelId: string): Promise<any>;
    getChannelFollowers(channelId: string): Promise<any>;
    addChannelMember(channelId: string, userId: number): Promise<any>;
    removeChannelMember(channelId: string, userId: number): Promise<any>;
    getChannelMessages(channelId: string, params?: GetChannelMessagesParams): Promise<any>;
    sendMessage(channelId: string, params: SendMessageParams): Promise<any>;
    updateMessage(messageId: string, content: string): Promise<any>;
    deleteMessage(messageId: string): Promise<any>;
    getMessageReplies(messageId: string, params?: GetMessageRepliesParams): Promise<any>;
    createReply(messageId: string, content: string): Promise<any>;
    getMessageReactions(channelId: string, messageId: string): Promise<any>;
    createMessageReaction(messageId: string, reaction: string): Promise<any>;
    deleteMessageReaction(messageId: string, reaction: string): Promise<any>;
    getTaggedUsers(channelId: string, messageId: string): Promise<any>;
    getUnreadCount(channelId: string): Promise<any>;
    searchMessages(workspaceId: string, query: string): Promise<any>;
}
export declare const createChatClient: (client: ClickUpClient) => ChatClient;
