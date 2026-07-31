import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createChatClient } from '../clickup-client/chat.js';

const clickUpClient = createClickUpClient();
const chatClient = createChatClient(clickUpClient);

// ClickUp Chat lives on the v3 API; every operation is scoped to a workspace,
// so workspace_id is required throughout.

export function setupChatTools(server: McpServer): void {
  // ── Tool 1: channels ──────────────────────────────────────────────────
  server.tool(
    'channels',
    'Manage ClickUp chat channels (v3 API). Use action to list, get, create, update, delete a channel, or create/open a direct message.',
    {
      action: z.enum(['list', 'get', 'create', 'update', 'delete', 'dm'])
        .describe('Action to perform'),
      workspace_id: z.string().describe('The workspace ID (required for all actions)'),
      channel_id: z.string().optional().describe('Required for get, update, delete'),
      name: z.string().optional().describe('Channel name (required for create; optional for update)'),
      description: z.string().optional().describe('Channel description (create, update)'),
      topic: z.string().optional().describe('Channel topic (create, update)'),
      visibility: z.enum(['PUBLIC', 'PRIVATE']).optional().describe('Channel visibility (create, update)'),
      archived: z.boolean().optional().describe('Archive/unarchive the channel (update)'),
      user_ids: z.array(z.string()).optional().describe('User IDs: members to invite (create) or DM participants, 1-10 (dm)'),
      cursor: z.string().optional().describe('Pagination cursor (list)'),
      limit: z.number().optional().describe('Max results per page (list)'),
    },
    async ({ action, workspace_id, channel_id, name, description, topic, visibility, archived, user_ids, cursor, limit }) => {
      try {
        switch (action) {
          case 'list': {
            const result = await chatClient.getChannels(workspace_id, { cursor, limit });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'get': {
            if (!channel_id) throw new Error('channel_id required for get');
            const result = await chatClient.getChannel(workspace_id, channel_id);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'create': {
            if (!name) throw new Error('name required for create');
            const result = await chatClient.createChannel(workspace_id, { name, description, topic, visibility, user_ids });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'update': {
            if (!channel_id) throw new Error('channel_id required for update');
            const result = await chatClient.updateChannel(workspace_id, channel_id, { name, description, topic, visibility, archived });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'delete': {
            if (!channel_id) throw new Error('channel_id required for delete');
            await chatClient.deleteChannel(workspace_id, channel_id);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
          }
          case 'dm': {
            if (!user_ids?.length) throw new Error('user_ids required for dm');
            const result = await chatClient.createDirectMessage(workspace_id, user_ids);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
        }
      } catch (error: any) {
        console.error('[ChatTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with channels: ${error.message}` }], isError: true };
      }
    }
  );

  // ── Tool 2: channels_messages ─────────────────────────────────────────
  server.tool(
    'channels_messages',
    'Work with ClickUp chat messages (v3 API). Use action to list channel messages, send, update, delete, '
    + 'list/create replies, list/create/delete reactions, or get tagged users.',
    {
      action: z.enum([
        'list', 'send', 'update', 'delete',
        'replies_list', 'replies_create',
        'reactions_list', 'reactions_create', 'reactions_delete',
        'tagged_users'
      ]).describe('Action to perform'),
      workspace_id: z.string().describe('The workspace ID (required for all actions)'),
      channel_id: z.string().optional().describe('Required for list, send'),
      message_id: z.string().optional().describe('Required for update, delete, replies_*, reactions_*, tagged_users'),
      content: z.string().optional().describe('Message text (required for send, update, replies_create)'),
      content_format: z.enum(['text/md', 'text/plain']).optional().describe('Content format (default text/md)'),
      reaction: z.string().optional().describe('Reaction emoji name (required for reactions_create, reactions_delete)'),
      cursor: z.string().optional().describe('Pagination cursor (list-style actions)'),
      limit: z.number().optional().describe('Max results per page (list-style actions)'),
    },
    async ({ action, workspace_id, channel_id, message_id, content, content_format, reaction, cursor, limit }) => {
      try {
        switch (action) {
          case 'list': {
            if (!channel_id) throw new Error('channel_id required for list');
            const result = await chatClient.getChannelMessages(workspace_id, channel_id, { cursor, limit, content_format });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'send': {
            if (!channel_id || !content) throw new Error('channel_id and content required for send');
            const result = await chatClient.sendMessage(workspace_id, channel_id, { content, content_format });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'update': {
            if (!message_id || !content) throw new Error('message_id and content required for update');
            const result = await chatClient.updateMessage(workspace_id, message_id, content, content_format);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'delete': {
            if (!message_id) throw new Error('message_id required for delete');
            await chatClient.deleteMessage(workspace_id, message_id);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
          }
          case 'replies_list': {
            if (!message_id) throw new Error('message_id required for replies_list');
            const result = await chatClient.getMessageReplies(workspace_id, message_id, { cursor, limit, content_format });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'replies_create': {
            if (!message_id || !content) throw new Error('message_id and content required for replies_create');
            const result = await chatClient.createReply(workspace_id, message_id, { content, content_format });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'reactions_list': {
            if (!message_id) throw new Error('message_id required for reactions_list');
            const result = await chatClient.getMessageReactions(workspace_id, message_id, { cursor, limit });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'reactions_create': {
            if (!message_id || !reaction) throw new Error('message_id and reaction required for reactions_create');
            const result = await chatClient.createMessageReaction(workspace_id, message_id, reaction);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'reactions_delete': {
            if (!message_id || !reaction) throw new Error('message_id and reaction required for reactions_delete');
            await chatClient.deleteMessageReaction(workspace_id, message_id, reaction);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
          }
          case 'tagged_users': {
            if (!message_id) throw new Error('message_id required for tagged_users');
            const result = await chatClient.getTaggedUsers(workspace_id, message_id);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
        }
      } catch (error: any) {
        console.error('[ChatTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with messages: ${error.message}` }], isError: true };
      }
    }
  );

  // ── Tool 3: channels_members ──────────────────────────────────────────
  server.tool(
    'channels_members',
    'List the members or followers of a ClickUp chat channel (v3 API).',
    {
      action: z.enum(['list', 'followers']).describe('list = channel members; followers = channel followers'),
      workspace_id: z.string().describe('The workspace ID'),
      channel_id: z.string().describe('The channel ID'),
      cursor: z.string().optional().describe('Pagination cursor'),
      limit: z.number().optional().describe('Max results per page'),
    },
    async ({ action, workspace_id, channel_id, cursor, limit }) => {
      try {
        const result = action === 'list'
          ? await chatClient.getChannelMembers(workspace_id, channel_id, { cursor, limit })
          : await chatClient.getChannelFollowers(workspace_id, channel_id, { cursor, limit });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error: any) {
        console.error('[ChatTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with channel members: ${error.message}` }], isError: true };
      }
    }
  );
}
