import { ClickUpClient } from './index.js';

export function createRemindersClient(client: ClickUpClient) {
  return {
    async getReminders(params?: { due_date_status?: string; reminder_type?: string; is_overdue?: boolean; is_completed?: boolean; cursor?: string; limit?: number }): Promise<any> {
      return client.get('/reminder', params);
    },
    async createReminder(title: string, dueDate: string, description?: string): Promise<any> {
      return client.post('/reminder', { title, due_date: dueDate, description });
    },
    async updateReminder(reminderId: string, title?: string, description?: string, dueDate?: string, isCompleted?: boolean): Promise<any> {
      return client.put(`/reminder/${reminderId}`, { title, description, due_date: dueDate, is_completed: isCompleted });
    }
  };
}
