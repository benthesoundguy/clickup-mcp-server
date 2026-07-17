import { ClickUpClient } from './index.js';
export interface View {
    id: string;
    name: string;
    type: string;
    [key: string]: any;
}
export declare class ViewsClient {
    private client;
    constructor(client: ClickUpClient);
    /** Get all views on a list. */
    getListViews(listId: string): Promise<View[]>;
    /** Create a view on a list. Returns { view: { id, name, type, ... } }. */
    createListView(listId: string, name: string, type: number): Promise<View>;
    /** Get a specific view by ID. */
    getView(viewId: string): Promise<View>;
    /** Update a view. */
    updateView(viewId: string, params: Record<string, any>): Promise<View>;
    /** Delete a view. */
    deleteView(viewId: string): Promise<void>;
    /** Duplicate a view. */
    duplicateView(viewId: string, name: string, includeContent?: boolean): Promise<View>;
    /** Get tasks displayed in a view. */
    getViewTasks(viewId: string, page?: number): Promise<{
        tasks: any[];
    }>;
    /** Add sharing to a view. */
    addViewSharing(viewId: string, type: string, id: string, permissionLevel?: string): Promise<any>;
    /** Remove sharing from a view. */
    removeViewSharing(viewId: string, type: string, id: string): Promise<any>;
}
export declare const createViewsClient: (client: ClickUpClient) => ViewsClient;
