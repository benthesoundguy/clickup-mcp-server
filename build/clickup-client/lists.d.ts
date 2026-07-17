import { ClickUpClient } from './index.js';
export interface List {
    id: string;
    name: string;
}
export interface GetListsParams {
}
export interface CreateListParams {
    name: string;
}
export interface UpdateListParams {
    name?: string;
}
export declare class ListsClient {
    private client;
    constructor(client: ClickUpClient);
    getListsFromSpace(spaceId: string, params?: GetListsParams): Promise<{
        lists: List[];
    }>;
    getListsFromFolder(folderId: string, params?: GetListsParams): Promise<{
        lists: List[];
    }>;
    createListInFolder(folderId: string, params: CreateListParams): Promise<List>;
    createFolderlessList(spaceId: string, params: CreateListParams): Promise<List>;
    getList(listId: string): Promise<List>;
    updateList(listId: string, params: UpdateListParams): Promise<List>;
    deleteList(listId: string): Promise<{
        success: boolean;
    }>;
    addTaskToList(listId: string, taskId: string): Promise<{
        success: boolean;
    }>;
    removeTaskFromList(listId: string, taskId: string): Promise<{
        success: boolean;
    }>;
    createListFromTemplateInFolder(folderId: string, templateId: string, params: CreateListParams): Promise<List>;
    createListFromTemplateInSpace(spaceId: string, templateId: string, params: CreateListParams): Promise<List>;
    getListMembers(listId: string): Promise<any>;
    getStatuses(listId: string): Promise<any>;
    setStatuses(listId: string, statuses: Array<{
        status: string;
        color: string;
        orderindex?: number;
        hide_label?: boolean;
    }>, overrideExisting?: boolean): Promise<any>;
}
export declare const createListsClient: (client: ClickUpClient) => ListsClient;
