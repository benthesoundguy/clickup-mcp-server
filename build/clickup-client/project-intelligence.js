import { createClickUpClient } from './index.js';
import { createTasksClient } from './tasks.js';
import { createListsClient } from './lists.js';
import { createDependenciesClient } from './dependencies.js';
import { createTimeTrackingClient } from './time-tracking.js';
const clickUpClient = createClickUpClient();
const tasksClient = createTasksClient(clickUpClient);
const listsClient = createListsClient(clickUpClient);
const dependenciesClient = createDependenciesClient(clickUpClient);
const timeTrackingClient = createTimeTrackingClient(clickUpClient);
export function createProjectIntelligenceClient() {
    return {
        // ── Health ──────────────────────────────────────────────────────────
        async health(listId) {
            const taskRes = await tasksClient.getTasksFromList(listId, { include_closed: true });
            const tasks = taskRes.tasks || [];
            const list = await listsClient.getList(listId);
            const statuses = list.statuses || [];
            const now = Date.now();
            const sevenDays = 7 * 24 * 60 * 60 * 1000;
            const statusDist = {};
            let openCount = 0, closedCount = 0, blockedCount = 0, overdueCount = 0, staleCount = 0;
            let recentCompleted = 0;
            for (const t of tasks) {
                const s = t.status?.status || 'unknown';
                statusDist[s] = statusDist[s] || { count: 0, percentage: '0' };
                statusDist[s].count++;
                const isClosed = ['done', 'closed', 'complete'].includes(s.toLowerCase());
                if (isClosed)
                    closedCount++;
                else
                    openCount++;
                if (!isClosed) {
                    if (t.due_date && parseInt(t.due_date) < now)
                        overdueCount++;
                    if (t.date_updated && (now - parseInt(t.date_updated)) > sevenDays)
                        staleCount++;
                    // Check dependencies from task object
                    const deps = t.dependencies || [];
                    if (deps.length > 0)
                        blockedCount++;
                }
                if (isClosed && t.date_updated && (now - parseInt(t.date_updated)) < sevenDays) {
                    recentCompleted++;
                }
            }
            const total = tasks.length || 1;
            Object.keys(statusDist).forEach(k => {
                statusDist[k].percentage = ((statusDist[k].count / total) * 100).toFixed(1);
            });
            const completionRate = total > 0 ? (closedCount / total) * 100 : 0;
            const blockedRate = total > 0 ? (blockedCount / total) * 100 : 0;
            const overdueRate = total > 0 ? (overdueCount / total) * 100 : 0;
            const staleRate = total > 0 ? (staleCount / total) * 100 : 0;
            const healthScore = Math.round(completionRate * 0.4 +
                (100 - blockedRate) * 0.3 +
                (100 - overdueRate) * 0.2 +
                (100 - staleRate) * 0.1);
            const grade = healthScore >= 85 ? 'A' : healthScore >= 70 ? 'B' : healthScore >= 55 ? 'C' : healthScore >= 40 ? 'D' : 'F';
            return {
                health_score: healthScore,
                health_grade: grade,
                total_tasks: tasks.length,
                open_tasks: openCount,
                closed_tasks: closedCount,
                completion_rate: Math.round(completionRate * 10) / 10,
                blocked_rate: Math.round(blockedRate * 10) / 10,
                overdue_rate: Math.round(overdueRate * 10) / 10,
                stale_rate: Math.round(staleRate * 10) / 10,
                status_distribution: statusDist,
                recent_completions_7d: recentCompleted,
                tasks: tasks.map(t => ({
                    id: t.id, name: t.name, status: t.status?.status,
                    priority: t.priority?.priority, assignees: t.assignees?.map((a) => a.username || a.id),
                    due_date: t.due_date, blocked: (t.dependencies?.length || 0) > 0
                }))
            };
        },
        // ── Bottlenecks ─────────────────────────────────────────────────────
        async bottlenecks(listId) {
            const taskRes = await tasksClient.getTasksFromList(listId, { include_closed: true });
            const tasks = taskRes.tasks || [];
            const now = Date.now();
            const sevenDays = 7 * 24 * 60 * 60 * 1000;
            const dwellByStatus = {};
            for (const t of tasks) {
                const s = t.status?.status || 'unknown';
                if (!dwellByStatus[s])
                    dwellByStatus[s] = { totalDays: 0, count: 0, tasks: [] };
                if (t.date_updated) {
                    const daysInStatus = (now - parseInt(t.date_updated)) / (24 * 60 * 60 * 1000);
                    dwellByStatus[s].totalDays += daysInStatus;
                    dwellByStatus[s].count++;
                    if (daysInStatus > 7) {
                        dwellByStatus[s].tasks.push({ id: t.id, name: t.name, days_in_status: Math.round(daysInStatus) });
                    }
                }
            }
            const statusMetrics = Object.entries(dwellByStatus).map(([status, data]) => ({
                status,
                task_count: data.count,
                avg_dwell_days: data.count > 0 ? Math.round((data.totalDays / data.count) * 10) / 10 : 0,
                stalled_count: data.tasks.length,
                stalled_tasks: data.tasks.sort((a, b) => b.days_in_status - a.days_in_status).slice(0, 10)
            })).sort((a, b) => b.avg_dwell_days - a.avg_dwell_days);
            const topBottleneck = statusMetrics.find(s => s.task_count >= 2 && s.avg_dwell_days > 3);
            return {
                top_bottleneck: topBottleneck ? { status: topBottleneck.status, avg_dwell_days: topBottleneck.avg_dwell_days, task_count: topBottleneck.task_count } : null,
                status_metrics: statusMetrics,
                total_stalled: statusMetrics.reduce((a, s) => a + s.stalled_count, 0)
            };
        },
        // ── Velocity ────────────────────────────────────────────────────────
        async velocity(listId) {
            const taskRes = await tasksClient.getTasksFromList(listId, { include_closed: true });
            const tasks = taskRes.tasks || [];
            const now = Date.now();
            const windows = [7, 14, 30];
            const results = {};
            for (const days of windows) {
                const cutoff = now - days * 24 * 60 * 60 * 1000;
                const completed = tasks.filter(t => {
                    const s = t.status?.status?.toLowerCase() || '';
                    return ['done', 'closed', 'complete'].includes(s) && t.date_updated && parseInt(t.date_updated) > cutoff;
                });
                const dailyAvg = completed.length / days;
                results[`completed_${days}d`] = completed.length;
                results[`daily_avg_${days}d`] = Math.round(dailyAvg * 100) / 100;
                results[`confidence_${days}d`] = completed.length >= 10 ? 'high' : completed.length >= 5 ? 'medium' : completed.length > 0 ? 'low' : 'none';
            }
            const openTasks = tasks.filter(t => {
                const s = t.status?.status?.toLowerCase() || '';
                return !['done', 'closed', 'complete'].includes(s);
            });
            const dailyAvg = results.daily_avg_7d;
            const projection = dailyAvg > 0 ? Math.round(openTasks.length / dailyAvg) : null;
            return {
                open_tasks_remaining: openTasks.length,
                projected_days_to_done: projection,
                ...results
            };
        },
        // ── Dependencies ────────────────────────────────────────────────────
        async dependencyAnalysis(listId) {
            const taskRes = await tasksClient.getTasksFromList(listId, { include_closed: true, subtasks: true });
            const tasks = taskRes.tasks || [];
            const taskMap = new Map(tasks.map(t => [t.id, t]));
            // Build upstream dependency graph
            const graph = {};
            for (const t of tasks) {
                const deps = t.dependencies || [];
                graph[t.id] = deps.map((d) => d.depends_on).filter(Boolean);
            }
            // Find chains and blocked tasks
            let totalDeps = 0, maxChainDepth = 0, circularDeps = [];
            const blockedByMap = {};
            const blocksCount = {};
            for (const t of tasks) {
                const deps = t.dependencies || [];
                totalDeps += deps.length;
                blockedByMap[t.id] = [];
                for (const d of deps) {
                    const depId = d.depends_on;
                    if (depId) {
                        blockedByMap[t.id].push(depId);
                        blocksCount[depId] = (blocksCount[depId] || 0) + 1;
                    }
                    if (depId === t.id)
                        circularDeps.push(t.id);
                }
                // Chain depth: walk upstream
                const visited = new Set();
                const stack = [...graph[t.id]];
                let depth = 0;
                while (stack.length > 0) {
                    const current = stack.pop();
                    if (visited.has(current)) {
                        circularDeps.push(t.id);
                        continue;
                    }
                    visited.add(current);
                    depth++;
                    (graph[current] || []).forEach(d => stack.push(d));
                }
                maxChainDepth = Math.max(maxChainDepth, depth);
            }
            const topBlockers = Object.entries(blocksCount)
                .map(([taskId, count]) => ({ task_id: taskId, name: taskMap.get(taskId)?.name || 'unknown', blocks_count: count }))
                .sort((a, b) => b.blocks_count - a.blocks_count)
                .slice(0, 5);
            const blockedTasks = Object.entries(blockedByMap)
                .filter(([, deps]) => deps.length > 0)
                .map(([taskId, deps]) => ({
                task_id: taskId,
                name: taskMap.get(taskId)?.name || 'unknown',
                blocked_by: deps.map(id => ({ task_id: id, name: taskMap.get(id)?.name || 'unknown', status: taskMap.get(id)?.status?.status }))
            }));
            return {
                total_dependencies: totalDeps,
                avg_deps_per_task: totalDeps > 0 ? Math.round((totalDeps / tasks.length) * 100) / 100 : 0,
                max_chain_depth: maxChainDepth,
                circular_dependencies_detected: circularDeps.length > 0,
                circular_task_ids: [...new Set(circularDeps)],
                top_blockers: topBlockers,
                blocked_task_count: blockedTasks.length,
                blocked_tasks: blockedTasks.slice(0, 20),
                dependency_graph: graph
            };
        },
        // ── Sprint Readiness ────────────────────────────────────────────────
        async sprintReadiness(listId) {
            const taskRes = await tasksClient.getTasksFromList(listId, { include_closed: true, subtasks: true });
            const tasks = taskRes.tasks || [];
            const taskMap = new Map(tasks.map(t => [t.id, t]));
            const ready = [], blocked = [], inProgress = [], holding = [];
            for (const t of tasks) {
                const s = t.status?.status?.toLowerCase() || '';
                const deps = t.dependencies || [];
                const hasBlockingDeps = deps.some((d) => {
                    const depTask = taskMap.get(d.depends_on);
                    const ds = depTask?.status?.status?.toLowerCase() || '';
                    return !['done', 'closed', 'complete'].includes(ds);
                });
                if (['done', 'closed', 'complete'].includes(s))
                    holding.push(t);
                else if (hasBlockingDeps)
                    blocked.push({ ...t, blocked_by: deps.map((d) => ({ id: d.depends_on, name: taskMap.get(d.depends_on)?.name, status: taskMap.get(d.depends_on)?.status?.status })) });
                else if (['in progress', 'in review', 'active'].includes(s))
                    inProgress.push(t);
                else
                    ready.push(t);
            }
            const totalActive = ready.length + blocked.length + inProgress.length;
            const capacityScore = totalActive > 0 ? Math.round((ready.length / totalActive) * 100) : 0;
            // Recommended sprint: ready tasks sorted by priority
            const priorityOrder = { urgent: 4, high: 3, normal: 2, low: 1 };
            const recommended = [...ready]
                .sort((a, b) => (priorityOrder[a.priority?.priority?.toLowerCase()] || 2) - (priorityOrder[b.priority?.priority?.toLowerCase()] || 2))
                .slice(0, Math.max(5, Math.round(totalActive * 0.3)));
            return {
                ready_count: ready.length,
                blocked_count: blocked.length,
                in_progress_count: inProgress.length,
                holding_count: holding.length,
                capacity_score: capacityScore,
                recommended_sprint_scope: recommended.map(t => ({ id: t.id, name: t.name, priority: t.priority?.priority })),
                blocked_details: blocked.slice(0, 15).map(t => ({
                    task_id: t.id, name: t.name, blocked_by: t.blocked_by
                }))
            };
        },
        // ── Workload ────────────────────────────────────────────────────────
        async workload(listId) {
            const taskRes = await tasksClient.getTasksFromList(listId, { include_closed: true });
            const tasks = taskRes.tasks || [];
            const workloadMap = {};
            let unassigned = 0;
            const priorityWeights = { urgent: 4, high: 3, normal: 2, low: 1 };
            for (const t of tasks) {
                const assignees = t.assignees || [];
                const s = t.status?.status?.toLowerCase() || '';
                const isClosed = ['done', 'closed', 'complete'].includes(s);
                const isBlocked = (t.dependencies?.length || 0) > 0;
                const isOverdue = t.due_date && parseInt(t.due_date) < Date.now() && !isClosed;
                const pw = priorityWeights[t.priority?.priority?.toLowerCase() || 'normal'] || 2;
                if (assignees.length === 0 && !isClosed)
                    unassigned++;
                for (const a of assignees) {
                    const name = a.username || a.id;
                    if (!workloadMap[name])
                        workloadMap[name] = { todo: 0, in_progress: 0, done: 0, blocked: 0, overdue: 0, total: 0, priority_weighted: 0 };
                    workloadMap[name].total++;
                    workloadMap[name].priority_weighted += pw;
                    if (isClosed)
                        workloadMap[name].done++;
                    else if (isBlocked)
                        workloadMap[name].blocked++;
                    else if (['in progress', 'in review', 'active'].includes(s))
                        workloadMap[name].in_progress++;
                    else
                        workloadMap[name].todo++;
                    if (isOverdue)
                        workloadMap[name].overdue++;
                }
            }
            const assignees = Object.entries(workloadMap).map(([name, data]) => ({ name, ...data }));
            const activeCount = assignees.filter(a => a.in_progress > 0 || a.todo > 0).length;
            const avgLoad = activeCount > 0 ? Math.round(assignees.reduce((a, u) => a + u.in_progress, 0) / activeCount * 10) / 10 : 0;
            const overloaded = assignees.filter(a => a.in_progress > avgLoad * 1.5);
            return {
                assignees,
                unassigned_active_tasks: unassigned,
                avg_in_progress_per_assignee: avgLoad,
                overloaded_assignees: overloaded.map(a => ({ name: a.name, in_progress: a.in_progress, threshold: Math.round(avgLoad * 1.5 * 10) / 10 }))
            };
        },
        // ── Risk ────────────────────────────────────────────────────────────
        async risk(listId) {
            const taskRes = await tasksClient.getTasksFromList(listId, { include_closed: true, subtasks: true });
            const tasks = taskRes.tasks || [];
            const taskMap = new Map(tasks.map(t => [t.id, t]));
            const now = Date.now();
            const riskScores = [];
            let highCount = 0, mediumCount = 0, lowCount = 0;
            const driverCounts = { overdue: 0, blocked: 0, stale: 0, high_priority: 0, deep_dependency: 0 };
            for (const t of tasks) {
                const s = t.status?.status?.toLowerCase() || '';
                if (['done', 'closed', 'complete'].includes(s))
                    continue;
                let score = 0;
                const drivers = [];
                // Overdue (30%)
                if (t.due_date && parseInt(t.due_date) < now) {
                    score += 30;
                    drivers.push('overdue');
                    driverCounts.overdue++;
                }
                // Blocked (25%)
                const deps = t.dependencies || [];
                const hasBlockingDeps = deps.some((d) => {
                    const dt = taskMap.get(d.depends_on);
                    const ds = dt?.status?.status?.toLowerCase() || '';
                    return !['done', 'closed', 'complete'].includes(ds);
                });
                if (hasBlockingDeps) {
                    score += 25;
                    drivers.push('blocked');
                    driverCounts.blocked++;
                }
                // Stale (20%)
                if (t.date_updated && (now - parseInt(t.date_updated)) > 7 * 24 * 60 * 60 * 1000) {
                    score += 20;
                    drivers.push('stale');
                    driverCounts.stale++;
                }
                // High priority (15%)
                const p = t.priority?.priority?.toLowerCase();
                if (p === 'urgent' || p === 'high') {
                    score += 15;
                    drivers.push('high_priority');
                    driverCounts.high_priority++;
                }
                // Deep dependency chain (10%)
                const chainDeps = deps.filter((d) => {
                    const dt = taskMap.get(d.depends_on);
                    const subDeps = dt?.dependencies || [];
                    return subDeps.length > 0;
                });
                if (chainDeps.length > 0) {
                    score += 10;
                    drivers.push('deep_dependency');
                    driverCounts.deep_dependency++;
                }
                riskScores.push({
                    task_id: t.id, name: t.name, status: t.status?.status,
                    risk_score: score, risk_level: score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
                    drivers
                });
                if (score >= 50)
                    highCount++;
                else if (score >= 25)
                    mediumCount++;
                else
                    lowCount++;
            }
            const sorted = riskScores.sort((a, b) => b.risk_score - a.risk_score);
            const topDriver = Object.entries(driverCounts).sort((a, b) => b[1] - a[1])[0];
            return {
                total_risks_analyzed: riskScores.length,
                high_risk_count: highCount,
                medium_risk_count: mediumCount,
                low_risk_count: lowCount,
                top_risk_driver: topDriver ? { driver: topDriver[0], count: topDriver[1] } : null,
                high_risk_tasks: sorted.filter(t => t.risk_level === 'high').slice(0, 15),
                medium_risk_tasks: sorted.filter(t => t.risk_level === 'medium').slice(0, 10),
                all_risk_scores: sorted
            };
        },
        // ── Time Report ─────────────────────────────────────────────────────
        async timeReport(listId, start_date, end_date) {
            // Get list to derive workspace
            const list = await listsClient.getList(listId);
            const workspaceId = list.team_id || list.workspace_id || '';
            // Build task name map
            const taskRes = await tasksClient.getTasksFromList(listId);
            const taskMap = new Map((taskRes.tasks || []).map((t) => [t.id, t.name]));
            // Get time entries
            const params = {};
            if (start_date)
                params.start_date = start_date;
            if (end_date)
                params.end_date = end_date;
            const entries = await timeTrackingClient.getTimeEntries(workspaceId, params);
            const entryList = entries.data || entries || [];
            let totalMs = 0;
            const perPerson = {};
            const perTask = {};
            const perDay = {};
            for (const entry of entryList) {
                const duration = entry.duration || 0;
                totalMs += duration;
                const assignee = entry.user?.username || 'Unassigned';
                perPerson[assignee] = (perPerson[assignee] || 0) + duration;
                const tid = entry.task?.id;
                const taskName = tid ? (taskMap.get(tid) || entry.task?.name || 'Unknown') : 'Unknown';
                perTask[taskName] = (perTask[taskName] || 0) + duration;
                if (entry.start) {
                    const day = new Date(parseInt(entry.start)).toISOString().split('T')[0];
                    perDay[day] = (perDay[day] || 0) + duration;
                }
            }
            const daysWithEntries = Object.keys(perDay).length;
            return {
                total_hours: Math.round(totalMs / 3600000 * 100) / 100,
                days_tracked: daysWithEntries,
                avg_hours_per_day: daysWithEntries > 0
                    ? Math.round(totalMs / 3600000 / daysWithEntries * 100) / 100 : 0,
                hours_per_person: Object.entries(perPerson)
                    .map(([name, ms]) => ({ name, hours: Math.round(ms / 3600000 * 100) / 100 }))
                    .sort((a, b) => b.hours - a.hours),
                hours_per_task: Object.entries(perTask)
                    .map(([name, ms]) => ({ name, hours: Math.round(ms / 3600000 * 100) / 100 }))
                    .sort((a, b) => b.hours - a.hours),
                hours_per_day: Object.entries(perDay)
                    .map(([day, ms]) => ({ day, hours: Math.round(ms / 3600000 * 100) / 100 }))
                    .sort((a, b) => a.day.localeCompare(b.day)),
            };
        }
    };
}
//# sourceMappingURL=project-intelligence.js.map