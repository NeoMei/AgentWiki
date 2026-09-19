import { randomBytes } from 'node:crypto';
import { BusinessException } from '../core/filters/business-error';

export const TASKBOARD_STATUSES = [
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'canceled',
  'unknown',
] as const;
export type TaskboardStatus = (typeof TASKBOARD_STATUSES)[number];

export const TASKBOARD_KINDS = [
  'phase',
  'module',
  'capability',
  'plan',
  'step',
  'task',
  'implementation_task',
  'work_item',
] as const;
export type TaskboardKind = (typeof TASKBOARD_KINDS)[number];

export const TASKBOARD_CONCRETE_KINDS = new Set<string>(['task', 'implementation_task']);

export interface TaskboardStatusHistoryEntry {
  from: string | null;
  to: string | null;
  at: string;
}

/** Wire format task: mirrors the flat snake_case dict used by project-taskboard. */
export interface TaskboardTask {
  id: string;
  title: string;
  parent_id?: string | null;
  kind?: string;
  status?: string;
  scope_class?: string | null;
  owner?: string | null;
  summary?: string | null;
  description?: string | null;
  current_step?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  status_history?: TaskboardStatusHistoryEntry[];
  [extra: string]: unknown;
}

export interface TaskboardBoard {
  schema_version: number;
  project: string;
  source_type: string;
  sources: string[];
  updated_at: string | null;
  tasks: TaskboardTask[];
}

export const TASKBOARD_MUTABLE_FIELDS = new Set<string>([
  'title',
  'parent_id',
  'kind',
  'status',
  'owner',
  'scope_class',
  'description',
  'summary',
  'source',
  'next_step',
  'current_step',
  'started_at',
  'completed_at',
  'planned_start',
  'planned_end',
  'due_at',
  'stages',
  'labels',
  'agent_id',
  'run_id',
  'session_id',
  'worktree',
  'branch',
  'evidence',
  'external_id',
  'required_denominator',
  'criteria',
  'acceptance',
  'depends_on',
  'audited_at',
  'evidence_type',
  'platform',
  'spec_source',
  'plan_source',
  'scope',
  'blocker',
]);

const COLUMN_FIELD_SET = new Set<string>([
  'id',
  'title',
  'parent_id',
  'kind',
  'status',
  'scope_class',
  'owner',
  'summary',
  'description',
  'current_step',
  'started_at',
  'completed_at',
  'created_at',
  'updated_at',
  'status_history',
]);

export function isTaskboardStatus(value: unknown): value is TaskboardStatus {
  return typeof value === 'string' && (TASKBOARD_STATUSES as readonly string[]).includes(value);
}

export function isTaskboardKind(value: unknown): value is TaskboardKind {
  return typeof value === 'string' && (TASKBOARD_KINDS as readonly string[]).includes(value);
}

export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function invalid(message: string): BusinessException {
  return new BusinessException('TASKBOARD_INVALID', message);
}

/** Port of project-taskboard make_task. */
export function makeTaskboardTask(
  payload: Record<string, unknown>,
  parentId?: string | null,
): TaskboardTask {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalid('任务请求体必须是 JSON 对象');
  }
  const title = String(payload.title ?? '').trim();
  if (!title) throw invalid('title 不能为空');
  const task: TaskboardTask = { id: '', title };
  for (const field of TASKBOARD_MUTABLE_FIELDS) {
    if (field === 'title') continue;
    if (field in payload) task[field] = payload[field];
  }
  const requestedId = typeof payload.id === 'string' ? payload.id.trim() : '';
  task.id = requestedId || `task-${randomBytes(5).toString('hex')}`;
  task.parent_id = parentId !== undefined && parentId !== null ? parentId : (task.parent_id ?? null);
  if (!task.kind) task.kind = 'task';
  if (!task.status) task.status = 'todo';
  task.created_at = typeof payload.created_at === 'string' ? payload.created_at : isoNow();
  task.updated_at = isoNow();
  return task;
}

/** Port of project-taskboard apply_patch. */
export function applyTaskboardPatch(
  task: TaskboardTask,
  patch: Record<string, unknown>,
): TaskboardTask {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw invalid('更新请求体必须是 JSON 对象');
  }
  const unknown = Object.keys(patch)
    .filter((key) => !TASKBOARD_MUTABLE_FIELDS.has(key))
    .sort();
  if (unknown.length > 0) throw invalid(`不可更新字段：${unknown.join(', ')}`);
  const beforeStatus = task.status ?? null;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'title' && !String(value ?? '').trim()) throw invalid('title 不能为空');
    task[key] = value;
  }
  if (task.status !== undefined && !isTaskboardStatus(task.status)) {
    throw invalid(`不支持的状态：${task.status}`);
  }
  if (task.kind !== undefined && !isTaskboardKind(task.kind)) {
    throw invalid(`不支持的任务类型：${task.kind}`);
  }
  const now = isoNow();
  if (task.status === 'in_progress' && !task.started_at) task.started_at = now;
  if (task.status === 'done' && !task.completed_at) task.completed_at = now;
  if (task.status !== beforeStatus) {
    const history = task.status_history ?? (task.status_history = []);
    history.push({ from: beforeStatus, to: task.status ?? null, at: now });
  }
  task.updated_at = now;
  return task;
}

