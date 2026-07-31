import { ClickUpClient } from './index.js';

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

    /**
     * Upload a file as a task attachment.
     * @param fileData Base64-encoded file contents
     * @param fileName Name for the uploaded file
     */
    async uploadFile(taskId: string, fileData: string, fileName: string): Promise<any> {
      const fileBuffer = Buffer.from(fileData, 'base64');
      const formData = new FormData();
      // Blob keeps binary data intact; fetch sets the multipart boundary itself.
      formData.append('attachment', new Blob([new Uint8Array(fileBuffer)]), fileName);
      return client.upload(`/task/${taskId}/attachment`, formData);
    }
  };
}
