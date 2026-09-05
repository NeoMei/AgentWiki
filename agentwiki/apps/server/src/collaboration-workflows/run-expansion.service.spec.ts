import type { CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import { BusinessException } from '../core/filters/business-error';
import { Logger } from '@nestjs/common';
import { RunExpansionService } from './run-expansion.service';
import { RunEventStore } from './run-event.store';

const principal = { userId: 'human-1', platformRole: 'user' as const };
const now = new Date('2026-09-05T08:00:00.000Z');

function agentTask(id: string, roleSlotId: string, outputKey: string) {
  return {
    kind: 'agent_task' as const,
    id,
    name: id,
    roleSlotId,
    objective: `Complete ${id}`,
    inputKeys: ['brief'],
    upstreamArtifacts: [],
    output: { key: outputKey, kind: 'markdown' as const },
    evidenceRequired: [],
    humanAcceptance: true,
    leaseSeconds: 300,
    maxExecutionSeconds: 3_600,
    retryBudget: 1,
    repairBudget: 1,
    skippable: false,
    todos: [{ id: 'write', name: 'Write', required: true, evidenceKinds: [] }],
  };
}

function review(taskId: string) {
  return {
    kind: 'human_review' as const,
    id: `review-${taskId}`,
    name: `Review ${taskId}`,
    artifactTaskId: taskId,
    minimumRole: 'editor' as const,
    reviewerUserIds: [],
    approvalCriteria: ['Accurate'],
    revisionTaskId: taskId,
    allowTerminate: true,
  };
}

const definition: CollaborationTemplateDefinition = {
  schemaVersion: 1,
  inputs: [{ key: 'brief', label: 'Brief', type: 'long_text', required: true }],
  roleSlots: [
    { id: 'writer', name: 'Writer', required: true, description: 'Writes pages' },
    { id: 'unused', name: 'Unused', required: true, description: 'Disabled task only' },
  ],
  nodes: [
    agentTask('draft', 'writer', 'draft-output'),
    agentTask('polish', 'writer', 'polish-output'),
    review('polish'),
  ],
  dependencies: [
    { from: 'draft', to: 'polish', mode: 'all' },
    { from: 'polish', to: 'review-polish', mode: 'all' },
  ],
  terminalNodeIds: ['review-polish'],
};

function harness(options: { credential?: boolean } = {}) {
  const runs: any[] = [];
  const roleBindings: any[] = [];
  const tasks: any[] = [];
  const todos: any[] = [];
  const dependencies: any[] = [];
  const runEvents: any[] = [];
  const tx: any = Object.assign({
    collaborationRun: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `run-${runs.length + 1}`, eventSequence: 0, ...data };
        runs.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data, select }: any) => {
        const row = runs.find((item) => item.id === where.id)!;
        if (data.eventSequence?.increment) row.eventSequence += data.eventSequence.increment;
        return select ? { eventSequence: row.eventSequence } : row;
      }),
    },
    collaborationRoleBinding: {
      createMany: jest.fn(async ({ data }: any) => {
        roleBindings.push(...data);
        return { count: data.length };
      }),
    },
    collaborationRunTask: {
      createMany: jest.fn(async ({ data }: any) => {
        tasks.push(...data);
        return { count: data.length };
      }),
    },
    collaborationTaskTodo: {
      createMany: jest.fn(async ({ data }: any) => {
        todos.push(...data);
        return { count: data.length };
      }),
    },
    collaborationTaskDependency: {
      createMany: jest.fn(async ({ data }: any) => {
        dependencies.push(...data);
        return { count: data.length };
      }),
    },
    agentGrant: {
      findMany: jest.fn(async ({ where }: any) => where.agentId.in.map((agentId: string) => ({
        id: `grant-${agentId}`,
        agentId,
        role: 'editor',
        agent: {
          id: agentId,
          status: 'active',
          revokedAt: null,
          owner: { deletedAt: null, lockedAt: null },
        },
        space: { deletedAt: null },
        credentials: options.credential === false ? [] : [{ id: `credential-${agentId}` }],
      }))),
    },
    spaceMember: { findMany: jest.fn().mockResolvedValue([]) },
    page: {
      findMany: jest.fn().mockResolvedValue([{
        id: 'page-1', spaceId: 'space-1', title: 'Draft', content: 'line 1\r\nline 2',
        format: 'markdown', updatedAt: now, deletedAt: null,
      }]),
      create: jest.fn(),
    },
    pageVersion: {
      findFirst: jest.fn().mockResolvedValue({ id: 'page-version-1' }),
    },
    pageAgentBinding: {
      findMany: jest.fn().mockResolvedValue([{
        pageId: 'page-1', spaceId: 'space-1', agentId: 'agent-1', roleSlotKey: 'writer',
      }]),
    },
    collaborationRunEvent: {
      findFirst: jest.fn(async ({ where }: any) => runEvents.find((event) => {
        if (where.runId && event.runId !== where.runId) return false;
        if (where.actorKind && event.actorKind !== where.actorKind) return false;
        if (where.actorId && event.actorId !== where.actorId) return false;
        if (where.operation && event.operation !== where.operation) return false;
        if (where.idempotencyKey && event.idempotencyKey !== where.idempotencyKey) return false;
        return !where.run?.spaceId || runs.find((run) => run.id === event.runId)?.spaceId === where.run.spaceId;
      }) ?? null),
      create: jest.fn(async ({ data }: any) => {
        runEvents.push(data);
        return data;
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  }, { contentTreeRevision: 7n });
  const prisma: any = {
    $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)),
  };
  const authorization: any = {
    lockLiveHumanPrincipal: jest.fn(),
    assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'editor' }),
  };
  const contentTree: any = { lockPageMutationSpace: jest.fn().mockResolvedValue(tx) };
  const notifications: any = { publishCurrentRun: jest.fn() };
  return {
    tx,
    runs,
    roleBindings,
    tasks,
    todos,
    dependencies,
    contentTree,
    notifications,
    authorization,
    service: new RunExpansionService(prisma, authorization, contentTree, notifications, new RunEventStore()),
  };
}

