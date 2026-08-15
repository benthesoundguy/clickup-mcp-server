import { ClickUpClient } from './index.js';

export function createAttachmentsClient(client: ClickUpClient) {
  return {
    /**
     * List a task's attachments. There is no GET /task/{id}/attachment route
     * (it 405s — verified live 2026-08-14); attachments come back on the task
     * object itself.
     */
    async getTaskAttachments(taskId: string): Promise<any> {
      const task = await client.get<any>(`/task/${taskId}`);
      return { attachments: task.attachments ?? [] };
    },

    /**
     * Attach a file identified by URL. ClickUp's attachment endpoint is
     * multipart-only and will not fetch a URL for you (JSON → ATTCH_045;
     * a URL in a multipart field → ATTCH_039), so download it here and
     * upload the bytes.
     */
    async createTaskAttachment(taskId: string, url: string, fileName?: string): Promise<any> {
      let res: Response;
      try {
        res = await fetch(url, { redirect: 'follow' });
      } catch (err: any) {
        throw new Error(`Could not fetch ${url}: ${err?.message ?? err}`);
      }
      if (!res.ok) throw new Error(`Could not fetch ${url}: HTTP ${res.status}`);
      const MAX_BYTES = 25 * 1024 * 1024;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) {
        throw new Error(`File at ${url} is ${Math.round(buf.length / 1048576)}MB; the limit is 25MB.`);
      }
      const derived = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
      const name = fileName ?? (derived || 'attachment');
      const formData = new FormData();
      formData.append('attachment', new Blob([new Uint8Array(buf)]), name);
      return client.upload(`/task/${taskId}/attachment`, formData);
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
