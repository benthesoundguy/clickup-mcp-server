import { z } from 'zod';
import { createProjectIntelligenceClient } from '../clickup-client/project-intelligence.js';
const pi = createProjectIntelligenceClient();
export function setupProjectIntelligenceTools(server) {
    server.tool('project_intelligence', 'Analyze ClickUp project data and return actionable insights. '
        + 'Use "health" for a status overview, "bottlenecks" to find stuck workflows, '
        + '"velocity" to measure completion rate, "dependencies" to trace dependency chains, '
        + '"sprint" to check sprint readiness, "workload" to view team distribution, '
        + '"risk" to surface tasks needing attention, or "time_report" for time tracking summaries. '
        + 'Every action handles edge cases.', {
        action: z.enum(['health', 'bottlenecks', 'velocity', 'dependencies', 'sprint', 'workload', 'risk', 'time_report'])
            .describe('Analysis to perform'),
        list_id: z.string().describe('The ID of the ClickUp list to analyze'),
        start_date: z.string().optional().describe('Start date in YYYY-MM-DD format (time_report only)'),
        end_date: z.string().optional().describe('End date in YYYY-MM-DD format (time_report only)'),
    }, async ({ action, list_id, start_date, end_date }) => {
        try {
            switch (action) {
                case 'health': {
                    const result = await pi.health(list_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'bottlenecks': {
                    const result = await pi.bottlenecks(list_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'velocity': {
                    const result = await pi.velocity(list_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'dependencies': {
                    const result = await pi.dependencyAnalysis(list_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'sprint': {
                    const result = await pi.sprintReadiness(list_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'workload': {
                    const result = await pi.workload(list_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'risk': {
                    const result = await pi.risk(list_id);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                case 'time_report': {
                    const result = await pi.timeReport(list_id, start_date, end_date);
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
            }
        }
        catch (error) {
            console.error('[ProjectIntelligence] Error:', error);
            return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
        }
    });
}
//# sourceMappingURL=project-intelligence-tools.js.map