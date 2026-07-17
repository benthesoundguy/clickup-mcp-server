import { AxiosInstance } from 'axios';
export interface ClickUpClientConfig {
    apiToken: string;
    baseUrl?: string;
}
export declare class ClickUpClient {
    private axiosInstance;
    constructor(config: ClickUpClientConfig);
    getAxiosInstance(): AxiosInstance;
    get<T = any>(endpoint: string, params?: any): Promise<T>;
    post<T = any>(endpoint: string, data?: any): Promise<T>;
    put<T = any>(endpoint: string, data?: any): Promise<T>;
    delete<T = any>(endpoint: string, config?: {
        params?: any;
    }): Promise<T>;
}
export declare const createClickUpClient: () => ClickUpClient;
