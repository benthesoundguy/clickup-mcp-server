// Phase 5 tests: project intelligence math on fixtures — custom statuses,
// >100-task datasets, dependency cycles, edge cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyStatus,
  computeHealth,
  computeBottlenecks,
  computeVelocity,
  computeDependencyAnalysis,
  computeSprintReadiness,
  computeWorkload,
  computeRisk,
} from '../build/clickup-client/project-intelligence.js';

const NOW = 1_720_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

// Custom workflow: nothing here matches the old hardcoded English names
// ('done', 'closed', 'complete') except by type metadata.
const CUSTOM_STATUSES = [
  { status: 'Backlog', type: 'open', orderindex: 0 },
  { status: 'Building', type: 'custom', orderindex: 1 },
  { status: 'QA Pass', type: 'custom', orderindex: 2 },
  { status: 'Shipped 🚀', type: 'done', orderindex: 3 },
  { status: 'Archived', type: 'closed', orderindex: 4 },
];

const mkTask = (over = {}) => ({
  id: over.id ?? 'T' + Math.random().toString(36).slice(2, 8),
  name: over.name ?? 'task',
  status: { status: over.status ?? 'Backlog' },
  date_updated: String(over.updated ?? NOW - DAY),
  due_date: over.due !== undefined ? String(over.due) : null,
  priority: over.priority ? { priority: over.priority } : undefined,
  assignees: over.assignees ?? [],
  dependencies: over.deps?.map(d => ({ depends_on: d })) ?? [],
  ...over.extra,
});

// ── classifyStatus ─────────────────────────────────────────────────────

test('classifyStatus uses status TYPE metadata, not names', () => {
  assert.equal(classifyStatus('Shipped 🚀', CUSTOM_STATUSES), 'complete');
  assert.equal(classifyStatus('Archived', CUSTOM_STATUSES), 'complete');
  assert.equal(classifyStatus('Building', CUSTOM_STATUSES), 'in_progress');
  assert.equal(classifyStatus('QA Pass', CUSTOM_STATUSES), 'in_progress');
  assert.equal(classifyStatus('Backlog', CUSTOM_STATUSES), 'open');
});

test('classifyStatus falls back to names when metadata is missing', () => {
  assert.equal(classifyStatus('done', []), 'complete');
  assert.equal(classifyStatus('in progress', []), 'in_progress');
  assert.equal(classifyStatus('todo', []), 'open');
});

// ── health ─────────────────────────────────────────────────────────────

test('health counts custom done-type statuses as closed', () => {
  const tasks = [
    mkTask({ status: 'Shipped 🚀' }),
    mkTask({ status: 'Shipped 🚀' }),
    mkTask({ status: 'Building' }),
    mkTask({ status: 'Backlog' }),
  ];
  const h = computeHealth(tasks, CUSTOM_STATUSES, NOW);
  assert.equal(h.closed_tasks, 2);
  assert.equal(h.open_tasks, 2);
  assert.equal(h.completion_rate, 50);
});

test('health on an empty list yields null score, zero counts', () => {
  const h = computeHealth([], CUSTOM_STATUSES, NOW);
  assert.equal(h.health_score, null);
  assert.equal(h.total_tasks, 0);
  assert.equal(h.completion_rate, 0);
});

test('health handles 250-task dataset (larger than one API page)', () => {
  const tasks = [
    ...Array.from({ length: 150 }, (_, i) => mkTask({ id: 'done' + i, status: 'Shipped 🚀' })),
    ...Array.from({ length: 100 }, (_, i) => mkTask({ id: 'open' + i, status: 'Building' })),
  ];
  const h = computeHealth(tasks, CUSTOM_STATUSES, NOW);
  assert.equal(h.total_tasks, 250);
  assert.equal(h.closed_tasks, 150);
  assert.equal(h.completion_rate, 60);
});

test('health flags overdue and stale only for open tasks', () => {
  const tasks = [
    mkTask({ status: 'Shipped 🚀', due: NOW - DAY, updated: NOW - 30 * DAY }), // closed: never overdue/stale
    mkTask({ status: 'Building', due: NOW - DAY }),                            // overdue
    mkTask({ status: 'Backlog', updated: NOW - 10 * DAY }),                    // stale
  ];
  const h = computeHealth(tasks, CUSTOM_STATUSES, NOW);
  assert.equal(h.overdue_rate, Math.round(1 / 3 * 1000) / 10);
  assert.equal(h.stale_rate, Math.round(1 / 3 * 1000) / 10);
});

// ── bottlenecks ────────────────────────────────────────────────────────

test('bottlenecks ignores completed tasks and finds the stuck status', () => {
  const tasks = [
    mkTask({ status: 'QA Pass', updated: NOW - 12 * DAY }),
    mkTask({ status: 'QA Pass', updated: NOW - 9 * DAY }),
    mkTask({ status: 'Building', updated: NOW - 1 * DAY }),
    mkTask({ status: 'Shipped 🚀', updated: NOW - 100 * DAY }), // completed: not a bottleneck
  ];
  const b = computeBottlenecks(tasks, CUSTOM_STATUSES, NOW);
  assert.equal(b.top_bottleneck.status, 'QA Pass');
  assert.equal(b.total_stalled, 2);
  assert.ok(!b.status_metrics.find(m => m.status === 'Shipped 🚀'));
});

