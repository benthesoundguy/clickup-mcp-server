import { createClickUpClient, getAllPages } from './index.js';
import { createTasksClient, Task } from './tasks.js';
import { createListsClient } from './lists.js';
import { createTimeTrackingClient } from './time-tracking.js';

// Project intelligence: analytics computed locally over live ClickUp data.
//
// Correctness principles (Phase 5 rebuild):
// - ALL task pages are fetched (not just the first 100); when the safety cap
//   is hit, every report carries data_complete: false instead of silently
//   reporting numbers computed from a partial slice.
// - Closed/complete detection uses the list's own status TYPE metadata
//   ("done" / "closed"), not a hardcoded list of English status names —
//   custom workflows like "Shipped" or "Live" are classified correctly.
// - The computation functions are pure (tasks + statuses + now in, report
//   out) and exported for unit testing against fixtures.

const clickUpClient = createClickUpClient();
const tasksClient = createTasksClient(clickUpClient);
const listsClient = createListsClient(clickUpClient);
const timeTrackingClient = createTimeTrackingClient(clickUpClient);

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

// ── Status classification ──────────────────────────────────────────────

export interface ListStatus {
  status: string;
  type?: string;      // 'open' | 'custom' | 'done' | 'closed'
  orderindex?: number;
  color?: string;
}

export type StatusClass = 'complete' | 'in_progress' | 'open';

// Name-based fallback used only when the list's status metadata is missing.
const FALLBACK_COMPLETE = ['done', 'closed', 'complete', 'shipped', 'resolved'];
const FALLBACK_IN_PROGRESS = ['in progress', 'in review', 'active', 'doing'];

/**
 * Classify a task status using the list's status-type metadata.
 * ClickUp status types: open → custom (anything between) → done/closed.
 */
export function classifyStatus(statusName: string | undefined, listStatuses: ListStatus[]): StatusClass {
  const name = (statusName ?? '').toLowerCase();
  const meta = listStatuses.find(s => s.status?.toLowerCase() === name);
  if (meta?.type) {
    if (meta.type === 'done' || meta.type === 'closed') return 'complete';
    if (meta.type === 'custom') return 'in_progress';
    return 'open';
  }
  // Fallback for tasks whose status is not in the list metadata
  if (FALLBACK_COMPLETE.includes(name)) return 'complete';
  if (FALLBACK_IN_PROGRESS.includes(name)) return 'in_progress';
  return 'open';
}

const isComplete = (t: Task, statuses: ListStatus[]) =>
  classifyStatus(t.status?.status, statuses) === 'complete';

// ── Data loading ───────────────────────────────────────────────────────

export interface ListData {
  tasks: Task[];
  statuses: ListStatus[];
  complete: boolean;
}

async function loadListData(listId: string, opts: { subtasks?: boolean } = {}): Promise<ListData> {
  const list: any = await listsClient.getList(listId);
  const statuses: ListStatus[] = list?.statuses ?? [];
  const paged = await getAllPages<Task>(
    async (page) => ({
      items: (await tasksClient.getTasksFromList(listId, {
        include_closed: true,
        subtasks: opts.subtasks,
        page
      })).tasks ?? []
    }),
    { pageSize: 100, maxPages: 30 }
  );
  return { tasks: paged.items, statuses, complete: paged.complete };
}

// ── Pure computations (exported for tests) ─────────────────────────────

export function computeHealth(tasks: Task[], statuses: ListStatus[], now: number) {
  const statusDist: Record<string, { count: number; percentage: string }> = {};
  let openCount = 0, closedCount = 0, blockedCount = 0, overdueCount = 0, staleCount = 0;
  let recentCompleted = 0;

  for (const t of tasks) {
    const s = t.status?.status || 'unknown';
    statusDist[s] = statusDist[s] || { count: 0, percentage: '0' };
    statusDist[s].count++;

    const closed = isComplete(t, statuses);
    if (closed) closedCount++;
    else openCount++;

    if (!closed) {
      if (t.due_date && parseInt(t.due_date) < now) overdueCount++;
      if (t.date_updated && (now - parseInt(t.date_updated)) > SEVEN_DAYS_MS) staleCount++;
      if (((t as any).dependencies?.length || 0) > 0) blockedCount++;
    }
    if (closed && t.date_updated && (now - parseInt(t.date_updated)) < SEVEN_DAYS_MS) {
      recentCompleted++;
    }
  }

  const total = tasks.length || 1;
  Object.keys(statusDist).forEach(k => {
    statusDist[k].percentage = ((statusDist[k].count / total) * 100).toFixed(1);
  });

  const completionRate = (closedCount / total) * 100;
  const blockedRate = (blockedCount / total) * 100;
  const overdueRate = (overdueCount / total) * 100;
  const staleRate = (staleCount / total) * 100;

  const healthScore = Math.round(
    completionRate * 0.4 +
    (100 - blockedRate) * 0.3 +
    (100 - overdueRate) * 0.2 +
    (100 - staleRate) * 0.1
  );
  const grade = healthScore >= 85 ? 'A' : healthScore >= 70 ? 'B' : healthScore >= 55 ? 'C' : healthScore >= 40 ? 'D' : 'F';

  return {
    health_score: tasks.length ? healthScore : null,
    health_grade: tasks.length ? grade : null,
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
      priority: t.priority?.priority, assignees: t.assignees?.map((a: any) => a.username || a.id),
      due_date: t.due_date, blocked: ((t as any).dependencies?.length || 0) > 0
    }))
  };
}

