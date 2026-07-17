import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createSpacesClient } from '../clickup-client/spaces.js';
const clickUpClient = createClickUpClient();
const spacesClient = createSpacesClient(clickUpClient);
export function setupSpaceTools(server) {
    server.tool('spaces', 'Get spaces from a workspace, or details of a specific space. Omitting space_id lists all spaces in the workspace.', {
        workspace_id: z.string().describe('The ID of the workspace'),
        space_id: z.string().optional().describe('Specific space ID — omit to list all spaces')
    }, async ({ workspace_id, space_id }) => {
        try {
            if (space_id) {
                const space = await spacesClient.getSpace(space_id);
                return { content: [{ type: 'text', text: JSON.stringify(space, null, 2) }] };
            }
            const spaces = await spacesClient.getSpacesFromWorkspace(workspace_id);
            return { content: [{ type: 'text', text: JSON.stringify(spaces, null, 2) }] };
        }
        catch (error) {
            console.error('[SpaceTools] Error:', error);
            return { content: [{ type: 'text', text: `Error with spaces: ${error.message}` }], isError: true };
        }
    });
}
//# sourceMappingURL=space-tools.js.map