import { ClickUpClient } from './index.js';
import axios from 'axios';

export function createAttachmentsClient(client: ClickUpClient) {
  return {
    async getTaskAttachments(taskId: string): Promise<any> {
      return client.get(`/task/${taskId}/attachment`);
    },

    async createTaskAttachment(taskId: string, url: string, fileName?: string): Promise<any> {
      return client.post(`/task/${taskId}/attachment`, {
        attachment: url,
        file_name: fileName
      });
    },

    async uploadFile(taskId: string, fileData: string, fileName: string): Promise<any> {
      const apiToken = process.env.CLICKUP_API_TOKEN;
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const fileBuffer = Buffer.from(fileData, 'base64');
      
      const body = [
        `--${boundary}`,
        `Content-Disposition: form-data; name="attachment"; filename="${fileName}"`,
        'Content-Type: application/octet-stream',
        '',
        fileBuffer.toString('binary'),
        `--${boundary}--`,
        ''
      ].join('\r\n');

      const response = await axios.post(
        `https://api.clickup.com/api/v2/task/${taskId}/attachment`,
        body,
        {
          headers: {
            'Authorization': apiToken,
            'Content-Type': `multipart/form-data; boundary=${boundary}`
          }
        }
      );
      return response.data;
    }
  };
}
