import { createHash } from 'node:crypto';
import { BusinessException } from '../core/filters/business-error';
import {
  applyTaskboardPatch,
  assertTaskboardTree,
  isoNow,
  makeTaskboardTask,
  isTaskboardKind,
  isTaskboardStatus,
  toTaskboardColumns,
  type TaskboardTask,
} from './taskboard-core';

export interface ParsedSuperpowersPlan {
  schema_version: number;
  project: string;
  source_type: string;
  sources: string[];
  updated_at: string;
  tasks: TaskboardTask[];
}

/** Import either a Superpowers Markdown plan or a local project-taskboard board.json. */
export function parseTaskboardDocument(text: string, sourcePath = 'superpowers-plan.md'): ParsedSuperpowersPlan {
  const trimmed = text.trim();
  if (!/^[{[]/.test(trimmed) && !/\.json$/i.test(sourcePath)) return parseSuperpowersPlan(text, sourcePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new BusinessException('TASKBOARD_INVALID', 'Invalid taskboard JSON');
  }
  const candidate = Array.isArray(parsed) ? { tasks: parsed } : parsed && typeof parsed === 'object'
    ? ((parsed as Record<string, unknown>).board ?? parsed)
    : null;
  if (!candidate || typeof candidate !== 'object' || !Array.isArray((candidate as Record<string, unknown>).tasks)) {
    throw new BusinessException('TASKBOARD_INVALID', 'JSON must contain a tasks array');
  }
  const board = candidate as Record<string, unknown>;
  if (board.schema_version !== undefined && board.schema_version !== 1) {
    throw new BusinessException('TASKBOARD_INVALID', 'Unsupported taskboard schema version');
  }
  const tasks = (board.tasks as unknown[]).map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BusinessException('TASKBOARD_INVALID');
    const value = raw as Record<string, unknown>;
    if (typeof value.id !== 'string' || !value.id.trim() || typeof value.title !== 'string' ||
      (value.parent_id != null && typeof value.parent_id !== 'string')) throw new BusinessException('TASKBOARD_INVALID');
    // Only import public task fields, never server claims or actor-attributed history.
    const task = makeTaskboardTask(value);
    if (!isTaskboardKind(task.kind) || !isTaskboardStatus(task.status)) throw new BusinessException('TASKBOARD_INVALID');
    toTaskboardColumns(task, 0); // Validate timestamps before starting the write transaction.
    return task;
  });
  assertTaskboardTree(tasks);
  return {
    schema_version: typeof board.schema_version === 'number' ? board.schema_version : 1,
    project: typeof board.project === 'string' && board.project.trim() ? board.project : planBasename(sourcePath),
    source_type: 'manual',
    sources: [sourcePath],
    updated_at: typeof board.updated_at === 'string' ? board.updated_at : isoNow(),
    tasks,
  };
}

function planSlug(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  if (cleaned) return cleaned.slice(0, 64);
  return createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 12);
}

function planTitle(text: string, sourcePath: string): string {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match) {
      const title = match[1].replace(/\s+Implementation Plan\s*$/i, '').trim();
      return title || planBasename(sourcePath);
    }
  }
  return planBasename(sourcePath);
}

function planBasename(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  return name.replace(/\.md$/i, '') || sourcePath;
}

