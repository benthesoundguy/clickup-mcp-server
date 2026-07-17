import { ClickUpClient } from './index.js';
export declare function createGroupsClient(client: ClickUpClient): {
    /** Get all user groups in a workspace. */
    getGroups(workspaceId: string): Promise<any>;
    /** Create a new user group in a workspace. */
    createGroup(workspaceId: string, name: string): Promise<any>;
    /** Update a user group's name. */
    updateGroup(workspaceId: string, groupId: string, name: string): Promise<any>;
    /** Delete a user group from the workspace. */
    deleteGroup(workspaceId: string, groupId: string): Promise<any>;
};
