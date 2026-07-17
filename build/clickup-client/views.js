export class ViewsClient {
    constructor(client) {
        this.client = client;
    }
    /** Get all views on a list. */
    async getListViews(listId) {
        const res = await this.client.get(`/list/${listId}/view`);
        return res.views;
    }
    /** Create a view on a list. Returns { view: { id, name, type, ... } }. */
    async createListView(listId, name, type) {
        const res = await this.client.post(`/list/${listId}/view`, { name, type });
        return res.view;
    }
    /** Get a specific view by ID. */
    async getView(viewId) {
        return this.client.get(`/view/${viewId}`);
    }
    /** Update a view. */
    async updateView(viewId, params) {
        const res = await this.client.put(`/view/${viewId}`, params);
        return res.view;
    }
    /** Delete a view. */
    async deleteView(viewId) {
        await this.client.delete(`/view/${viewId}`);
    }
    /** Duplicate a view. */
    async duplicateView(viewId, name, includeContent) {
        const res = await this.client.post(`/view/${viewId}/duplicate`, { name, include_content: includeContent ?? true });
        return res.view;
    }
    /** Get tasks displayed in a view. */
    async getViewTasks(viewId, page) {
        return this.client.get(`/view/${viewId}/task`, page ? { page } : undefined);
    }
    /** Add sharing to a view. */
    async addViewSharing(viewId, type, id, permissionLevel) {
        return this.client.post(`/view/${viewId}/share`, { type, id, permission_level: permissionLevel });
    }
    /** Remove sharing from a view. */
    async removeViewSharing(viewId, type, id) {
        return this.client.delete(`/view/${viewId}/share`, { params: { type, id } });
    }
}
export const createViewsClient = (client) => new ViewsClient(client);
//# sourceMappingURL=views.js.map