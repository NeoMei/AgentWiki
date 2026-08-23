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

  it('ignores an approved Review from an older source generation', async () => {
    const tasks = [
      { ...task('source', 'blocked'), generation: 2 },
      task('downstream', 'blocked'),
    ];
    const tx = {
      collaborationRun: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-1', status: 'running', pauseReason: null,
          templateSnapshot: {
            nodes: [{ kind: 'human_review', id: 'review', artifactTaskId: 'source' }],
            terminalNodeIds: ['downstream'],
          },
        }),
        update: jest.fn(),
      },
      collaborationRunTask: {
        findMany: jest.fn().mockResolvedValue(tasks),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
      },
      collaborationTaskDependency: { findMany: jest.fn().mockResolvedValue([
        { fromNodeId: 'review', toNodeId: 'downstream', mode: 'all' },
      ]) },
      collaborationTaskArtifact: { findFirst: jest.fn() },
      collaborationReview: { findMany: jest.fn().mockResolvedValue([
        { nodeId: 'review', status: 'approved', generation: 1, sourceTaskId: 'task-source' },
      ]), findFirst: jest.fn(), create: jest.fn() },
    } as any;
    const events = { executeIdempotent: jest.fn(async (_tx: any, _scope: any, mutation: () => unknown) => mutation()) } as any;

    await new ProgressionService(events).advanceRun(tx, 'run-1', 'revision-submitted');

    expect(tx.collaborationRunTask.updateMany).not.toHaveBeenCalled();
    expect(tx.collaborationRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'paused', pauseReason: 'progress_invariant' }),
    }));
  });

  it('does not release an approved Review node while a sibling Review keeps its source submitted', async () => {
    const tasks = [task('source', 'submitted'), task('downstream', 'blocked')];
    const tx = {
      collaborationRun: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-1', status: 'waiting_review', pauseReason: null,
          templateSnapshot: {
            nodes: [
              { kind: 'human_review', id: 'review-a', artifactTaskId: 'source', revisionTaskId: 'source', minimumRole: 'editor', reviewerUserIds: [], allowTerminate: true },
              { kind: 'human_review', id: 'review-b', artifactTaskId: 'source', revisionTaskId: 'source', minimumRole: 'editor', reviewerUserIds: [], allowTerminate: true },
            ],
            terminalNodeIds: ['downstream'],
          },
        }),
        update: jest.fn(),
      },
      collaborationRunTask: {
        findMany: jest.fn().mockResolvedValue(tasks), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn(),
      },
      collaborationTaskDependency: { findMany: jest.fn().mockResolvedValue([
        { fromNodeId: 'review-a', toNodeId: 'downstream', mode: 'all' },
      ]) },
      collaborationTaskArtifact: { findFirst: jest.fn() },
      collaborationReview: {
        findMany: jest.fn().mockResolvedValue([
          { nodeId: 'review-a', status: 'approved', generation: 1, sourceTaskId: 'task-source' },
          { nodeId: 'review-b', status: 'pending', generation: 1, sourceTaskId: 'task-source' },
        ]),
        findFirst: jest.fn(), create: jest.fn(),
      },
    } as any;
    const events = { executeIdempotent: jest.fn(async (_tx: any, _scope: any, mutation: () => unknown) => mutation()) } as any;

    await new ProgressionService(events).advanceRun(tx, 'run-1', 'partial-review-group');

    expect(tx.collaborationRunTask.updateMany).not.toHaveBeenCalled();
    expect(tx.collaborationRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'waiting_review' }),
    }));
  });

  it('creates every actionable Review only after its all-mode predecessors are satisfied', async () => {
    const tasks = [
      task('source-a', 'submitted'), task('source-b', 'submitted'), task('material', 'submitted'),
    ];
    const snapshot = {
      nodes: [
        { kind: 'human_review', id: 'review-a', artifactTaskId: 'source-a', revisionTaskId: 'source-a', minimumRole: 'editor', reviewerUserIds: [], allowTerminate: true },
        { kind: 'human_review', id: 'review-b', artifactTaskId: 'source-b', revisionTaskId: 'source-b', minimumRole: 'editor', reviewerUserIds: [], allowTerminate: true },
      ],
      terminalNodeIds: ['review-a', 'review-b'],
    };
    const tx = {
      collaborationRun: { findUnique: jest.fn().mockResolvedValue({ id: 'run-1', status: 'running', pauseReason: null, templateSnapshot: snapshot }), update: jest.fn() },
      collaborationRunTask: {
        findMany: jest.fn().mockResolvedValue(tasks), updateMany: jest.fn(),
        findFirst: jest.fn(async ({ where }: any) => tasks.find((item) => item.nodeId === where.nodeId)),
      },
      collaborationTaskDependency: { findMany: jest.fn().mockResolvedValue([
        { fromNodeId: 'source-a', toNodeId: 'review-a', mode: 'all' },
        { fromNodeId: 'material', toNodeId: 'review-a', mode: 'all' },
        { fromNodeId: 'source-b', toNodeId: 'review-b', mode: 'all' },
        { fromNodeId: 'material', toNodeId: 'review-b', mode: 'all' },
      ]) },
      collaborationTaskArtifact: { findFirst: jest.fn(async ({ where }: any) => ({ id: `artifact-${where.taskId}` })) },
      collaborationReview: {
        findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => data),
      },
    } as any;
    const events = { executeIdempotent: jest.fn(async (_tx: any, _scope: any, mutation: () => unknown) => mutation()) } as any;

    const progression = new ProgressionService(events);
    await progression.advanceRun(tx, 'run-1', 'non-source-still-submitted');
    expect(tx.collaborationReview.create).not.toHaveBeenCalled();

    tasks[2].status = 'completed';
    await progression.advanceRun(tx, 'run-1', 'all-predecessors-satisfied');

    expect(tx.collaborationReview.create).toHaveBeenCalledTimes(2);
    expect(tx.collaborationReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nodeId: 'review-a', sourceTaskId: 'task-source-a', generation: 1 }),
    });
    expect(tx.collaborationReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nodeId: 'review-b', sourceTaskId: 'task-source-b', generation: 1 }),
    });
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
    tasks: [{ id: 'task-1', nodeId, status: options.taskStatus ?? 'submitted', generation: 1, skippable: false }],
    reviews: options.pendingReview ? [{ nodeId: 'review', status: 'pending', generation: 1, sourceTaskId: 'task-1' }] : [],
    satisfiedNodeIds: new Set(options.terminalSatisfied ? [nodeId] : []),
  };
}
