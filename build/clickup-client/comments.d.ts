import { ClickUpClient } from './index.js';
export interface Comment {
    id: string;
    comment: string[];
    comment_text: string;
    user: {
        id: number;
        username: string;
        email: string;
        color: string;
        profilePicture?: string;
    };
    resolved: boolean;
    assignee?: {
        id: number;
        username: string;
        email: string;
        color: string;
        profilePicture?: string;
    };
    assigned_by?: {
        id: number;
        username: string;
        email: string;
        color: string;
        profilePicture?: string;
    };
    reactions?: {
        [key: string]: {
            count: number;
            users: Array<{
                id: number;
                username: string;
                email: string;
            }>;
        };
    };
    date: string;
    start_date?: string;
    due_date?: string;
    parent?: string;
    replies_count?: number;
}
export interface GetTaskCommentsParams {
    start?: number;
    start_id?: string;
}
export interface CreateTaskCommentParams {
    comment_text: string;
    assignee?: number;
    notify_all?: boolean;
}
export interface GetChatViewCommentsParams {
    start?: number;
    start_id?: string;
}
export interface CreateChatViewCommentParams {
    comment_text: string;
    notify_all?: boolean;
}
export interface GetListCommentsParams {
    start?: number;
    start_id?: string;
}
export interface CreateListCommentParams {
    comment_text: string;
    assignee?: number;
    notify_all?: boolean;
}
export interface UpdateCommentParams {
    comment_text: string;
    assignee?: number;
    resolved?: boolean;
}
export interface GetThreadedCommentsParams {
    start?: number;
    start_id?: string;
}
export interface CreateThreadedCommentParams {
    comment_text: string;
    notify_all?: boolean;
}
export declare class CommentsClient {
    private client;
    constructor(client: ClickUpClient);
    /**
     * Get comments for a specific task
     * @param taskId The ID of the task to get comments for
     * @param params Optional parameters for pagination
     * @returns A list of comments
     */
    getTaskComments(taskId: string, params?: GetTaskCommentsParams): Promise<{
        comments: Comment[];
    }>;
    /**
     * Create a new comment on a task
     * @param taskId The ID of the task to comment on
     * @param params The comment parameters
     * @returns The created comment
     */
    createTaskComment(taskId: string, params: CreateTaskCommentParams): Promise<Comment>;
    /**
     * Get comments for a chat view
     * @param viewId The ID of the chat view to get comments for
     * @param params Optional parameters for pagination
     * @returns A list of comments
     */
    getChatViewComments(viewId: string, params?: GetChatViewCommentsParams): Promise<{
        comments: Comment[];
    }>;
    /**
     * Create a new comment on a chat view
     * @param viewId The ID of the chat view to comment on
     * @param params The comment parameters
     * @returns The created comment
     */
    createChatViewComment(viewId: string, params: CreateChatViewCommentParams): Promise<Comment>;
    /**
     * Get comments for a list
     * @param listId The ID of the list to get comments for
     * @param params Optional parameters for pagination
     * @returns A list of comments
     */
    getListComments(listId: string, params?: GetListCommentsParams): Promise<{
        comments: Comment[];
    }>;
    /**
     * Create a new comment on a list
     * @param listId The ID of the list to comment on
     * @param params The comment parameters
     * @returns The created comment
     */
    createListComment(listId: string, params: CreateListCommentParams): Promise<Comment>;
    /**
     * Update an existing comment
     * @param commentId The ID of the comment to update
     * @param params The comment parameters to update
     * @returns The updated comment
     */
    updateComment(commentId: string, params: UpdateCommentParams): Promise<Comment>;
    /**
     * Delete a comment
     * @param commentId The ID of the comment to delete
     * @returns Success message
     */
    deleteComment(commentId: string): Promise<{
        success: boolean;
    }>;
    /**
     * Get threaded comments for a parent comment
     * @param commentId The ID of the parent comment
     * @param params Optional parameters for pagination
     * @returns A list of threaded comments
     */
    getThreadedComments(commentId: string, params?: GetThreadedCommentsParams): Promise<{
        comments: Comment[];
    }>;
    /**
     * Create a new threaded comment on a parent comment
     * @param commentId The ID of the parent comment
     * @param params The comment parameters
     * @returns The created threaded comment
     */
    createThreadedComment(commentId: string, params: CreateThreadedCommentParams): Promise<Comment>;
}
export declare const createCommentsClient: (client: ClickUpClient) => CommentsClient;