export function computeBottlenecks(tasks: Task[], statuses: ListStatus[], now: number) {
  const dwellByStatus: Record<string, { totalDays: number; count: number; tasks: any[] }> = {};

  for (const t of tasks) {
    if (isComplete(t, statuses)) continue; // finished tasks aren't stuck
    const s = t.status?.status || 'unknown';
    if (!dwellByStatus[s]) dwellByStatus[s] = { totalDays: 0, count: 0, tasks: [] };

    if (t.date_updated) {
      const daysInStatus = (now - parseInt(t.date_updated)) / DAY_MS;
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
    top_bottleneck: topBottleneck
      ? { status: topBottleneck.status, avg_dwell_days: topBottleneck.avg_dwell_days, task_count: topBottleneck.task_count }
      : null,
    status_metrics: statusMetrics,
    total_stalled: statusMetrics.reduce((a, s) => a + s.stalled_count, 0)
  };
}

export function computeVelocity(tasks: Task[], statuses: ListStatus[], now: number) {
  const results: any = {};
  for (const days of [7, 14, 30]) {
    const cutoff = now - days * DAY_MS;
    const completed = tasks.filter(t =>
      isComplete(t, statuses) && t.date_updated && parseInt(t.date_updated) > cutoff
    );
    results[`completed_${days}d`] = completed.length;
    results[`daily_avg_${days}d`] = Math.round((completed.length / days) * 100) / 100;
    results[`confidence_${days}d`] = completed.length >= 10 ? 'high' : completed.length >= 5 ? 'medium' : completed.length > 0 ? 'low' : 'none';
  }

  const openTasks = tasks.filter(t => !isComplete(t, statuses));
  const dailyAvg = results.daily_avg_7d;
  const projection = dailyAvg > 0 ? Math.round(openTasks.length / dailyAvg) : null;

  return {
    open_tasks_remaining: openTasks.length,
    projected_days_to_done: projection,
    ...results
  };
}

export function computeDependencyAnalysis(tasks: Task[]) {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const graph: Record<string, string[]> = {};
  for (const t of tasks) {
    const deps = (t as any).dependencies || [];
    graph[t.id] = deps.map((d: any) => d.depends_on).filter(Boolean);
  }

  let totalDeps = 0, maxChainDepth = 0;
  const circularDeps: string[] = [];
  const blockedByMap: Record<string, string[]> = {};
  const blocksCount: Record<string, number> = {};

  for (const t of tasks) {
    const deps = (t as any).dependencies || [];
    totalDeps += deps.length;
    blockedByMap[t.id] = [];
    for (const d of deps) {
      const depId = d.depends_on;
      if (depId) {
        blockedByMap[t.id].push(depId);
        blocksCount[depId] = (blocksCount[depId] || 0) + 1;
      }
      if (depId === t.id) circularDeps.push(t.id);
    }

    // Chain depth: walk upstream; revisiting a node = cycle
    const visited = new Set<string>();
    const stack = [...graph[t.id]];
    let depth = 0;
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) { circularDeps.push(t.id); continue; }
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
    avg_deps_per_task: tasks.length > 0 ? Math.round((totalDeps / tasks.length) * 100) / 100 : 0,
    max_chain_depth: maxChainDepth,
    circular_dependencies_detected: circularDeps.length > 0,
    circular_task_ids: [...new Set(circularDeps)],
    top_blockers: topBlockers,
    blocked_task_count: blockedTasks.length,
    blocked_tasks: blockedTasks.slice(0, 20),
    dependency_graph: graph
  };
}

