import { mergePlanIntoTasks, parseSuperpowersPlan } from './plan-parser';
import { parseTaskboardDocument } from './plan-parser';
import type { TaskboardTask } from './taskboard-core';

const PLAN = [
  '# Account Flow Implementation Plan',
  '',
  '**Goal:** Build the account flow.',
  '',
  '### Task 1: Add the login contract',
  '',
  '**Files:**',
  '- Create: `src/auth.py`',
  '',
  '- [ ] **Step 1: Write the failing test**',
  '- [x] **Step 2: Run the test**',
  '',
  '### Task 2: Implement the login flow',
  '',
  '- [x] **Step 1: Write the failing test**',
  '- [x] **Step 2: Implement the minimal code**',
].join('\n');

describe('parseSuperpowersPlan', () => {
  it('imports tasks and steps as a hierarchy with derived statuses', () => {
    const plan = parseSuperpowersPlan(PLAN, '/tmp/account-flow.md');
    expect(plan.project).toBe('Account Flow');
    expect(plan.tasks.map((task) => task.kind)).toEqual([
      'phase',
      'implementation_task',
      'step',
      'step',
      'implementation_task',
      'step',
      'step',
    ]);
    expect(plan.tasks[1].parent_id).toBe(plan.tasks[0].id);
    expect(plan.tasks[2].parent_id).toBe(plan.tasks[1].id);
    expect(plan.tasks[2].title).toBe('Write the failing test');
    expect(plan.tasks[2].status).toBe('todo');
    expect(plan.tasks[3].status).toBe('done');
    // Task 1 is partially complete; task 2 is fully complete.
    expect(plan.tasks[1].status).toBe('in_progress');
    expect(plan.tasks[4].status).toBe('done');
    expect(plan.tasks[1].stages).toEqual({
      validation: 'unknown',
      implementation: 'in_progress',
      acceptance: 'unknown',
    });
  });

  it('strips the Implementation Plan suffix and keeps a stable plan id', () => {
    const first = parseSuperpowersPlan(PLAN, '/tmp/account-flow.md');
    const second = parseSuperpowersPlan(PLAN, '/tmp/account-flow.md');
    expect(first.tasks[0].id).toBe(second.tasks[0].id);
    expect(first.project).toBe('Account Flow');
  });
});

describe('parseTaskboardDocument', () => {
  it('imports a local board.json task tree', () => {
    const board = parseTaskboardDocument(JSON.stringify({
      schema_version: 1,
      project: '本地看板',
      source_type: 'manual',
      updated_at: '2026-09-25T00:00:00Z',
      tasks: [
        { id: 'root', title: '本地根任务', kind: 'phase', status: 'in_progress' },
        { id: 'task-1', parent_id: 'root', title: '本地执行任务', kind: 'implementation_task', status: 'done', owner: 'agent-a' },
      ],
    }), 'board.json');
    expect(board.project).toBe('本地看板');
    expect(board.source_type).toBe('manual');
    expect(board.tasks.map((task) => task.id)).toEqual(['root', 'task-1']);
    expect(board.tasks[1].owner).toBe('agent-a');
  });
});

describe('mergePlanIntoTasks', () => {
  it('adds new tasks and refreshes planning fields without touching live status by default', () => {
    const plan = parseSuperpowersPlan(PLAN, '/tmp/account-flow.md');
    const board = { tasks: [] as TaskboardTask[], source_type: 'manual', sources: [] as string[] };
    const first = mergePlanIntoTasks(board, plan, '/tmp/account-flow.md');
    expect(first).toEqual({ added: 7, updated: 0 });
    expect(board.source_type).toBe('superpowers_plan');
    expect(board.sources).toEqual(['/tmp/account-flow.md']);

    // Live execution field survives a re-import; planning title refreshes.
    const task1 = board.tasks[1];
    task1.status = 'blocked';
    task1.current_step = '等待接口评审';
    const refreshed = parseSuperpowersPlan(PLAN, '/tmp/account-flow.md');
    refreshed.tasks[1].title = 'Add the login contract v2';
    const second = mergePlanIntoTasks(board, refreshed, '/tmp/account-flow.md');
    expect(second).toEqual({ added: 0, updated: 7 });
    expect(task1.title).toBe('Add the login contract v2');
    expect(task1.status).toBe('blocked');
    expect(task1.current_step).toBe('等待接口评审');
  });

  it('syncs status from the plan unless the live status is protected', () => {
    const plan = parseSuperpowersPlan(PLAN, '/tmp/account-flow.md');
    const board = { tasks: [] as TaskboardTask[], source_type: 'manual', sources: [] as string[] };
    mergePlanIntoTasks(board, plan, '/tmp/account-flow.md');
    const task1 = board.tasks[1];
    const step2 = board.tasks[3];

    step2.status = 'todo';
    mergePlanIntoTasks(board, parseSuperpowersPlan(PLAN, '/tmp/account-flow.md'), '/tmp/account-flow.md', true);
    expect(step2.status).toBe('done');

    task1.status = 'blocked';
    mergePlanIntoTasks(board, parseSuperpowersPlan(PLAN, '/tmp/account-flow.md'), '/tmp/account-flow.md', true);
    expect(task1.status).toBe('blocked');
  });
});
