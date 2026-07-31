import { ClickUpClient } from './index.js';

// ClickUp's reminders API is CREATE-ONLY. Live probing (2026-07-31) confirmed
// POST /reminder exists (validates due_date), while GET/PUT/DELETE /reminder
// and every list-style variant return bare 404/405 — reminders cannot be
// read, updated, or deleted via the public API.

export function createRemindersClient(client: ClickUpClient) {
  return {
    async createReminder(title: string, dueDate: string, description?: string): Promise<any> {
      return client.post('/reminder', { title, due_date: dueDate, description });
    }
  };
}
