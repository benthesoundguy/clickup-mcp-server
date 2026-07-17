import { ClickUpClient } from './index.js';
export declare function createGuestsClient(client: ClickUpClient): {
    inviteGuest(workspaceId: string, email: string, canEditTags?: boolean): Promise<any>;
    getGuest(workspaceId: string, guestId: number): Promise<any>;
    editGuest(workspaceId: string, guestId: number, data: Record<string, any>): Promise<any>;
    removeGuest(workspaceId: string, guestId: number): Promise<any>;
    addToTask(guestId: number, taskId: string, permissionLevel?: string): Promise<any>;
    removeFromTask(guestId: number, taskId: string): Promise<any>;
    addToList(guestId: number, listId: string, permissionLevel?: string): Promise<any>;
    removeFromList(guestId: number, listId: string): Promise<any>;
    addToFolder(guestId: number, folderId: string, permissionLevel?: string): Promise<any>;
    removeFromFolder(guestId: number, folderId: string): Promise<any>;
};
