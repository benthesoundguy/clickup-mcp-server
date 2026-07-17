import { z } from 'zod';
import { createClickUpClient } from '../clickup-client/index.js';
import { createDocsClient } from '../clickup-client/docs.js';
import { createAuthClient } from '../clickup-client/auth.js';
const clickUpClient = createClickUpClient();
const docsClient = createDocsClient(clickUpClient);
const authClient = createAuthClient(clickUpClient);
export function setupDocTools(server) {
    server.tool('docs', 'Manage ClickUp docs and pages. Use action to get, list, create, update docs, or list, create, update, delete pages, or search docs.', {
        action: z.enum(['get', 'list', 'create', 'update', 'search', 'pages_list', 'pages_create', 'pages_update', 'pages_delete'])
            .describe('Action to perform'),
        workspace_id: z.string().optional().describe('The ID of the workspace (get, list, search)'),
        doc_id: z.string().optional().describe('Required for get, update, pages_*: the doc ID'),
        page_id: z.string().optional().describe('Required for pages_update, pages_delete: the page ID'),
        query: z.string().optional().describe('Required for search: the search query'),
        cursor: z.string().optional().describe('Pagination cursor (list, search)'),
        content_format: z.enum(['text/md', 'text/plain']).optional().describe('Content format (pages_list)'),
        deleted: z.boolean().optional().describe('Include deleted docs (list)'),
        archived: z.boolean().optional().describe('Include archived docs (list)'),
        limit: z.number().optional().describe('Max docs to return (list)'),
        // Create/update fields
        scope_type: z.enum(['list', 'folder']).optional().describe('Where to create the doc (create)'),
        scope_id: z.string().optional().describe('The list or folder ID (create)'),
        name: z.string().optional().describe('Doc/page name (create, update, pages_create, pages_update)'),
        content: z.string().optional().describe('Doc/page content in HTML format (create, update, pages_create, pages_update)'),
        sub_title: z.string().optional().describe('Page subtitle (pages_create, pages_update)'),
        parent_page_id: z.string().optional().describe('Parent page ID for sub-pages (pages_create)'),
        template_id: z.string().optional().describe('Create doc from a template (create) — get template ID from templates tool'),
    }, async ({ action, workspace_id, doc_id, page_id, query, cursor, content_format, deleted, archived, limit, scope_type, scope_id, name, content, sub_title, parent_page_id, template_id }) => {
        try {
            switch (action) {
                case 'get': {
                    if (!doc_id || !workspace_id)
                        throw new Error('doc_id and workspace_id required for get');
                    const pages = await docsClient.getDocPages(workspace_id, doc_id);
                    let combined = '';
                    if (Array.isArray(pages)) {
                        for (const page of pages) {
                            if (page.content)
                                combined += page.content + '\n\n';
                        }
                    }
                    return { content: [{ type: 'text', text: combined || 'No content found in this doc.' }] };
                }
                case 'list': {
                    if (!workspace_id)
                        throw new Error('workspace_id required for list');
                    const result = await docsClient.getDocsFromWorkspace(workspace_id, {
                        cursor, deleted: deleted ?? false, archived: archived ?? false, limit: limit || 50
                    });
                    return { content: [{ type: 'text', text: JSON.stringify(result.docs, null, 2) }] };
                }
                case 'create': {
                    if (!scope_type || !scope_id || !name)
                        throw new Error('scope_type, scope_id, and name required for create');
                    const result = scope_type === 'list'
                        ? await docsClient.createDocInList(scope_id, name, content || '', template_id)
                        : await docsClient.createDocInFolder(scope_id, name, content || '', template_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'update': {
                    if (!doc_id)
                        throw new Error('doc_id required for update');
                    const result = await docsClient.updateDoc(doc_id, name, content);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'search': {
                    if (!query || !workspace_id)
                        throw new Error('query and workspace_id required for search');
                    const result = await docsClient.searchDocs(workspace_id, { query, cursor });
                    return { content: [{ type: 'text', text: JSON.stringify(result.docs, null, 2) }] };
                }
                case 'pages_list': {
                    if (!doc_id || !workspace_id)
                        throw new Error('doc_id and workspace_id required for pages_list');
                    const pages = await docsClient.getDocPages(workspace_id, doc_id, content_format);
                    return { content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }] };
                }
                case 'pages_create': {
                    if (!doc_id || !name)
                        throw new Error('doc_id and name required for pages_create');
                    const result = await docsClient.createDocPage(doc_id, name, content || '', sub_title, parent_page_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'pages_update': {
                    if (!doc_id || !page_id)
                        throw new Error('doc_id and page_id required for pages_update');
                    const result = await docsClient.updateDocPage(doc_id, page_id, name, content, sub_title);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'pages_delete': {
                    if (!doc_id || !page_id)
                        throw new Error('doc_id and page_id required for pages_delete');
                    const result = await docsClient.deleteDocPage(doc_id, page_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
            }
        }
        catch (error) {
            console.error('[DocTools] Error:', error);
            return { content: [{ type: 'text', text: `Error with docs: ${error.message}` }], isError: true };
        }
    });
}
//# sourceMappingURL=doc-tools.js.map