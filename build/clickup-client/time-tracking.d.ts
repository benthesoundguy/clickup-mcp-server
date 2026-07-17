import { ClickUpClient } from './index.js';
export interface GetTimeEntriesParams {
    start_date?: string;
    end_date?: string;
    task_id?: string;
    assignee?: string[];
    is_billable?: boolean;
}
export interface CreateTimeEntryData {
    start?: string;
    duration?: string;
    end_time?: string;
    description?: string;
    billable?: boolean;
    tags?: string[];
    task_id?: string;
}
export interface UpdateTimeEntryData {
    start?: string;
    duration?: string;
    end_time?: string;
    description?: string;
    billable?: boolean;
    tags?: string[];
}
export interface StartTimerData {
    task_id?: string;
    description?: string;
    billable?: boolean;
    tags?: string[];
}
export declare class TimeTrackingClient {
    private client;
    constructor(client: ClickUpClient);
    /**
     * Get time entries for a team
     * @param teamId The ID of the team (workspace)
     * @param params Optional filter parameters
     * @returns A list of time entries
     */
    getTimeEntries(teamId: string, params?: GetTimeEntriesParams): Promise<any>;
    /**
     * Create a new manual time entry
     * @param teamId The ID of the team (workspace)
     * @param data The time entry data
     * @returns The created time entry
     */
    createTimeEntry(teamId: string, data: CreateTimeEntryData): Promise<any>;
    /**
     * Update an existing time entry
     * @param teamId The ID of the team (workspace)
     * @param entryId The ID of the time entry to update
     * @param data The time entry data to update
     * @returns The updated time entry
     */
    updateTimeEntry(teamId: string, entryId: string, data: UpdateTimeEntryData): Promise<any>;
    /**
     * Delete a time entry
     * @param teamId The ID of the team (workspace)
     * @param entryId The ID of the time entry to delete
     * @returns Success confirmation
     */
    deleteTimeEntry(teamId: string, entryId: string): Promise<any>;
    /**
     * Start a timer on a task
     * @param teamId The ID of the team (workspace)
     * @param data Optional timer parameters (task_id, description)
     * @returns The started time entry
     */
    startTimer(teamId: string, data?: StartTimerData): Promise<any>;
    /**
     * Stop the currently running timer
     * @param teamId The ID of the team (workspace)
     * @returns The stopped time entry
     */
    stopTimer(teamId: string): Promise<any>;
    /**
     * Get the currently running time entry
     * @param teamId The ID of the team (workspace)
     * @returns The current running time entry, if any
     */
    getRunningTimeEntry(teamId: string): Promise<any>;
    /**
     * Remove tags from a time entry
     * @param teamId The ID of the team (workspace)
     * @param entryId The ID of the time entry
     * @returns Success confirmation
     */
    removeTags(teamId: string, entryId: string): Promise<any>;
}
export declare const createTimeTrackingClient: (client: ClickUpClient) => TimeTrackingClient;
