import { ClickUpClient } from './index.js';
export declare function createAttachmentsClient(client: ClickUpClient): {
    getTaskAttachments(taskId: string): Promise<any>;
    createTaskAttachment(taskId: string, url: string, fileName?: string): Promise<any>;
    uploadFile(taskId: string, fileData: string, fileName: string): Promise<any>;
};
