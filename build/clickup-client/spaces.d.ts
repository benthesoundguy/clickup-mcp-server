import { ClickUpClient } from './index.js';
export interface Space {
    id: string;
    name: string;
    private: boolean;
    statuses: any[];
    multiple_assignees: boolean;
    features: {
        due_dates: {
            enabled: boolean;
            start_date: boolean;
            remap_due_dates: boolean;
            remap_closed_due_date: boolean;
        };
        time_tracking: {
            enabled: boolean;
        };
        tags: {
            enabled: boolean;
        };
        time_estimates: {
            enabled: boolean;
        };
        checklists: {
            enabled: boolean;
        };
        custom_fields: {
            enabled: boolean;
        };
        remap_dependencies: {
            enabled: boolean;
        };
        dependency_warning: {
            enabled: boolean;
        };
        portfolios: {
            enabled: boolean;
        };
    };
    archived: boolean;
}
export declare class SpacesClient {
    private client;
    constructor(client: ClickUpClient);
    /**
     * Get spaces from a specific workspace
     * @param workspaceId The ID of the workspace to get spaces from
     * @returns A list of spaces
     */
    getSpacesFromWorkspace(workspaceId: string): Promise<Space[]>;
    /**
     * Get a specific space by ID
     * @param spaceId The ID of the space to get
     * @returns The space details
     */
    getSpace(spaceId: string): Promise<Space>;
}
export declare const createSpacesClient: (client: ClickUpClient) => SpacesClient;
