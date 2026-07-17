import { ClickUpClient } from './index.js';
export declare class TagsClient {
    private client;
    constructor(client: ClickUpClient);
    /** Get all tags in a space. */
    getSpaceTags(spaceId: string): Promise<any>;
    /** Create a new tag in a space. Body must be wrapped in `{ tag: { ... } }`. */
    createSpaceTag(spaceId: string, name: string, tagBg?: string, tagFg?: string): Promise<void>;
    /** Edit an existing space tag. */
    editSpaceTag(spaceId: string, tagName: string, name?: string, tagBg?: string, tagFg?: string): Promise<void>;
    /** Delete a tag from a space. */
    deleteSpaceTag(spaceId: string, tagName: string): Promise<void>;
    /** Add a tag to a task. */
    addTagToTask(taskId: string, tagName: string): Promise<void>;
    /** Remove a tag from a task. */
    removeTagFromTask(taskId: string, tagName: string): Promise<void>;
}
export declare const createTagsClient: (client: ClickUpClient) => TagsClient;
