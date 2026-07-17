export class TimeTrackingClient {
    constructor(client) {
        this.client = client;
    }
    /**
     * Get time entries for a team
     * @param teamId The ID of the team (workspace)
     * @param params Optional filter parameters
     * @returns A list of time entries
     */
    async getTimeEntries(teamId, params) {
        return this.client.get(`/team/${teamId}/time_entries`, params);
    }
    /**
     * Create a new manual time entry
     * @param teamId The ID of the team (workspace)
     * @param data The time entry data
     * @returns The created time entry
     */
    async createTimeEntry(teamId, data) {
        return this.client.post(`/team/${teamId}/time_entry`, data);
    }
    /**
     * Update an existing time entry
     * @param teamId The ID of the team (workspace)
     * @param entryId The ID of the time entry to update
     * @param data The time entry data to update
     * @returns The updated time entry
     */
    async updateTimeEntry(teamId, entryId, data) {
        return this.client.put(`/team/${teamId}/time_entry/${entryId}`, data);
    }
    /**
     * Delete a time entry
     * @param teamId The ID of the team (workspace)
     * @param entryId The ID of the time entry to delete
     * @returns Success confirmation
     */
    async deleteTimeEntry(teamId, entryId) {
        return this.client.delete(`/team/${teamId}/time_entry/${entryId}`);
    }
    /**
     * Start a timer on a task
     * @param teamId The ID of the team (workspace)
     * @param data Optional timer parameters (task_id, description)
     * @returns The started time entry
     */
    async startTimer(teamId, data) {
        return this.client.post(`/team/${teamId}/time_entries/start`, data);
    }
    /**
     * Stop the currently running timer
     * @param teamId The ID of the team (workspace)
     * @returns The stopped time entry
     */
    async stopTimer(teamId) {
        return this.client.post(`/team/${teamId}/time_entries/stop`);
    }
    /**
     * Get the currently running time entry
     * @param teamId The ID of the team (workspace)
     * @returns The current running time entry, if any
     */
    async getRunningTimeEntry(teamId) {
        return this.client.get(`/team/${teamId}/time_entries/current`);
    }
    /**
     * Remove tags from a time entry
     * @param teamId The ID of the team (workspace)
     * @param entryId The ID of the time entry
     * @returns Success confirmation
     */
    async removeTags(teamId, entryId) {
        return this.client.delete(`/team/${teamId}/time_entries/${entryId}/tags`);
    }
}
export const createTimeTrackingClient = (client) => new TimeTrackingClient(client);
//# sourceMappingURL=time-tracking.js.map