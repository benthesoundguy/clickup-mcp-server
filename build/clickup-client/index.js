import axios from 'axios';
// ClickUp API base URL
const API_BASE_URL = 'https://api.clickup.com/api/v2';
export class ClickUpClient {
    constructor(config) {
        if (!config.apiToken) {
            throw new Error('ClickUp API token is required');
        }
        this.axiosInstance = axios.create({
            baseURL: config.baseUrl || API_BASE_URL,
            headers: {
                'Authorization': config.apiToken,
                'Content-Type': 'application/json'
            }
        });
        // Add response interceptor for error handling
        this.axiosInstance.interceptors.response.use(response => response, error => {
            if (error.response) {
                // Format error message with status and data
                const message = `ClickUp API Error (${error.response.status}): ${error.response.data?.err || error.message}`;
                error.message = message;
            }
            return Promise.reject(error);
        });
    }
    // Helper method to get the axios instance for use in other modules
    getAxiosInstance() {
        return this.axiosInstance;
    }
    // Basic API methods that can be used directly
    async get(endpoint, params) {
        const response = await this.axiosInstance.get(endpoint, { params });
        return response.data;
    }
    async post(endpoint, data) {
        const response = await this.axiosInstance.post(endpoint, data);
        return response.data;
    }
    async put(endpoint, data) {
        const response = await this.axiosInstance.put(endpoint, data);
        return response.data;
    }
    async delete(endpoint, config) {
        const response = await this.axiosInstance.delete(endpoint, config || {});
        return response.data;
    }
}
// Create a singleton instance using environment variables
export const createClickUpClient = () => {
    const apiToken = process.env.CLICKUP_API_TOKEN;
    if (!apiToken) {
        throw new Error('CLICKUP_API_TOKEN environment variable is required');
    }
    return new ClickUpClient({ apiToken });
};
//# sourceMappingURL=index.js.map