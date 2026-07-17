import { ClickUpClient } from './index.js';
export declare function createSearchClient(client: ClickUpClient): {
    searchWorkspace(teamId: string, params: {
        query?: string;
        locations?: string[];
        types?: string[];
        page?: number;
        per_page?: number;
        modified_after?: number;
    }): Promise<any>;
};
