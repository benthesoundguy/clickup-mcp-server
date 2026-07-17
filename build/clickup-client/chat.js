export class ChatClient {
    constructor(client) {
        this.client = client;
    }
    // --- Channel Management ---
    async getChannels(workspaceId) {
        return this.client.get(`/workspace/${workspaceId}/channel`);
    }
    async getChannel(channelId) {
        return this.client.get(`/channel/${channelId}`);
    }
    async createChannel(workspaceId, request) {
        return this.client.post(`/workspace/${workspaceId}/channel`, request);
    }
    async createDirectMessage(workspaceId, request) {
        return this.client.post(`/workspace/${workspaceId}/channel`, {
            ...request,
            type: 'direct'
        });
    }
    async updateChannel(channelId, name, description) {
        const body = {};
        if (name !== undefined)
            body.name = name;
        if (description !== undefined)
            body.description = description;
        return this.client.put(`/channel/${channelId}`, body);
    }
    async deleteChannel(channelId) {
        return this.client.delete(`/channel/${channelId}`);
    }
    async searchChannels(workspaceId, query) {
        return this.client.get(`/workspace/${workspaceId}/channel`, { name: query });
    }
    async getChannelStats(channelId) {
        return this.client.get(`/channel/${channelId}`);
    }
    async markChannelAsRead(channelId) {
        return this.client.post(`/channel/${channelId}/read`, {});
    }
    // --- Channel Members ---
    async getChannelMembers(channelId) {
        return this.client.get(`/channel/${channelId}/member`);
    }
    async getChannelFollowers(channelId) {
        return this.client.get(`/channel/${channelId}/follower`);
    }
    async addChannelMember(channelId, userId) {
        return this.client.post(`/channel/${channelId}/member`, { user_id: userId });
    }
    async removeChannelMember(channelId, userId) {
        return this.client.delete(`/channel/${channelId}/member/${userId}`);
    }
    // --- Messages ---
    async getChannelMessages(channelId, params) {
        return this.client.get(`/channel/${channelId}/message`, params);
    }
    async sendMessage(channelId, params) {
        return this.client.post(`/channel/${channelId}/message`, params);
    }
    async updateMessage(messageId, content) {
        return this.client.put(`/message/${messageId}`, { content });
    }
    async deleteMessage(messageId) {
        return this.client.delete(`/message/${messageId}`);
    }
    // --- Threaded Replies ---
    async getMessageReplies(messageId, params) {
        return this.client.get(`/message/${messageId}/reply`, params);
    }
    async createReply(messageId, content) {
        return this.client.post(`/message/${messageId}/reply`, { content });
    }
    // --- Reactions ---
    async getMessageReactions(channelId, messageId) {
        return this.client.get(`/channel/${channelId}/message/${messageId}/reaction`);
    }
    async createMessageReaction(messageId, reaction) {
        return this.client.post(`/message/${messageId}/reaction`, { reaction });
    }
    async deleteMessageReaction(messageId, reaction) {
        return this.client.delete(`/message/${messageId}/reaction/${reaction}`);
    }
    // --- Extended ---
    async getTaggedUsers(channelId, messageId) {
        return this.client.get(`/channel/${channelId}/message/${messageId}/tagged`);
    }
    async getUnreadCount(channelId) {
        return this.client.get(`/channel/${channelId}/unread`);
    }
    async searchMessages(workspaceId, query) {
        return this.client.post(`/workspace/${workspaceId}/message/search`, { query });
    }
}
export const createChatClient = (client) => new ChatClient(client);
//# sourceMappingURL=chat.js.map