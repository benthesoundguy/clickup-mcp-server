import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createChatClient } from '../clickup-client/chat.js';
const clickUpClient = createClickUpClient();
const chatClient = createChatClient(clickUpClient);
export function setupChatTools(server) {
    // ── Tool 1: channels ──────────────────────────────────────────────────
    server.tool('channels', 'Manage ClickUp chat channels. Use action to list, get, create, update, delete, create DM, search, view stats, or mark as read.', {
        action: z.enum(['list', 'get', 'create', 'update', 'delete', 'dm', 'search', 'stats', 'mark_read'])
            .describe('Action to perform'),
        workspace_id: z.string().optional().describe('Required for list, create, dm, search'),
        channel_id: z.string().optional().describe('Required for get, update, delete, stats, mark_read'),
        name: z.string().optional().describe('Channel name (create, update, search)'),
        description: z.string().optional().describe('Channel description (create, update, dm)'),
        type: z.enum(['public', 'private']).optional().describe('Channel type (create)'),
        user_ids: z.array(z.number()).optional().describe('User IDs for DM channel (dm)'),
        team_member_ids: z.array(z.number()).optional().describe('Member IDs to add (create)'),
    }, async ({ action, workspace_id, channel_id, name, description, type, user_ids, team_member_ids }) => {
        try {
            switch (action) {
                case 'list': {
                    if (!workspace_id)
                        throw new Error('workspace_id required for list');
                    const result = await chatClient.getChannels(workspace_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'get': {
                    if (!channel_id)
                        throw new Error('channel_id required for get');
                    const result = await chatClient.getChannel(channel_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'create': {
                    if (!workspace_id || !name)
                        throw new Error('workspace_id and name required for create');
                    const result = await chatClient.createChannel(workspace_id, { name, type, team_member_ids, description });
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'update': {
                    if (!channel_id)
                        throw new Error('channel_id required for update');
                    const result = await chatClient.updateChannel(channel_id, name, description);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'delete': {
                    if (!channel_id)
                        throw new Error('channel_id required for delete');
                    await chatClient.deleteChannel(channel_id);
                    return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
                }
                case 'dm': {
                    if (!workspace_id || !user_ids?.length)
                        throw new Error('workspace_id and user_ids required for dm');
                    const result = await chatClient.createDirectMessage(workspace_id, { user_ids, description });
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'search': {
                    if (!workspace_id || !name)
                        throw new Error('workspace_id and name (query) required for search');
                    const result = await chatClient.searchChannels(workspace_id, name);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'stats': {
                    if (!channel_id)
                        throw new Error('channel_id required for stats');
                    const result = await chatClient.getChannelStats(channel_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'mark_read': {
                    if (!channel_id)
                        throw new Error('channel_id required for mark_read');
                    await chatClient.markChannelAsRead(channel_id);
                    return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
                }
            }
        }
        catch (error) {
            console.error('[ChatTools] Error:', error);
            return { content: [{ type: 'text', text: `Error with channels: ${error.message}` }], isError: true };
        }
    });
    // ── Tool 2: channels_members ─────────────────────────────────────────
    server.tool('channels_members', 'Manage members of a ClickUp chat channel. Use action to list members, list followers, add, or remove.', {
        action: z.enum(['list', 'followers', 'add', 'remove']).describe('Action to perform'),
        channel_id: z.string().describe('The ID of the channel'),
        user_id: z.number().optional().describe('Required for add/remove: the user ID'),
    }, async ({ action, channel_id, user_id }) => {
        try {
            switch (action) {
                case 'list': {
                    const result = await chatClient.getChannelMembers(channel_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'followers': {
                    const result = await chatClient.getChannelFollowers(channel_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'add': {
                    if (!user_id)
                        throw new Error('user_id required for add');
                    await chatClient.addChannelMember(channel_id, user_id);
                    return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
                }
                case 'remove': {
                    if (!user_id)
                        throw new Error('user_id required for remove');
                    await chatClient.removeChannelMember(channel_id, user_id);
                    return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
                }
            }
        }
        catch (error) {
            console.error('[ChatTools] Error:', error);
            return { content: [{ type: 'text', text: `Error with channel members: ${error.message}` }], isError: true };
        }
    });
    // ── Tool 3: channels_messages ────────────────────────────────────────
    server.tool('channels_messages', 'Manage messages in a ClickUp chat channel. Use action to list, send, update, delete, manage replies, reactions, tagged users, unread count, or search messages.', {
        action: z.enum([
            'list', 'send', 'update', 'delete',
            'replies_list', 'replies_create',
            'reactions_list', 'reactions_create', 'reactions_delete',
            'tagged_users', 'unread', 'search'
        ]).describe('Action to perform'),
        channel_id: z.string().optional().describe('Required for list, send, reactions, tagged, unread, search'),
        message_id: z.string().optional().describe('Required for update, delete, replies, reactions'),
        workspace_id: z.string().optional().describe('Required for search'),
        content: z.string().optional().describe('Message content (send, update, replies_create)'),
        reaction: z.string().optional().describe('Reaction emoji/text (reactions_create, reactions_delete)'),
        query: z.string().optional().describe('Search query (search)'),
        parent_message_id: z.string().optional().describe('Parent message for threaded reply (send)'),
        cursor: z.string().optional().describe('Pagination cursor (list, replies_list)'),
        limit: z.number().optional().describe('Max results (list, replies_list)'),
        content_format: z.enum(['text/md', 'text/plain']).optional().describe('Content format (list, replies_list)'),
    }, async ({ action, channel_id, message_id, workspace_id, content, reaction, query, parent_message_id, cursor, limit, content_format }) => {
        try {
            switch (action) {
                case 'list': {
                    if (!channel_id)
                        throw new Error('channel_id required for list');
                    const result = await chatClient.getChannelMessages(channel_id, { cursor, limit, content_format });
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'send': {
                    if (!channel_id || !content)
                        throw new Error('channel_id and content required for send');
                    const result = await chatClient.sendMessage(channel_id, { content, parent_message_id, content_format });
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'update': {
                    if (!message_id || !content)
                        throw new Error('message_id and content required for update');
                    const result = await chatClient.updateMessage(message_id, content);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'delete': {
                    if (!message_id)
                        throw new Error('message_id required for delete');
                    await chatClient.deleteMessage(message_id);
                    return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
                }
                case 'replies_list': {
                    if (!message_id)
                        throw new Error('message_id required for replies_list');
                    const result = await chatClient.getMessageReplies(message_id, { cursor, limit, content_format });
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'replies_create': {
                    if (!message_id || !content)
                        throw new Error('message_id and content required for replies_create');
                    const result = await chatClient.createReply(message_id, content);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'reactions_list': {
                    if (!channel_id || !message_id)
                        throw new Error('channel_id and message_id required for reactions_list');
                    const result = await chatClient.getMessageReactions(channel_id, message_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'reactions_create': {
                    if (!message_id || !reaction)
                        throw new Error('message_id and reaction required for reactions_create');
                    await chatClient.createMessageReaction(message_id, reaction);
                    return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
                }
                case 'reactions_delete': {
                    if (!message_id || !reaction)
                        throw new Error('message_id and reaction required for reactions_delete');
                    await chatClient.deleteMessageReaction(message_id, reaction);
                    return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
                }
                case 'tagged_users': {
                    if (!channel_id || !message_id)
                        throw new Error('channel_id and message_id required for tagged_users');
                    const result = await chatClient.getTaggedUsers(channel_id, message_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'unread': {
                    if (!channel_id)
                        throw new Error('channel_id required for unread');
                    const result = await chatClient.getUnreadCount(channel_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'search': {
                    if (!workspace_id || !query)
                        throw new Error('workspace_id and query required for search');
                    const result = await chatClient.searchMessages(workspace_id, query);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
            }
        }
        catch (error) {
            console.error('[ChatTools] Error:', error);
            return { content: [{ type: 'text', text: `Error with channel messages: ${error.message}` }], isError: true };
        }
    });
}
//# sourceMappingURL=chat-tools.js.map