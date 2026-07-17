import axios from 'axios';
export class DocsClient {
    constructor(client) {
        this.client = client;
    }
    /**
     * Get docs from a specific workspace
     * @param workspaceId The ID of the workspace to get docs from
     * @param params Optional parameters for filtering docs
     * @returns A list of docs
     */
    async getDocsFromWorkspace(workspaceId, params) {
        // Get the API token directly from the environment variable
        const apiToken = process.env.CLICKUP_API_TOKEN;
        try {
            const url = `https://api.clickup.com/api/v3/workspaces/${workspaceId}/docs`;
            // Use the exact same headers that worked in the successful request
            const headers = {
                'Authorization': apiToken,
                'Accept': 'application/json'
            };
            const response = await axios.get(url, {
                headers,
                params
            });
            return response.data;
        }
        catch (error) {
            console.error('Error getting docs:', error);
            throw error;
        }
    }
    /**
     * Get the pages of a doc
     * @param workspaceId The ID of the workspace
     * @param docId The ID of the doc
     * @param contentFormat The format to return the content in (text/md or text/plain)
     * @returns The pages of the doc
     */
    async getDocPages(workspaceId, docId, contentFormat = 'text/md') {
        // Get the API token directly from the environment variable
        const apiToken = process.env.CLICKUP_API_TOKEN;
        try {
            const url = `https://api.clickup.com/api/v3/workspaces/${workspaceId}/docs/${docId}/pages`;
            // Use the exact same parameters that worked in the successful request
            const params = {
                max_page_depth: -1,
                content_format: contentFormat
            };
            // Use the exact same headers that worked in the successful request
            const headers = {
                'Authorization': apiToken,
                'Accept': 'application/json'
            };
            const response = await axios.get(url, {
                headers,
                params
            });
            return response.data;
        }
        catch (error) {
            console.error('Error getting doc pages:', error);
            throw error;
        }
    }
    /**
     * Search for docs in a workspace
     * @param workspaceId The ID of the workspace to search in
     * @param params The search parameters
     * @returns A list of docs matching the search query
     */
    async searchDocs(workspaceId, params) {
        // Get the API token directly from the environment variable
        const apiToken = process.env.CLICKUP_API_TOKEN;
        try {
            // According to the ClickUp API documentation, the endpoint is:
            // GET /api/v2/team/{team_id}/docs/search
            // where team_id is the workspace ID
            const url = `https://api.clickup.com/api/v2/team/${workspaceId}/docs/search`;
            // Use the exact same headers that worked in the successful request
            const headers = {
                'Authorization': apiToken,
                'Accept': 'application/json'
            };
            // According to the ClickUp API documentation, this should be a GET request
            // with the parameters as query parameters
            const queryParams = {
                doc_name: params.query,
                cursor: params.cursor
            };
            // If the query is a space ID, use it as a space_id parameter
            if (params.query.startsWith('space:')) {
                const spaceId = params.query.substring(6);
                queryParams.space_id = spaceId;
                delete queryParams.doc_name;
            }
            const response = await axios.get(url, {
                headers,
                params: queryParams
            });
            return response.data;
        }
        catch (error) {
            console.error('Error searching docs:', error);
            throw error;
        }
    }
    /**
     * Create a new doc in a list
     * @param listId The ID of the list to create the doc in
     * @param title The title of the doc
     * @param content The content of the doc (HTML format)
     * @returns The created doc
     */
    async createDocInList(listId, title, content, templateId) {
        // Create a custom axios instance for v3 API
        const axiosInstance = this.client.getAxiosInstance();
        const body = { name: title, content };
        if (templateId)
            body.template_id = templateId;
        const response = await axiosInstance.post(`https://api.clickup.com/api/v3/lists/${listId}/docs`, body);
        return response.data;
    }
    /**
     * Create a new doc in a folder
     * @param folderId The ID of the folder to create the doc in
     * @param title The title of the doc
     * @param content The content of the doc (HTML format)
     * @returns The created doc
     */
    async createDocInFolder(folderId, title, content, templateId) {
        // Create a custom axios instance for v3 API
        const axiosInstance = this.client.getAxiosInstance();
        const body = { name: title, content };
        if (templateId)
            body.template_id = templateId;
        const response = await axiosInstance.post(`https://api.clickup.com/api/v3/folders/${folderId}/docs`, body);
        return response.data;
    }
    /**
     * Update an existing doc
     * @param docId The ID of the doc to update
     * @param title The new title of the doc
     * @param content The new content of the doc (HTML format)
     * @returns The updated doc
     */
    async updateDoc(docId, title, content) {
        const params = {};
        if (title !== undefined)
            params.name = title;
        if (content !== undefined)
            params.content = content;
        // Create a custom axios instance for v3 API
        const axiosInstance = this.client.getAxiosInstance();
        const response = await axiosInstance.put(`https://api.clickup.com/api/v3/docs/${docId}`, params);
        return response.data;
    }
    /**
     * Delete a page from a doc.
     */
    async deleteDocPage(docId, pageId) {
        const apiToken = process.env.CLICKUP_API_TOKEN;
        const response = await axios.delete(`https://api.clickup.com/api/v3/docs/${docId}/pages/${pageId}`, {
            headers: { 'Authorization': apiToken, 'Accept': 'application/json' }
        });
        return response.data;
    }
    /**
     * Create a new page in a doc.
     */
    async createDocPage(docId, title, content, subTitle, parentPageId) {
        const apiToken = process.env.CLICKUP_API_TOKEN;
        const body = { name: title, content };
        if (subTitle)
            body.sub_title = subTitle;
        if (parentPageId)
            body.parent_page_id = parentPageId;
        const response = await axios.post(`https://api.clickup.com/api/v3/docs/${docId}/pages`, body, {
            headers: { 'Authorization': apiToken, 'Content-Type': 'application/json', 'Accept': 'application/json' }
        });
        return response.data;
    }
    /**
     * Update an existing page.
     */
    async updateDocPage(docId, pageId, title, content, subTitle) {
        const apiToken = process.env.CLICKUP_API_TOKEN;
        const body = {};
        if (title !== undefined)
            body.name = title;
        if (content !== undefined)
            body.content = content;
        if (subTitle !== undefined)
            body.sub_title = subTitle;
        const response = await axios.put(`https://api.clickup.com/api/v3/docs/${docId}/pages/${pageId}`, body, {
            headers: { 'Authorization': apiToken, 'Content-Type': 'application/json', 'Accept': 'application/json' }
        });
        return response.data;
    }
}
export const createDocsClient = (client) => {
    return new DocsClient(client);
};
//# sourceMappingURL=docs.js.map