describe('RunExpansionService', () => {
  it('freezes enabled task assignments and server page baselines while omitting unused roles', async () => {
    const h = harness();

    const runId = await h.service.createStarted(h.tx, {
      spaceId: 'space-1',
      name: 'Page collaboration',
      source: {
        kind: 'composite', templateVersion: 3,
        compositeTemplateVersionId: 'composite-version-3',
        templateInstantiationId: 'instantiation-1',
      },
      definition,
      inputs: { brief: 'Write the current page' },
      bindings: [
        { kind: 'task_default', nodeId: 'draft', roleSlotId: 'writer', agentId: 'agent-1' },
        { kind: 'task_default', nodeId: 'polish', roleSlotId: 'writer', agentId: 'agent-1' },
        { kind: 'role_override', roleSlotId: 'unused', agentId: 'agent-out-of-scope' },
      ],
      taskPageIds: { draft: 'page-1' },
    }, principal);

    expect(runId).toBe('run-1');
    expect(h.runs).toEqual([expect.objectContaining({
      id: 'run-1', sourceKind: 'composite', templateId: null,
      compositeTemplateVersionId: 'composite-version-3',
      templateInstantiationId: 'instantiation-1', status: 'running',
      inputs: { brief: 'Write the current page' },
    })]);
    expect(h.roleBindings).toEqual([{
      runId: 'run-1', roleSlotId: 'writer', roleSlotName: 'Writer', agentId: 'agent-1',
    }]);
    expect(h.tasks).toHaveLength(2);
    expect(h.tasks.map(({ nodeId, assigneeAgentId, status }) => ({ nodeId, assigneeAgentId, status })))
      .toEqual([
        { nodeId: 'draft', assigneeAgentId: 'agent-1', status: 'ready' },
        { nodeId: 'polish', assigneeAgentId: 'agent-1', status: 'blocked' },
      ]);
    expect(h.tasks[0]).toEqual(expect.objectContaining({
      targetPageId: 'page-1', targetSpaceId: 'space-1', basePageVersionId: 'page-version-1',
      basePageUpdatedAt: now,
      baseContentHash: 'e266782c2841ee29d8f5aafc686abc45e9f119998a6b5c12fcbba5b19010cba4',
    }));
    expect(h.tasks[1]).toEqual(expect.objectContaining({
      targetPageId: null, targetSpaceId: null, basePageVersionId: null,
    }));
    expect(h.todos).toHaveLength(2);
    expect(h.dependencies).toHaveLength(2);
    expect(h.tx.agentGrant.findMany.mock.calls[0][0].where.agentId.in).toEqual(['agent-1']);

    // A later long-term Page binding edit is deliberately outside the frozen Run rows.
    const longTermBinding = { pageId: 'page-1', agentId: 'agent-2' };
    expect(longTermBinding.agentId).toBe('agent-2');
    expect(h.tasks[0].assigneeAgentId).toBe('agent-1');
  });

  it('requires a current credential tied to every participating Agent grant', async () => {
    const h = harness({ credential: false });

    await expect(h.service.createStarted(h.tx, {
      spaceId: 'space-1', name: 'No credential',
      source: { kind: 'page_selection', templateVersion: 1 },
      definition: { ...definition, nodes: [agentTask('draft', 'writer', 'draft-output'), review('draft')], dependencies: [{ from: 'draft', to: 'review-draft', mode: 'all' }], terminalNodeIds: ['review-draft'] },
      inputs: { brief: 'Write' },
      bindings: [{ kind: 'task_default', nodeId: 'draft', roleSlotId: 'writer', agentId: 'agent-1' }],
      taskPageIds: { draft: 'page-1' },
    }, principal)).rejects.toMatchObject({ businessCode: 'COLLABORATION_AGENT_CANNOT_EXECUTE' } satisfies Partial<BusinessException>);
    expect(h.runs).toEqual([]);
  });

  it('creates a page-selection Run without copying the historical page', async () => {
    const h = harness();
    const single: CollaborationTemplateDefinition = {
      ...definition,
      nodes: [agentTask('draft', 'writer', 'draft-output'), review('draft')],
      dependencies: [{ from: 'draft', to: 'review-draft', mode: 'all' }],
      terminalNodeIds: ['review-draft'],
    };

    await h.service.createStarted(h.tx, {
      spaceId: 'space-1', name: 'Existing page',
      source: { kind: 'page_selection', templateVersion: 1 },
      definition: single, inputs: { brief: 'Improve' },
      bindings: [{ kind: 'task_default', nodeId: 'draft', roleSlotId: 'writer', agentId: 'agent-1' }],
      taskPageIds: { draft: 'page-1' },
    }, principal);

    expect(h.runs[0]).toEqual(expect.objectContaining({
      sourceKind: 'page_selection', templateId: null,
      compositeTemplateVersionId: null, templateInstantiationId: null,
    }));
    expect(h.tx.page.create).not.toHaveBeenCalled();
    expect(h.tasks[0].targetPageId).toBe('page-1');
  });

  it('starts one historical Page from server-read binding state without creating a Page copy', async () => {
    const h = harness();

    const runId = await h.service.createPageSelection({
      spaceId: 'space-1', name: 'Improve existing Page', pageIds: ['page-1'], expectedTreeRevision: 7n,
      idempotencyKey: 'page-selection-1',
    }, principal);

    expect(runId).toBe('run-1');
    expect(h.tx.pageAgentBinding.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { spaceId: 'space-1', pageId: { in: ['page-1'] } },
    }));
    expect(h.tx.page.create).not.toHaveBeenCalled();
    expect(h.runs[0]).toEqual(expect.objectContaining({ sourceKind: 'page_selection' }));
  });

  it('replays a historical Page start before checking a now-stale tree revision', async () => {
    const h = harness();
    const input = {
      spaceId: 'space-1', name: 'Improve existing Page', pageIds: ['page-1'], expectedTreeRevision: 7n,
      idempotencyKey: 'page-selection-replay-1',
    };
    await expect(h.service.createPageSelection(input, principal)).resolves.toBe('run-1');
    h.contentTree.lockPageMutationSpace.mockClear();
    await expect(h.service.createPageSelection(input, principal)).resolves.toBe('run-1');
    expect(h.runs).toHaveLength(1);
    expect(h.contentTree.lockPageMutationSpace).toHaveBeenCalledWith(h.tx, 'space-1');
  });

  it('returns a committed Run when post-commit notification delivery fails', async () => {
    const h = harness();
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    h.notifications.publishCurrentRun.mockRejectedValue(new Error('redis unavailable'));
    await expect(h.service.createPageSelection({
      spaceId: 'space-1', name: 'Improve existing Page', pageIds: ['page-1'], expectedTreeRevision: 7n,
      idempotencyKey: 'page-selection-notification-1',
    }, principal)).resolves.toBe('run-1');
    expect(h.runs).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith({ code: 'COLLABORATION_NOTIFICATION_FAILED', runId: 'run-1' });
    warning.mockRestore();
  });

  it('rejects page-selection idempotency mismatch, a fresh stale revision, and a revoked replay', async () => {
    const h = harness();
    const original = {
      spaceId: 'space-1', name: 'Improve existing Page', pageIds: ['page-1'], expectedTreeRevision: 7n,
      idempotencyKey: 'page-selection-guard-1',
    };
    await h.service.createPageSelection(original, principal);
    await expect(h.service.createPageSelection({ ...original, name: 'Different operation' }, principal))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_IDEMPOTENCY_MISMATCH' });
    await expect(h.service.createPageSelection({
      ...original, idempotencyKey: 'page-selection-fresh-stale-1', expectedTreeRevision: 8n,
    }, principal)).rejects.toMatchObject({ code: 'CONTENT_TREE_CONFLICT' });
    h.authorization.assertLiveHumanSpaceAccess.mockRejectedValueOnce(new BusinessException('SPACE_ACCESS_DENIED'));
    await expect(h.service.createPageSelection(original, principal))
      .rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(h.runs).toHaveLength(1);
  });
});