function planField(text: string, name: string): string | null {
  const match = text.match(new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+?)\\s*$`, 'm'));
  return match ? match[1].trim() : null;
}

export function stepStatus(checked: number, total: number): 'done' | 'in_progress' | 'todo' {
  if (total > 0 && checked === total) return 'done';
  if (checked > 0) return 'in_progress';
  return 'todo';
}

function implementationStages(status: string): Record<string, string> {
  return { validation: 'unknown', implementation: status, acceptance: 'unknown' };
}

/**
 * Port of project-taskboard parse_superpowers_plan.
 * The plan heading is a planning node, each "### Task N" is an executable
 * implementation_task, and each bold "Step N" checkbox is a non-executable child.
 */
export function parseSuperpowersPlan(text: string, sourcePath = 'superpowers-plan.md'): ParsedSuperpowersPlan {
  const title = planTitle(text, sourcePath);
  const basename = planBasename(sourcePath);
  const sourceHash = createHash('sha1').update(String(sourcePath), 'utf8').digest('hex').slice(0, 8);
  const slug = `${planSlug(basename)}-${sourceHash}`;
  const planId = `superpowers-plan-${slug}`;
  const source = String(sourcePath);
  const now = isoNow();
  const lines = text.split(/\r?\n/);
  const taskHeaders: Array<{ index: number; number: number; title: string }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^###\s+Task\s+(\d+)\s*:\s*(.+?)\s*$/);
    if (match) taskHeaders.push({ index, number: Number(match[1]), title: match[2].trim() });
  });

  const tasks: TaskboardTask[] = [
    {
      id: planId,
      title,
      kind: 'phase',
      status: 'todo',
      scope_class: 'required',
      source: [source],
      plan_source: [source],
      external_id: `superpowers:${source}:plan`,
      summary: planField(text, 'Goal') ?? 'Superpowers implementation plan',
      created_at: now,
      updated_at: now,
    },
  ];

  taskHeaders.forEach((header, position) => {
    const end = position + 1 < taskHeaders.length ? taskHeaders[position + 1].index : lines.length;
    const section = lines.slice(header.index, end).join('\n');
    const steps: Array<{ number: number; title: string; status: 'done' | 'todo' }> = [];
    for (const match of section.matchAll(/^\s*-\s+\[([ xX])\]\s+\*\*Step\s+(\d+)\s*:\s*(.+?)\*\*\s*$/gm)) {
      steps.push({
        number: Number(match[2]),
        title: match[3].trim(),
        status: match[1].toLowerCase() === 'x' ? 'done' : 'todo',
      });
    }
    const checked = steps.filter((step) => step.status === 'done').length;
    const taskId = `${planId}-task-${header.number}`;
    const taskStatus = stepStatus(checked, steps.length);
    tasks.push({
      id: taskId,
      title: header.title,
      parent_id: planId,
      kind: 'implementation_task',
      status: taskStatus,
      scope_class: 'required',
      source: [source],
      plan_source: [source],
      stages: implementationStages(taskStatus),
      external_id: `superpowers:${source}:task:${header.number}`,
      labels: ['superpowers', 'plan-task'],
      created_at: now,
      updated_at: now,
    });
    for (const step of steps) {
      tasks.push({
        id: `${taskId}-step-${step.number}`,
        title: step.title,
        parent_id: taskId,
        kind: 'step',
        status: step.status,
        scope_class: 'required',
        source: [source],
        plan_source: [source],
        external_id: `superpowers:${source}:task:${header.number}:step:${step.number}`,
        labels: ['superpowers', 'plan-step'],
        created_at: now,
        updated_at: now,
      });
    }
  });

  const plan: ParsedSuperpowersPlan = {
    schema_version: 1,
    project: title,
    source_type: 'superpowers_plan',
    sources: [source],
    updated_at: now,
    tasks,
  };
  assertTaskboardTree(plan.tasks);
  return plan;
}

const PLANNING_FIELDS = [
  'title',
  'parent_id',
  'kind',
  'scope_class',
  'source',
  'external_id',
  'summary',
  'labels',
] as const;

const PRESERVED_STATUSES = new Set(['blocked', 'in_review', 'canceled']);

export interface PlanMergeSummary {
  added: number;
  updated: number;
}

/**
 * Port of project-taskboard _merge_plan_into_board: refresh plan structure
 * while preserving live execution fields owned by agents.
 */
export function mergePlanIntoTasks(
  board: { tasks: TaskboardTask[]; source_type: string; sources: string[] },
  incoming: ParsedSuperpowersPlan,
  sourcePath: string,
  syncStatus = false,
): PlanMergeSummary {
  const existing = assertTaskboardTree(board.tasks);
  let added = 0;
  let updated = 0;
  for (const candidate of incoming.tasks) {
    const current = existing.get(candidate.id);
    if (!current) {
      board.tasks.push(candidate);
      existing.set(candidate.id, candidate);
      added += 1;
      continue;
    }
    for (const field of PLANNING_FIELDS) {
      const currentFields = current as Record<string, unknown>;
      const candidateFields = candidate as Record<string, unknown>;
      if (field in candidateFields) currentFields[field] = candidateFields[field];
    }
    if (
      syncStatus &&
      !PRESERVED_STATUSES.has(String(current.status)) &&
      current.status !== candidate.status
    ) {
      applyTaskboardPatch(current, { status: candidate.status });
    }
    current.updated_at = isoNow();
    updated += 1;
  }
  board.source_type = incoming.source_type;
  board.sources = [...new Set([...board.sources, ...incoming.sources, sourcePath])].sort();
  return { added, updated };
}