export function computeSprintReadiness(tasks: Task[], statuses: ListStatus[]) {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const ready: any[] = [], blocked: any[] = [], inProgress: any[] = [], holding: any[] = [];

  for (const t of tasks) {
    const cls = classifyStatus(t.status?.status, statuses);
    const deps = (t as any).dependencies || [];
    const hasBlockingDeps = deps.some((d: any) => {
      const depTask = taskMap.get(d.depends_on);
      return depTask ? !isComplete(depTask, statuses) : false;
    });

    if (cls === 'complete') holding.push(t);
    else if (hasBlockingDeps) blocked.push({
      ...t,
      blocked_by: deps.map((d: any) => ({ id: d.depends_on, name: taskMap.get(d.depends_on)?.name, status: taskMap.get(d.depends_on)?.status?.status }))
    });
    else if (cls === 'in_progress') inProgress.push(t);
    else ready.push(t);
  }

  const totalActive = ready.length + blocked.length + inProgress.length;
  const capacityScore = totalActive > 0 ? Math.round((ready.length / totalActive) * 100) : 0;

  const priorityOrder: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4 };
  const recommended = [...ready]
    .sort((a, b) =>
      (priorityOrder[a.priority?.priority?.toLowerCase()] || 3) -
      (priorityOrder[b.priority?.priority?.toLowerCase()] || 3))
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
}

export function computeWorkload(tasks: Task[], statuses: ListStatus[], now: number) {
  const workloadMap: Record<string, { todo: number; in_progress: number; done: number; blocked: number; overdue: number; total: number; priority_weighted: number }> = {};
  let unassigned = 0;
  const priorityWeights: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 };

  for (const t of tasks) {
    const assignees = (t as any).assignees || [];
    const cls = classifyStatus(t.status?.status, statuses);
    const closed = cls === 'complete';
    const isBlocked = ((t as any).dependencies?.length || 0) > 0;
    const isOverdue = t.due_date && parseInt(t.due_date) < now && !closed;
    const pw = priorityWeights[t.priority?.priority?.toLowerCase() || 'normal'] || 2;

    if (assignees.length === 0 && !closed) unassigned++;

    for (const a of assignees) {
      const name = a.username || a.id;
      if (!workloadMap[name]) workloadMap[name] = { todo: 0, in_progress: 0, done: 0, blocked: 0, overdue: 0, total: 0, priority_weighted: 0 };
      workloadMap[name].total++;
      workloadMap[name].priority_weighted += pw;
      if (closed) workloadMap[name].done++;
      else if (isBlocked) workloadMap[name].blocked++;
      else if (cls === 'in_progress') workloadMap[name].in_progress++;
      else workloadMap[name].todo++;
      if (isOverdue) workloadMap[name].overdue++;
    }
  }

  const assignees = Object.entries(workloadMap).map(([name, data]) => ({ name, ...data }));
  const activeCount = assignees.filter(a => a.in_progress > 0 || a.todo > 0).length;
  const avgLoad = activeCount > 0 ? Math.round(assignees.reduce((a, u) => a + u.in_progress, 0) / activeCount * 10) / 10 : 0;
  const overloaded = assignees.filter(a => avgLoad > 0 && a.in_progress > avgLoad * 1.5);

  return {
    assignees,
    unassigned_active_tasks: unassigned,
    avg_in_progress_per_assignee: avgLoad,
    overloaded_assignees: overloaded.map(a => ({ name: a.name, in_progress: a.in_progress, threshold: Math.round(avgLoad * 1.5 * 10) / 10 }))
  };
}

