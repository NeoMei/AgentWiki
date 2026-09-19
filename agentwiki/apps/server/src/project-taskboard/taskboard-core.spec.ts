import {
  applyTaskboardPatch,
  assertTaskboardTree,
  fromTaskboardColumns,
  makeTaskboardTask,
  toTaskboardColumns,
} from './taskboard-core';

describe('taskboard-core', () => {
  it('creates a task with defaults and honors a client-supplied id', () => {
    const generated = makeTaskboardTask({ title: '写测试' });
    expect(generated.id).toMatch(/^task-[0-9a-f]{10}$/);
    expect(generated.kind).toBe('task');
    expect(generated.status).toBe('todo');
    expect(generated.parent_id).toBeNull();

    const explicit = makeTaskboardTask({ id: 'task-abc', title: '实现' });
    expect(explicit.id).toBe('task-abc');
  });

  it('rejects blank titles and unknown payload fields on patch', () => {
    expect(() => makeTaskboardTask({ title: '  ' })).toThrow('title 不能为空');
    const task = makeTaskboardTask({ title: '实现' });
    expect(() => applyTaskboardPatch(task, { nickname: 'x' })).toThrow('不可更新字段：nickname');
  });

  it('auto-stamps started_at and completed_at and records history only on change', () => {
    const task = makeTaskboardTask({ title: '实现' });
    applyTaskboardPatch(task, { status: 'in_progress', current_step: '写失败测试' });
    expect(task.started_at).toBeTruthy();
    expect(task.status_history).toMatchObject([{ from: 'todo', to: 'in_progress', at: expect.any(String) }]);

    // Idempotent re-report must not append history.
    applyTaskboardPatch(task, { status: 'in_progress' });
    expect(task.status_history).toHaveLength(1);

    applyTaskboardPatch(task, { status: 'done' });
    expect(task.completed_at).toBeTruthy();
    expect(task.status_history).toHaveLength(2);
  });

  it('rejects unknown status and kind values', () => {
    const statusTask = makeTaskboardTask({ title: '实现' });
    expect(() => applyTaskboardPatch(statusTask, { status: 'archived' })).toThrow('不支持的状态：archived');
    const kindTask = makeTaskboardTask({ title: '实现' });
    expect(() => applyTaskboardPatch(kindTask, { kind: 'story' })).toThrow('不支持的任务类型：story');
  });

  it('enforces unique ids, parent existence, and acyclic trees', () => {
    const a = makeTaskboardTask({ id: 'a', title: 'A' });
    expect(() => assertTaskboardTree([a, { ...a }])).toThrow('任务 ID 已存在：a');
    expect(() => assertTaskboardTree([a, makeTaskboardTask({ id: 'b', title: 'B', parent_id: 'missing' })]))
      .toThrow('parent_id 不存在：missing');

    const root = makeTaskboardTask({ id: 'root', title: 'R' });
    const child = makeTaskboardTask({ id: 'child', title: 'C', parent_id: 'root' });
    root.parent_id = 'child';
    expect(() => assertTaskboardTree([root, child])).toThrow('任务树存在循环：root');
  });

  it('round-trips wire tasks through relational columns without losing payload extras', () => {
    const wire = makeTaskboardTask({
      id: 'plan-task-1',
      title: '登录契约',
      kind: 'implementation_task',
      status: 'in_progress',
      parent_id: 'plan',
      labels: ['superpowers', 'plan-task'],
      stages: { validation: 'unknown', implementation: 'in_progress', acceptance: 'unknown' },
      external_id: 'superpowers:plan.md:task:1',
      started_at: '2026-09-19T01:02:03Z',
    });
    const columns = toTaskboardColumns(wire, 3);
    expect(columns.ordinal).toBe(3);
    expect(columns.startedAt).toEqual(new Date('2026-09-19T01:02:03Z'));
    expect(columns.payload).toEqual({
      labels: ['superpowers', 'plan-task'],
      stages: { validation: 'unknown', implementation: 'in_progress', acceptance: 'unknown' },
      external_id: 'superpowers:plan.md:task:1',
    });

    const restored = fromTaskboardColumns({
      id: columns.id,
      parentId: columns.parentId,
      kind: columns.kind,
      title: columns.title,
      status: columns.status,
      scopeClass: null,
      owner: null,
      summary: null,
      description: null,
      currentStep: null,
      startedAt: columns.startedAt,
      completedAt: null,
      createdAt: columns.createdAt,
      updatedAt: new Date('2026-09-19T02:00:00Z'),
      payload: columns.payload,
      statusHistory: [],
    });
    expect(restored).toMatchObject({
      id: 'plan-task-1',
      title: '登录契约',
      parent_id: 'plan',
      kind: 'implementation_task',
      status: 'in_progress',
      labels: ['superpowers', 'plan-task'],
      started_at: '2026-09-19T01:02:03.000Z',
      updated_at: '2026-09-19T02:00:00.000Z',
    });
  });
});