/** Port of project-taskboard task_map integrity checks; returns the id map. */
export function assertTaskboardTree(tasks: TaskboardTask[]): Map<string, TaskboardTask> {
  const result = new Map<string, TaskboardTask>();
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || !task.id) {
      throw invalid('每个任务必须是包含 id 的对象');
    }
    if (result.has(task.id)) {
      throw new BusinessException('TASKBOARD_DUPLICATE_ID', `任务 ID 已存在：${task.id}`);
    }
    result.set(task.id, task);
  }
  for (const task of tasks) {
    const parent = task.parent_id;
    if (parent && !result.has(parent)) {
      throw new BusinessException(
        'TASKBOARD_PARENT_NOT_FOUND',
        `任务 ${task.id} 的 parent_id 不存在：${parent}`,
      );
    }
  }
  for (const task of tasks) {
    const seen = new Set<string>();
    let current: TaskboardTask | undefined = task;
    while (current && current.parent_id) {
      if (seen.has(current.id)) throw invalid(`任务树存在循环：${task.id}`);
      seen.add(current.id);
      current = result.get(current.parent_id);
    }
  }
  return result;
}

export interface TaskboardSummary {
  project: string;
  schema_version: number;
  updated_at: string | null;
  task_count: number;
  root_count: number;
  concrete_count: number;
  unknown_statuses: string[];
  unknown_kinds: string[];
}

/** Port of project-taskboard validate_board summary output. */
export function summarizeTaskboard(board: TaskboardBoard): TaskboardSummary {
  const mapping = assertTaskboardTree(board.tasks);
  const tasks = [...mapping.values()];
  return {
    project: board.project,
    schema_version: board.schema_version,
    updated_at: board.updated_at,
    task_count: tasks.length,
    root_count: tasks.filter((task) => !task.parent_id).length,
    concrete_count: tasks.filter((task) => TASKBOARD_CONCRETE_KINDS.has(task.kind ?? '')).length,
    unknown_statuses: [...new Set(tasks.map((task) => String(task.status)).filter((status) => !isTaskboardStatus(status)))].sort(),
    unknown_kinds: [...new Set(tasks.map((task) => String(task.kind)).filter((kind) => !isTaskboardKind(kind)))].sort(),
  };
}

export interface TaskboardTaskColumns {
  id: string;
  parentId: string | null;
  kind: string;
  title: string;
  status: string;
  scopeClass: string | null;
  owner: string | null;
  summary: string | null;
  description: string | null;
  currentStep: string | null;
  ordinal: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  payload: Record<string, unknown>;
  statusHistory: TaskboardStatusHistoryEntry[];
}

function parseDate(value: unknown, field: string, taskId: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw invalid(`任务 ${taskId} 的 ${field} 不是有效时间：${String(value)}`);
  }
  return date;
}

/** Split a wire task into relational columns plus the free-form payload bucket. */
export function toTaskboardColumns(task: TaskboardTask, ordinal: number): TaskboardTaskColumns {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(task)) {
    if (COLUMN_FIELD_SET.has(key)) continue;
    if (!TASKBOARD_MUTABLE_FIELDS.has(key)) continue;
    payload[key] = value;
  }
  const history = Array.isArray(task.status_history) ? task.status_history : [];
  return {
    id: task.id,
    parentId: task.parent_id ?? null,
    kind: task.kind ?? 'task',
    title: task.title,
    status: task.status ?? 'todo',
    scopeClass: task.scope_class ?? null,
    owner: task.owner ?? null,
    summary: task.summary ?? null,
    description: task.description ?? null,
    currentStep: task.current_step ?? null,
    ordinal,
    startedAt: parseDate(task.started_at, 'started_at', task.id),
    completedAt: parseDate(task.completed_at, 'completed_at', task.id),
    createdAt: parseDate(task.created_at, 'created_at', task.id) ?? new Date(),
    payload,
    statusHistory: history,
  };
}

/** Rebuild the wire task from persisted columns (payload spread keeps extras). */
export function fromTaskboardColumns(columns: {
  id: string;
  parentId: string | null;
  kind: string;
  title: string;
  status: string;
  scopeClass: string | null;
  owner: string | null;
  summary: string | null;
  description: string | null;
  currentStep: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  payload: unknown;
  statusHistory: unknown;
}): TaskboardTask {
  const payload = (columns.payload && typeof columns.payload === 'object' && !Array.isArray(columns.payload)
    ? columns.payload
    : {}) as Record<string, unknown>;
  const history = Array.isArray(columns.statusHistory)
    ? (columns.statusHistory as TaskboardStatusHistoryEntry[])
    : [];
  return {
    ...payload,
    id: columns.id,
    title: columns.title,
    parent_id: columns.parentId,
    kind: columns.kind,
    status: columns.status,
    scope_class: columns.scopeClass,
    owner: columns.owner,
    summary: columns.summary,
    description: columns.description,
    current_step: columns.currentStep,
    started_at: columns.startedAt ? columns.startedAt.toISOString() : null,
    completed_at: columns.completedAt ? columns.completedAt.toISOString() : null,
    created_at: columns.createdAt.toISOString(),
    updated_at: columns.updatedAt.toISOString(),
    status_history: history,
  };
}
