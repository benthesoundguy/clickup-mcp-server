export class TagsClient {
    constructor(client) {
        this.client = client;
    }
    /** Get all tags in a space. */
    async getSpaceTags(spaceId) {
        const res = await this.client.get(`/space/${spaceId}/tag`);
        return res.tags;
    }
    /** Create a new tag in a space. Body must be wrapped in `{ tag: { ... } }`. */
    async createSpaceTag(spaceId, name, tagBg, tagFg) {
        const body = { tag: { name } };
        if (tagBg)
            body.tag.tag_bg = tagBg;
        if (tagFg)
            body.tag.tag_fg = tagFg;
        await this.client.post(`/space/${spaceId}/tag`, body);
    }
    /** Edit an existing space tag. */
    async editSpaceTag(spaceId, tagName, name, tagBg, tagFg) {
        const body = { tag: {} };
        if (name)
            body.tag.name = name;
        if (tagBg)
            body.tag.tag_bg = tagBg;
        if (tagFg)
            body.tag.tag_fg = tagFg;
        await this.client.put(`/space/${spaceId}/tag/${encodeURIComponent(tagName)}`, body);
    }
    /** Delete a tag from a space. */
    async deleteSpaceTag(spaceId, tagName) {
        await this.client.delete(`/space/${spaceId}/tag/${encodeURIComponent(tagName)}`);
    }
    /** Add a tag to a task. */
    async addTagToTask(taskId, tagName) {
        await this.client.post(`/task/${taskId}/tag/${encodeURIComponent(tagName)}`);
    }
    /** Remove a tag from a task. */
    async removeTagFromTask(taskId, tagName) {
        await this.client.delete(`/task/${taskId}/tag/${encodeURIComponent(tagName)}`);
    }
}
export const createTagsClient = (client) => new TagsClient(client);
//# sourceMappingURL=tags.js.map