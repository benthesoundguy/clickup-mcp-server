export class CommentsClient {
    constructor(client) {
        this.client = client;
    }
    /**
     * Get comments for a specific task
     * @param taskId The ID of the task to get comments for
     * @param params Optional parameters for pagination
     * @returns A list of comments
     */
    async getTaskComments(taskId, params) {
        return this.client.get(`/task/${taskId}/comment`, params);
    }
    /**
     * Create a new comment on a task
     * @param taskId The ID of the task to comment on
     * @param params The comment parameters
     * @returns The created comment
     */
    async createTaskComment(taskId, params) {
        return this.client.post(`/task/${taskId}/comment`, params);
    }
    /**
     * Get comments for a chat view
     * @param viewId The ID of the chat view to get comments for
     * @param params Optional parameters for pagination
     * @returns A list of comments
     */
    async getChatViewComments(viewId, params) {
        return this.client.get(`/view/${viewId}/comment`, params);
    }
    /**
     * Create a new comment on a chat view
     * @param viewId The ID of the chat view to comment on
     * @param params The comment parameters
     * @returns The created comment
     */
    async createChatViewComment(viewId, params) {
        return this.client.post(`/view/${viewId}/comment`, params);
    }
    /**
     * Get comments for a list
     * @param listId The ID of the list to get comments for
     * @param params Optional parameters for pagination
     * @returns A list of comments
     */
    async getListComments(listId, params) {
        return this.client.get(`/list/${listId}/comment`, params);
    }
    /**
     * Create a new comment on a list
     * @param listId The ID of the list to comment on
     * @param params The comment parameters
     * @returns The created comment
     */
    async createListComment(listId, params) {
        return this.client.post(`/list/${listId}/comment`, params);
    }
    /**
     * Update an existing comment
     * @param commentId The ID of the comment to update
     * @param params The comment parameters to update
     * @returns The updated comment
     */
    async updateComment(commentId, params) {
        return this.client.put(`/comment/${commentId}`, params);
    }
    /**
     * Delete a comment
     * @param commentId The ID of the comment to delete
     * @returns Success message
     */
    async deleteComment(commentId) {
        return this.client.delete(`/comment/${commentId}`);
    }
    /**
     * Get threaded comments for a parent comment
     * @param commentId The ID of the parent comment
     * @param params Optional parameters for pagination
     * @returns A list of threaded comments
     */
    async getThreadedComments(commentId, params) {
        return this.client.get(`/comment/${commentId}/reply`, params);
    }
    /**
     * Create a new threaded comment on a parent comment
     * @param commentId The ID of the parent comment
     * @param params The comment parameters
     * @returns The created threaded comment
     */
    async createThreadedComment(commentId, params) {
        return this.client.post(`/comment/${commentId}/reply`, params);
    }
}
export const createCommentsClient = (client) => {
    return new CommentsClient(client);
};
//# sourceMappingURL=comments.js.map