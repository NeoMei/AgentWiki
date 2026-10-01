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

it.each(['todo', 'in_progress', 'in_review', 'done'])('aggregates terminal concrete tasks through arbitrary depth at %s', status => {
  const tasks = [t('root', { stages: { implementation: 'todo', validation: 'passed' } }),
    t('nested', { parent_id: 'root', stages: { implementation: 'todo' } }),
    t('leaf', { parent_id: 'nested', status, stages: { implementation: status, validation: 'blocked', acceptance: 'unknown' } }),
    t('step', { kind: 'step', parent_id: 'leaf', status: 'todo' })];
  for (const task of tasks.slice(0, 3)) expect(tbStages(tasks, task)).toEqual(['blocked', status, 'unknown']);
});

it('retains missing independent stage coverage rather than reporting all passed', () => {
  const tasks = [t('root', { kind: 'phase', stages: { validation: 'passed', acceptance: 'passed' } }),
    t('a', { parent_id: 'root', status: 'done', stages: { validation: 'passed', acceptance: 'passed' } }),
    t('b', { parent_id: 'root', status: 'done' })];
  expect(tbStages(tasks, tasks[0])).toEqual(['unknown', 'done', 'unknown']);
});

it('does not include concrete descendants excluded by an ancestor in stage aggregation', () => {
  const tasks = [t('root'), t('optional', { parent_id: 'root', kind: 'module', scope_class: 'optional_external' }),
    t('excluded', { parent_id: 'optional', status: 'blocked' }), t('leaf', { parent_id: 'root', status: 'done' })];
  expect(tbStages(tasks, tasks[0])).toEqual(['unknown', 'done', 'unknown']);
});
