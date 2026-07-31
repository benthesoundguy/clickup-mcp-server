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

export class TimeTrackingClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  /**
   * Get time entries for a team
   * @param teamId The ID of the team (workspace)
   * @param params Optional filter parameters
   * @returns A list of time entries
   */
  async getTimeEntries(teamId: string, params?: GetTimeEntriesParams): Promise<any> {
    return this.client.get(`/team/${teamId}/time_entries`, params);
  }

  /**
   * Create a new manual time entry
   * @param teamId The ID of the team (workspace)
   * @param data The time entry data
   * @returns The created time entry
   */
  async createTimeEntry(teamId: string, data: CreateTimeEntryData): Promise<any> {
    return this.client.post(`/team/${teamId}/time_entries`, data);
  }

  /**
   * Update an existing time entry
   * @param teamId The ID of the team (workspace)
   * @param entryId The ID of the time entry to update
   * @param data The time entry data to update
   * @returns The updated time entry
   */
  async updateTimeEntry(teamId: string, entryId: string, data: UpdateTimeEntryData): Promise<any> {
    return this.client.put(`/team/${teamId}/time_entries/${entryId}`, data);
  }

  /**
   * Delete a time entry
   * @param teamId The ID of the team (workspace)
   * @param entryId The ID of the time entry to delete
   * @returns Success confirmation
   */
  async deleteTimeEntry(teamId: string, entryId: string): Promise<any> {
    return this.client.delete(`/team/${teamId}/time_entries/${entryId}`);
  }

  /**
   * Start a timer on a task
   * @param teamId The ID of the team (workspace)
   * @param data Optional timer parameters (task_id, description)
   * @returns The started time entry
   */
  async startTimer(teamId: string, data?: StartTimerData): Promise<any> {
    return this.client.post(`/team/${teamId}/time_entries/start`, data);
  }

  /**
   * Stop the currently running timer
   * @param teamId The ID of the team (workspace)
   * @returns The stopped time entry
   */
  async stopTimer(teamId: string): Promise<any> {
    return this.client.post(`/team/${teamId}/time_entries/stop`);
  }

  /**
   * Get the currently running time entry
   * @param teamId The ID of the team (workspace)
   * @returns The current running time entry, if any
   */
  async getRunningTimeEntry(teamId: string): Promise<any> {
    return this.client.get(`/team/${teamId}/time_entries/current`);
  }

}

export const createTimeTrackingClient = (client: ClickUpClient): TimeTrackingClient =>
  new TimeTrackingClient(client);
