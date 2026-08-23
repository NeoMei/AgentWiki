import { ProgressionService, calculateRunStatus } from './progression.service';

describe('calculateRunStatus', () => {
  it('keeps running beside a pending review and waits only when review is the sole action', () => {
    expect(calculateRunStatus(state({ taskStatus: 'ready', pendingReview: true }))).toBe('running');
    expect(calculateRunStatus(state({ taskStatus: 'submitted', pendingReview: true }))).toBe('waiting_review');
  });

  it('preserves explicit terminal and pause states and completes only satisfied terminals', () => {
    expect(calculateRunStatus(state({ runStatus: 'cancelled' }))).toBe('cancelled');
    expect(calculateRunStatus(state({ pauseReason: 'manual' }))).toBe('paused');
    expect(calculateRunStatus(state({ taskStatus: 'completed', terminalSatisfied: true }))).toBe('completed');
  });
});

describe('ProgressionService', () => {
  it('releases all and any targets according to accepted current node completion', async () => {
    const tasks = [
      task('a', 'completed'), task('b', 'completed'),
      task('all-target', 'blocked', 'all'), task('any-target', 'blocked', 'any'),
    ];
    const tx = {
      collaborationRun: { findUnique: jest.fn().mockResolvedValue({ id: 'run-1', status: 'running', pauseReason: null, templateSnapshot: { terminalNodeIds: ['all-target', 'any-target'] } }), update: jest.fn() },
      collaborationRunTask: { findMany: jest.fn().mockResolvedValue(tasks), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      collaborationTaskDependency: { findMany: jest.fn().mockResolvedValue([
        { fromNodeId: 'a', toNodeId: 'all-target', mode: 'all' },
        { fromNodeId: 'b', toNodeId: 'all-target', mode: 'all' },
        { fromNodeId: 'a', toNodeId: 'any-target', mode: 'any' },
        { fromNodeId: 'b', toNodeId: 'any-target', mode: 'any' },
      ]) },
      collaborationReview: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const events = { executeIdempotent: jest.fn(async (_tx: any, _scope: any, mutation: () => unknown) => mutation()) } as any;
    const service = new ProgressionService(events);
    await service.advanceRun(tx, 'run-1', 'artifact:accepted');
    expect(tx.collaborationRunTask.updateMany).toHaveBeenCalledWith({ where: { id: 'task-all-target', status: 'blocked' }, data: { status: 'ready' } });
    expect(tx.collaborationRunTask.updateMany).toHaveBeenCalledWith({ where: { id: 'task-any-target', status: 'blocked' }, data: { status: 'ready' } });
    expect(tx.collaborationRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'running' }) }));
  });
});

function task(nodeId: string, status: string, dependencyMode = 'all') {
  return { id: `task-${nodeId}`, nodeId, status, dependencyMode, skippable: false, generation: 1 };
}

function state(options: {
  runStatus?: string; taskStatus?: string; pendingReview?: boolean; pauseReason?: string | null; terminalSatisfied?: boolean;
} = {}) {
  const nodeId = 'terminal';
  return {
    run: { status: options.runStatus ?? 'running', pauseReason: options.pauseReason ?? null, templateSnapshot: { terminalNodeIds: [nodeId] } },
    tasks: [{ id: 'task-1', nodeId, status: options.taskStatus ?? 'submitted', skippable: false }],
    reviews: options.pendingReview ? [{ nodeId: 'review', status: 'pending' }] : [],
    satisfiedNodeIds: new Set(options.terminalSatisfied ? [nodeId] : []),
  };
}
