import { ClickUpClient } from './index.js';
export declare function createRemindersClient(client: ClickUpClient): {
    getReminders(params?: {
        due_date_status?: string;
        reminder_type?: string;
        is_overdue?: boolean;
        is_completed?: boolean;
        cursor?: string;
        limit?: number;
    }): Promise<any>;
    createReminder(title: string, dueDate: string, description?: string): Promise<any>;
    updateReminder(reminderId: string, title?: string, description?: string, dueDate?: string, isCompleted?: boolean): Promise<any>;
};
