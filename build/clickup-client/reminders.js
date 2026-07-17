export function createRemindersClient(client) {
    return {
        async getReminders(params) {
            return client.get('/reminder', params);
        },
        async createReminder(title, dueDate, description) {
            return client.post('/reminder', { title, due_date: dueDate, description });
        },
        async updateReminder(reminderId, title, description, dueDate, isCompleted) {
            return client.put(`/reminder/${reminderId}`, { title, description, due_date: dueDate, is_completed: isCompleted });
        }
    };
}
//# sourceMappingURL=reminders.js.map