import { describe, expect, it } from 'vitest';
import { tbStages } from './board-view';
import type { TaskboardTask } from './types';

const t = (id: string, extra: Record<string, unknown> = {}): TaskboardTask =>
  ({ id, title: id, status: 'todo', kind: 'task', ...extra });

describe('tbStages (upstream ba67015 aggregation semantics)', () => {
  it('leaf task without stages registration falls back to its own status', () => {
    const tasks = [t('a', { status: 'in_progress' })];
    // Upstream concrete() includes the task itself, so unregistered stages show unknown.
    expect(tbStages(tasks, tasks[0])).toEqual(['unknown', 'in_progress', 'unknown']);
  });

  it('partial completion across leaves aggregates to in_progress', () => {
    const tasks = [
      t('p', { status: 'in_progress' }),
      t('a', { parent_id: 'p', status: 'done' }),
      t('b', { parent_id: 'p', status: 'todo' }),
    ];
    expect(tbStages(tasks, tasks[0])[1]).toBe('in_progress');
  });

  it('all done leaves aggregate to done, and blocked wins', () => {
    const tasks = [
      t('p', { status: 'todo', kind: 'phase' }),
      t('a', { parent_id: 'p', status: 'done' }),
      t('b', { parent_id: 'p', status: 'done' }),
    ];
    expect(tbStages(tasks, tasks[0])[1]).toBe('done');
    tasks[2].status = 'blocked';
    expect(tbStages(tasks, tasks[0])[1]).toBe('blocked');
  });

  it('parent with registered stages uses them before leaf fallback', () => {
    const tasks = [t('a', { status: 'done', stages: { implementation: 'blocked' } })];
    expect(tbStages(tasks, tasks[0])[1]).toBe('blocked');
  });
});
