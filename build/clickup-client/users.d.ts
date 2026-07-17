import { ClickUpClient } from './index.js';
export declare function createUsersClient(client: ClickUpClient): {
    /** Get all users in a workspace. */
    getUsers(workspaceId: string): Promise<any>;
    /** Invite a user to a workspace. */
    inviteUser(workspaceId: string, email: string, admin?: boolean): Promise<any>;
    /** Edit a user's details in the workspace. */
    editUser(workspaceId: string, userId: number, data: Record<string, any>): Promise<any>;
    /** Remove a user from the workspace. */
    removeUser(workspaceId: string, userId: number): Promise<any>;
};
