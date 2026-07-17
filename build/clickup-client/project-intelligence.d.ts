export declare function createProjectIntelligenceClient(): {
    health(listId: string): Promise<{
        health_score: number;
        health_grade: string;
        total_tasks: number;
        open_tasks: number;
        closed_tasks: number;
        completion_rate: number;
        blocked_rate: number;
        overdue_rate: number;
        stale_rate: number;
        status_distribution: Record<string, {
            count: number;
            percentage: string;
        }>;
        recent_completions_7d: number;
        tasks: {
            id: string;
            name: string;
            status: string | undefined;
            priority: string | undefined;
            assignees: any[] | undefined;
            due_date: string | null | undefined;
            blocked: boolean;
        }[];
    }>;
    bottlenecks(listId: string): Promise<{
        top_bottleneck: {
            status: string;
            avg_dwell_days: number;
            task_count: number;
        } | null;
        status_metrics: {
            status: string;
            task_count: number;
            avg_dwell_days: number;
            stalled_count: number;
            stalled_tasks: any[];
        }[];
        total_stalled: number;
    }>;
    velocity(listId: string): Promise<any>;
    dependencyAnalysis(listId: string): Promise<{
        total_dependencies: number;
        avg_deps_per_task: number;
        max_chain_depth: number;
        circular_dependencies_detected: boolean;
        circular_task_ids: string[];
        top_blockers: {
            task_id: string;
            name: string;
            blocks_count: number;
        }[];
        blocked_task_count: number;
        blocked_tasks: {
            task_id: string;
            name: string;
            blocked_by: {
                task_id: string;
                name: string;
                status: string | undefined;
            }[];
        }[];
        dependency_graph: Record<string, string[]>;
    }>;
    sprintReadiness(listId: string): Promise<{
        ready_count: number;
        blocked_count: number;
        in_progress_count: number;
        holding_count: number;
        capacity_score: number;
        recommended_sprint_scope: {
            id: any;
            name: any;
            priority: any;
        }[];
        blocked_details: {
            task_id: any;
            name: any;
            blocked_by: any;
        }[];
    }>;
    workload(listId: string): Promise<{
        assignees: {
            todo: number;
            in_progress: number;
            done: number;
            blocked: number;
            overdue: number;
            total: number;
            priority_weighted: number;
            name: string;
        }[];
        unassigned_active_tasks: number;
        avg_in_progress_per_assignee: number;
        overloaded_assignees: {
            name: string;
            in_progress: number;
            threshold: number;
        }[];
    }>;
    risk(listId: string): Promise<{
        total_risks_analyzed: number;
        high_risk_count: number;
        medium_risk_count: number;
        low_risk_count: number;
        top_risk_driver: {
            driver: string;
            count: number;
        } | null;
        high_risk_tasks: any[];
        medium_risk_tasks: any[];
        all_risk_scores: any[];
    }>;
    timeReport(listId: string, start_date?: string, end_date?: string): Promise<{
        total_hours: number;
        days_tracked: number;
        avg_hours_per_day: number;
        hours_per_person: {
            name: string;
            hours: number;
        }[];
        hours_per_task: {
            name: string;
            hours: number;
        }[];
        hours_per_day: {
            day: string;
            hours: number;
        }[];
    }>;
};
