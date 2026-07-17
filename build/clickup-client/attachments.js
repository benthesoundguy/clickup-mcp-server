import axios from 'axios';
export function createAttachmentsClient(client) {
    return {
        async getTaskAttachments(taskId) {
            return client.get(`/task/${taskId}/attachment`);
        },
        async createTaskAttachment(taskId, url, fileName) {
            return client.post(`/task/${taskId}/attachment`, {
                attachment: url,
                file_name: fileName
            });
        },
        async uploadFile(taskId, fileData, fileName) {
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
            const response = await axios.post(`https://api.clickup.com/api/v2/task/${taskId}/attachment`, body, {
                headers: {
                    'Authorization': apiToken,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`
                }
            });
            return response.data;
        }
    };
}
//# sourceMappingURL=attachments.js.map