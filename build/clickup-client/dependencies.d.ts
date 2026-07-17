import { ClickUpClient } from './index.js';
export interface CreateDependencyRequest {
    depends_on: string;
    dependency_type?: string;
}
export interface UpdateDependencyRequest {
    dependency_type?: string;
}
export declare class DependenciesClient {
    private client;
    constructor(client: ClickUpClient);
    addDependency(taskId: string, dependsOn: string): Promise<void>;
    removeDependency(taskId: string, dependsOn: string): Promise<void>;
    getTaskDependencies(taskId: string): Promise<any>;
    updateDependency(dependencyId: string, dependencyType?: string): Promise<any>;
    deleteDependency(dependencyId: string): Promise<void>;
    getDependencyGraph(taskId: string, direction?: 'inbound' | 'outbound'): Promise<any>;
    checkDependencyConflicts(taskId: string, dependsOn: string): Promise<any>;
    resolveDependencyConflicts(taskId: string): Promise<any>;
    bulkCreateDependencies(workspaceId: string, dependencies: Array<{
        task_id: string;
        depends_on: string;
        dependency_type?: string;
    }>): Promise<any>;
    getWorkspaceDependencies(workspaceId: string, page?: number): Promise<any>;
    getDependencyStats(workspaceId: string): Promise<any>;
    getDependencyTimelineImpact(taskId: string): Promise<any>;
    exportDependencyGraph(workspaceId: string): Promise<any>;
    importDependencyGraph(workspaceId: string, data: any): Promise<any>;
}
export declare const createDependenciesClient: (client: ClickUpClient) => DependenciesClient;
