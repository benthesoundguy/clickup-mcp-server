import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createSearchClient } from '../clickup-client/search.js';
const clickUpClient = createClickUpClient();
const searchClient = createSearchClient(clickUpClient);
export function setupSearchTools(server) {
    server.tool('workspace_search', 'Search across all content in a ClickUp workspace — tasks, docs, chats, attachments, and more.', {
        workspace_id: z.string().describe('The ID of the workspace to search in'),
        query: z.string().describe('The search query string'),
        asset_types: z.array(z.enum(['task', 'doc', 'whiteboard', 'dashboard', 'attachment', 'chat'])).optional().describe('Filter by asset types'),
        page: z.number().optional().describe('Page number for pagination'),
        per_page: z.number().optional().describe('Results per page')
    }, async ({ workspace_id, query, asset_types, page, per_page }) => {
        try {
            const result = await searchClient.searchWorkspace(workspace_id, {
                query, locations: [workspace_id], types: asset_types, page, per_page
            });
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (error) {
            console.error('[SearchTools] Error searching workspace:', error);
            return { content: [{ type: 'text', text: `Error searching workspace: ${error.message}` }], isError: true };
        }
    });
}
//# sourceMappingURL=search-tools.js.map