// ── velocity ───────────────────────────────────────────────────────────

test('velocity counts custom-status completions in windows', () => {
  const tasks = [
    mkTask({ status: 'Shipped 🚀', updated: NOW - 2 * DAY }),
    mkTask({ status: 'Shipped 🚀', updated: NOW - 10 * DAY }),
    mkTask({ status: 'Archived', updated: NOW - 20 * DAY }),
    mkTask({ status: 'Building', updated: NOW - 1 * DAY }),
  ];
  const v = computeVelocity(tasks, CUSTOM_STATUSES, NOW);
  assert.equal(v.completed_7d, 1);
  assert.equal(v.completed_14d, 2);
  assert.equal(v.completed_30d, 3);
  assert.equal(v.open_tasks_remaining, 1);
});

test('velocity with zero completions projects null, confidence none', () => {
  const v = computeVelocity([mkTask({ status: 'Backlog' })], CUSTOM_STATUSES, NOW);
  assert.equal(v.projected_days_to_done, null);
  assert.equal(v.confidence_7d, 'none');
});

// ── dependencies ───────────────────────────────────────────────────────

test('dependency analysis finds blockers and cycles', () => {
  const tasks = [
    mkTask({ id: 'A', name: 'A', deps: ['B'] }),
    mkTask({ id: 'B', name: 'B', deps: ['C'] }),
    mkTask({ id: 'C', name: 'C', deps: ['A'] }), // cycle A→B→C→A
    mkTask({ id: 'D', name: 'D', deps: ['B'] }),
  ];
  const d = computeDependencyAnalysis(tasks);
  assert.equal(d.total_dependencies, 4);
  assert.equal(d.circular_dependencies_detected, true);
  assert.equal(d.top_blockers[0].task_id, 'B'); // blocks A and D
  assert.equal(d.top_blockers[0].blocks_count, 2);
  assert.equal(d.blocked_task_count, 4);
});

test('dependency analysis on task set with no deps', () => {
  const d = computeDependencyAnalysis([mkTask({}), mkTask({})]);
  assert.equal(d.total_dependencies, 0);
  assert.equal(d.circular_dependencies_detected, false);
  assert.equal(d.max_chain_depth, 0);
});

// ── sprint readiness ───────────────────────────────────────────────────

test('sprint readiness classifies ready/blocked/in-progress/holding via status types', () => {
  const tasks = [
    mkTask({ id: 'done1', status: 'Shipped 🚀' }),                    // holding
    mkTask({ id: 'wip1', status: 'Building' }),                       // in progress
    mkTask({ id: 'ready1', status: 'Backlog', priority: 'urgent' }),  // ready
    mkTask({ id: 'blk1', status: 'Backlog', deps: ['wip1'] }),        // blocked (dep not complete)
    mkTask({ id: 'ok1', status: 'Backlog', deps: ['done1'] }),        // ready (dep complete)
  ];
  const s = computeSprintReadiness(tasks, CUSTOM_STATUSES);
  assert.equal(s.holding_count, 1);
  assert.equal(s.in_progress_count, 1);
  assert.equal(s.blocked_count, 1);
  assert.equal(s.ready_count, 2);
  // urgent task recommended first
  assert.equal(s.recommended_sprint_scope[0].id, 'ready1');
});

// ── workload ───────────────────────────────────────────────────────────

test('workload aggregates per assignee with custom statuses', () => {
  const ben = { id: 1, username: 'ben' };
  const ana = { id: 2, username: 'ana' };
  const tasks = [
    mkTask({ status: 'Building', assignees: [ben] }),
    mkTask({ status: 'Building', assignees: [ben] }),
    mkTask({ status: 'Shipped 🚀', assignees: [ben] }),
    mkTask({ status: 'Backlog', assignees: [ana] }),
    mkTask({ status: 'Backlog' }), // unassigned + open
  ];
  const w = computeWorkload(tasks, CUSTOM_STATUSES, NOW);
  const benRow = w.assignees.find(a => a.name === 'ben');
  assert.equal(benRow.in_progress, 2);
  assert.equal(benRow.done, 1);
  assert.equal(w.unassigned_active_tasks, 1);
});

// ── risk ───────────────────────────────────────────────────────────────

test('risk scores drivers and skips completed tasks', () => {
  const tasks = [
    mkTask({ id: 'r1', status: 'Building', due: NOW - DAY, updated: NOW - 10 * DAY, priority: 'urgent' }), // overdue+stale+priority = 65
    mkTask({ id: 'r2', status: 'Backlog' }),                                                               // 0
    mkTask({ id: 'done', status: 'Shipped 🚀', due: NOW - DAY }),                                          // excluded
  ];
  const r = computeRisk(tasks, CUSTOM_STATUSES, NOW);
  assert.equal(r.total_risks_analyzed, 2);
  assert.equal(r.high_risk_count, 1);
  const top = r.high_risk_tasks[0];
  assert.equal(top.task_id, 'r1');
  assert.equal(top.risk_score, 65);
  assert.deepEqual(top.drivers.sort(), ['high_priority', 'overdue', 'stale']);
});
