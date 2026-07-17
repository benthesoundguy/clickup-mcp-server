import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createAttachmentsClient } from '../clickup-client/attachments.js';

const clickUpClient = createClickUpClient();
const attachmentsClient = createAttachmentsClient(clickUpClient);

export function setupAttachmentTools(server: McpServer): void {
  server.tool(
    'attachments',
    'Manage attachments on ClickUp tasks. Use "list" to see existing attachments, "create" to attach by URL, or "upload" to upload a file (base64-encoded).',
    {
      action: z.enum(['list', 'create', 'upload']).describe('Action to perform'),
      task_id: z.string().describe('The ID of the task'),
      url: z.string().optional().describe('Required for create: the public URL of the file to attach'),
      file_name: z.string().optional().describe('Display name for the file (create/upload)'),
      file_data: z.string().optional().describe('Required for upload: base64-encoded file content')
    },
    async ({ action, task_id, url, file_name, file_data }) => {
      try {
        switch (action) {
          case 'list': {
            const result = await attachmentsClient.getTaskAttachments(task_id);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'create': {
            if (!url) throw new Error('url is required for create action');
            const result = await attachmentsClient.createTaskAttachment(task_id, url, file_name);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case 'upload': {
            if (!file_data || !file_name) throw new Error('file_data and file_name are required for upload');
            const result = await attachmentsClient.uploadFile(task_id, file_data, file_name);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
        }
      } catch (error: any) {
        console.error('[AttachmentTools] Error:', error);
        return { content: [{ type: 'text', text: `Error with attachments: ${error.message}` }], isError: true };
      }
    }
  );
}