export function computeRisk(tasks: Task[], statuses: ListStatus[], now: number) {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const riskScores: any[] = [];
  let highCount = 0, mediumCount = 0, lowCount = 0;
  const driverCounts: Record<string, number> = { overdue: 0, blocked: 0, stale: 0, high_priority: 0, deep_dependency: 0 };

  for (const t of tasks) {
    if (isComplete(t, statuses)) continue;

    let score = 0;
    const drivers: string[] = [];

    if (t.due_date && parseInt(t.due_date) < now) { score += 30; drivers.push('overdue'); driverCounts.overdue++; }

    const deps = (t as any).dependencies || [];
    const hasBlockingDeps = deps.some((d: any) => {
      const dt = taskMap.get(d.depends_on);
      return dt ? !isComplete(dt, statuses) : false;
    });
    if (hasBlockingDeps) { score += 25; drivers.push('blocked'); driverCounts.blocked++; }

    if (t.date_updated && (now - parseInt(t.date_updated)) > SEVEN_DAYS_MS) { score += 20; drivers.push('stale'); driverCounts.stale++; }

    const p = t.priority?.priority?.toLowerCase();
    if (p === 'urgent' || p === 'high') { score += 15; drivers.push('high_priority'); driverCounts.high_priority++; }

    const chainDeps = deps.filter((d: any) => (((taskMap.get(d.depends_on) as any)?.dependencies) || []).length > 0);
    if (chainDeps.length > 0) { score += 10; drivers.push('deep_dependency'); driverCounts.deep_dependency++; }

    riskScores.push({
      task_id: t.id, name: t.name, status: t.status?.status,
      risk_score: score, risk_level: score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      drivers
    });

    if (score >= 50) highCount++;
    else if (score >= 25) mediumCount++;
    else lowCount++;
  }

  const sorted = riskScores.sort((a, b) => b.risk_score - a.risk_score);
  const topDriver = Object.entries(driverCounts).sort((a, b) => b[1] - a[1])[0];

  return {
    total_risks_analyzed: riskScores.length,
    high_risk_count: highCount,
    medium_risk_count: mediumCount,
    low_risk_count: lowCount,
    top_risk_driver: topDriver && topDriver[1] > 0 ? { driver: topDriver[0], count: topDriver[1] } : null,
    high_risk_tasks: sorted.filter(t => t.risk_level === 'high').slice(0, 15),
    medium_risk_tasks: sorted.filter(t => t.risk_level === 'medium').slice(0, 10),
    all_risk_scores: sorted
  };
}

// ── Client (fetches data, delegates to pure functions) ─────────────────

export function createProjectIntelligenceClient() {
  const withMeta = (report: object, data: ListData) => ({
    ...report,
    data_complete: data.complete,
    ...(data.complete ? {} : { warning: 'Task list exceeded the page cap; metrics are computed from a partial dataset.' })
  });

  return {
    async health(listId: string) {
      const data = await loadListData(listId);
      return withMeta(computeHealth(data.tasks, data.statuses, Date.now()), data);
    },

    async bottlenecks(listId: string) {
      const data = await loadListData(listId);
      return withMeta(computeBottlenecks(data.tasks, data.statuses, Date.now()), data);
    },

    async velocity(listId: string) {
      const data = await loadListData(listId);
      return withMeta(computeVelocity(data.tasks, data.statuses, Date.now()), data);
    },

    async dependencyAnalysis(listId: string) {
      const data = await loadListData(listId, { subtasks: true });
      return withMeta(computeDependencyAnalysis(data.tasks), data);
    },

    async sprintReadiness(listId: string) {
      const data = await loadListData(listId, { subtasks: true });
      return withMeta(computeSprintReadiness(data.tasks, data.statuses), data);
    },

    async workload(listId: string) {
      const data = await loadListData(listId);
      return withMeta(computeWorkload(data.tasks, data.statuses, Date.now()), data);
    },

    async risk(listId: string) {
      const data = await loadListData(listId, { subtasks: true });
      return withMeta(computeRisk(data.tasks, data.statuses, Date.now()), data);
    },

    async timeReport(listId: string, start_date?: string, end_date?: string) {
      const list = await listsClient.getList(listId);
      const workspaceId = (list as any).team_id || (list as any).workspace_id || '';

      const data = await loadListData(listId);
      const taskMap = new Map(data.tasks.map((t: any) => [t.id, t.name]));

      const params: any = {};
      if (start_date) params.start_date = start_date;
      if (end_date) params.end_date = end_date;
      const entries: any = await timeTrackingClient.getTimeEntries(workspaceId, params);

      const entryList = entries.data || entries || [];
      let totalMs = 0;
      const perPerson: Record<string, number> = {};
      const perTask: Record<string, number> = {};
      const perDay: Record<string, number> = {};

      for (const entry of entryList) {
        const duration = Number(entry.duration) || 0;
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
      const toHours = (ms: number) => Math.round(ms / 3600000 * 100) / 100;

      return {
        total_hours: toHours(totalMs),
        days_tracked: daysWithEntries,
        avg_hours_per_day: daysWithEntries > 0 ? toHours(totalMs / daysWithEntries) : 0,
        hours_per_person: Object.entries(perPerson)
          .map(([name, ms]) => ({ name, hours: toHours(ms as number) }))
          .sort((a, b) => b.hours - a.hours),
        hours_per_task: Object.entries(perTask)
          .map(([name, ms]) => ({ name, hours: toHours(ms as number) }))
          .sort((a, b) => b.hours - a.hours),
        hours_per_day: Object.entries(perDay)
          .map(([day, ms]) => ({ day, hours: toHours(ms as number) }))
          .sort((a, b) => a.day.localeCompare(b.day)),
        data_complete: data.complete,
      };
    }
  };
}
