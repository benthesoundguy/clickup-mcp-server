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

export class CommentsClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  /**
   * Get comments for a specific task
   * @param taskId The ID of the task to get comments for
   * @param params Optional parameters for pagination
   * @returns A list of comments
   */
  async getTaskComments(taskId: string, params?: GetTaskCommentsParams): Promise<{ comments: Comment[] }> {
    return this.client.get(`/task/${taskId}/comment`, params);
  }

  /**
   * Create a new comment on a task
   * @param taskId The ID of the task to comment on
   * @param params The comment parameters
   * @returns The created comment
   */
  async createTaskComment(taskId: string, params: CreateTaskCommentParams): Promise<Comment> {
    return this.client.post(`/task/${taskId}/comment`, params);
  }

  /**
   * Get comments for a chat view
   * @param viewId The ID of the chat view to get comments for
   * @param params Optional parameters for pagination
   * @returns A list of comments
   */
  async getChatViewComments(viewId: string, params?: GetChatViewCommentsParams): Promise<{ comments: Comment[] }> {
    return this.client.get(`/view/${viewId}/comment`, params);
  }

  /**
   * Create a new comment on a chat view
   * @param viewId The ID of the chat view to comment on
   * @param params The comment parameters
   * @returns The created comment
   */
  async createChatViewComment(viewId: string, params: CreateChatViewCommentParams): Promise<Comment> {
    return this.client.post(`/view/${viewId}/comment`, params);
  }

  /**
   * Get comments for a list
   * @param listId The ID of the list to get comments for
   * @param params Optional parameters for pagination
   * @returns A list of comments
   */
  async getListComments(listId: string, params?: GetListCommentsParams): Promise<{ comments: Comment[] }> {
    return this.client.get(`/list/${listId}/comment`, params);
  }

  /**
   * Create a new comment on a list
   * @param listId The ID of the list to comment on
   * @param params The comment parameters
   * @returns The created comment
   */
  async createListComment(listId: string, params: CreateListCommentParams): Promise<Comment> {
    return this.client.post(`/list/${listId}/comment`, params);
  }

  /**
   * Update an existing comment
   * @param commentId The ID of the comment to update
   * @param params The comment parameters to update
   * @returns The updated comment
   */
  async updateComment(commentId: string, params: UpdateCommentParams): Promise<Comment> {
    return this.client.put(`/comment/${commentId}`, params);
  }

  /**
   * Delete a comment
   * @param commentId The ID of the comment to delete
   * @returns Success message
   */
  async deleteComment(commentId: string): Promise<{ success: boolean }> {
    return this.client.delete(`/comment/${commentId}`);
  }

  /**
   * Get threaded comments for a parent comment
   * @param commentId The ID of the parent comment
   * @param params Optional parameters for pagination
   * @returns A list of threaded comments
   */
  async getThreadedComments(commentId: string, params?: GetThreadedCommentsParams): Promise<{ comments: Comment[] }> {
    return this.client.get(`/comment/${commentId}/reply`, params);
  }

  /**
   * Create a new threaded comment on a parent comment
   * @param commentId The ID of the parent comment
   * @param params The comment parameters
   * @returns The created threaded comment
   */
  async createThreadedComment(commentId: string, params: CreateThreadedCommentParams): Promise<Comment> {
    return this.client.post(`/comment/${commentId}/reply`, params);
  }
}

export const createCommentsClient = (client: ClickUpClient): CommentsClient => {
  return new CommentsClient(client);
};
