import { PageTemplateCategory } from '@prisma/client';
import type { CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import { hashCollaborationTemplate } from '../collaboration-workflows/template-validator';
import { LegacyWorkflowUpgradeService } from './legacy-workflow-upgrade.service';

const principal = { userId: 'user-1' };
const legacyDefinition: CollaborationTemplateDefinition = {
  schemaVersion: 1 as const,
  inputs: [],
  roleSlots: [{ id: 'writer', name: 'Writer', required: true, description: 'Writer' }],
  nodes: [
    {
      kind: 'agent_task' as const, id: 'draft', name: 'Draft', roleSlotId: 'writer',
      objective: 'Draft the page', inputKeys: [], upstreamArtifacts: [],
      output: { key: 'draft-output', kind: 'markdown' as const }, evidenceRequired: [],
      humanAcceptance: true, leaseSeconds: 600, maxExecutionSeconds: 3600,
      retryBudget: 1, repairBudget: 1, skippable: false,
      todos: [{ id: 'write', name: 'Write', required: true, evidenceKinds: [] }],
    },
    {
      kind: 'human_review' as const, id: 'draft-review', name: 'Draft review', artifactTaskId: 'draft',
      minimumRole: 'editor' as const, reviewerUserIds: [], approvalCriteria: ['Accepted'],
      revisionTaskId: 'draft', allowTerminate: true,
    },
  ],
  dependencies: [{ from: 'draft', to: 'draft-review', mode: 'all' as const }],
  terminalNodeIds: ['draft-review'],
};
const definitionHash = hashCollaborationTemplate(legacyDefinition);
const input = {
  expectedLegacyVersion: 3,
  expectedLegacyDefinitionHash: definitionHash,
  name: 'Team workflow', description: 'Upgraded workflow', defaultTitle: 'Workspace',
  category: PageTemplateCategory.knowledge, locale: 'en' as const,
  nodes: [
    { nodeId: 'root', parentNodeId: null, kind: 'folder' as const, order: 0, nameI18n: { en: 'Workspace' } },
    { nodeId: 'page', parentNodeId: 'root', kind: 'page' as const, order: 0, titleI18n: { en: 'Draft' }, contentI18n: { en: '# Draft' }, roleSlotKey: 'writer' },
  ],
  taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'page' }],
};

function setup() {
  const source = {
    id: 'legacy-1', spaceId: 'space-1', scopeKey: 'space-1', system: false,
    archivedAt: null, version: 3, definition: legacyDefinition,
  };
  const tx = {
    collaborationTemplate: {
      findFirst: jest.fn(async ({ where }: any) => where.spaceId === source.spaceId ? source : null),
      updateMany: jest.fn(),
    },
    pageTemplateVersion: { findUnique: jest.fn().mockResolvedValue({ id: 'template-1-version-1' }) },
    pageTemplateVersionLegacyWorkflowSource: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'source-link' }),
    },
  };
  const prisma = { $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };
  const authorization = {
    lockLiveHumanPrincipal: jest.fn(),
    assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner' }),
  };
  const revisionWriter = { lockSpace: jest.fn().mockResolvedValue(tx) };
  const created = { id: 'template-1', currentVersion: 1, definitionHash: 'composite-hash' };
  const pageTemplates = {
    createCompositeSpaceTemplateInLockedTransaction: jest.fn().mockResolvedValue(created),
    getCompositeManagedRecordInLockedTransaction: jest.fn().mockResolvedValue(created),
  };
  const service = new LegacyWorkflowUpgradeService(
    prisma as never, authorization as never, revisionWriter as never, pageTemplates as never,
  );
  return { service, source, tx, authorization, pageTemplates, created };
}

describe('LegacyWorkflowUpgradeService', () => {
  it('previews only an explicit tree and mapping without writes', async () => {
    const { service, tx } = setup();
    const result = await service.preview('space-1', 'legacy-1', input, principal);
    expect(result.issues).toEqual([]);
    expect(result.definition.collaboration!.taskTargets).toEqual(input.taskTargets);
    expect(tx.pageTemplateVersionLegacyWorkflowSource.create).not.toHaveBeenCalled();
  });

  it('adds one deterministic publication gate for a mapped legacy Markdown task', async () => {
    const { service, source } = setup();
    const task = legacyDefinition.nodes[0];
    if (task?.kind !== 'agent_task') throw new Error('Missing draft task fixture');
    source.definition = {
      ...legacyDefinition,
      nodes: [{ ...task, humanAcceptance: false }],
      dependencies: [],
      terminalNodeIds: ['draft'],
    };
    const expectedLegacyDefinitionHash = hashCollaborationTemplate(source.definition);
    const result = await service.preview('space-1', 'legacy-1', {
      ...input, expectedLegacyDefinitionHash,
    }, principal);
    expect(result.issues).toEqual([]);
    expect(result.definition.collaboration!.workflow.nodes).toContainEqual(expect.objectContaining({
      kind: 'human_review', id: 'draft-page-review', artifactTaskId: 'draft',
    }));
    expect(result.definition.collaboration!.workflow.nodes).toContainEqual(expect.objectContaining({
      kind: 'agent_task', id: 'draft', humanAcceptance: true,
    }));
    expect(result.definition.collaboration!.workflow.terminalNodeIds).toEqual(['draft-page-review']);
  });

  it('allocates a schema-bounded non-colliding review id for legacy task ids', async () => {
    const { service, source } = setup();
    const task = legacyDefinition.nodes[0];
    if (task?.kind !== 'agent_task') throw new Error('Missing draft task fixture');
    const longTaskId = 'a'.repeat(128);
    const occupiedReviewId = `${longTaskId.slice(0, 110)}-page-review`;
    source.definition = {
      ...legacyDefinition,
      nodes: [
        { ...task, id: longTaskId, humanAcceptance: false },
        {
          ...task,
          id: occupiedReviewId,
          output: { key: 'external-output', kind: 'external_reference' },
          humanAcceptance: false,
        },
      ],
      dependencies: [{ from: longTaskId, to: occupiedReviewId, mode: 'all' }],
      terminalNodeIds: [occupiedReviewId],
    };
    const expectedLegacyDefinitionHash = hashCollaborationTemplate(source.definition);
    const result = await service.preview('space-1', 'legacy-1', {
      ...input,
      expectedLegacyDefinitionHash,
      taskTargets: [{ taskNodeId: longTaskId, pageNodeId: 'page' }],
    }, principal);
    expect(result.issues).toEqual([]);
    const reviews = result.definition.collaboration!.workflow.nodes.filter((node) =>
      node.kind === 'human_review' && node.artifactTaskId === longTaskId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.id.length).toBeLessThanOrEqual(128);
  });

  it('creates one independent composite version and immutable source link', async () => {
    const { service, tx, pageTemplates, created } = setup();
    const result = await service.upgrade('space-1', 'legacy-1', input, principal);
    expect(result).toEqual(created);
    expect(pageTemplates.createCompositeSpaceTemplateInLockedTransaction).toHaveBeenCalled();
    expect(tx.pageTemplateVersionLegacyWorkflowSource.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      compositeTemplateVersionId: 'template-1-version-1', spaceId: 'space-1',
      legacyTemplateId: 'legacy-1', legacyVersion: 3, legacyDefinitionHash: definitionHash,
      createdById: 'user-1',
    }) });
    expect(tx.collaborationTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('returns the existing name-conflict code without writing a source link', async () => {
    const { service, tx, pageTemplates } = setup();
    pageTemplates.createCompositeSpaceTemplateInLockedTransaction.mockRejectedValue(
      Object.assign(new Error('conflict'), { businessCode: 'PAGE_TEMPLATE_NAME_CONFLICT' }),
    );
    await expect(service.upgrade('space-1', 'legacy-1', input, principal))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_NAME_CONFLICT' });
    expect(tx.pageTemplateVersionLegacyWorkflowSource.create).not.toHaveBeenCalled();
  });

  it('replays the same request before applying stale source CAS, but rejects a different payload', async () => {
    const { service, source, tx, created } = setup();
    const preview = await service.preview('space-1', 'legacy-1', input, principal);
    tx.pageTemplateVersionLegacyWorkflowSource.findUnique.mockResolvedValue({
      upgradeRequestHash: preview.upgradeRequestHash, compositeTemplateVersion: { template: created },
    });
    source.version = 4;
    const replay = await service.upgrade('space-1', 'legacy-1', input, principal);
    expect(replay).toEqual(created);
    await expect(service.upgrade('space-1', 'legacy-1', { ...input, name: 'Different' }, principal))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_UPGRADE_CONFLICT' });
  });

  it('returns explicit issues for missing mappings and multiple retained legacy human gates', async () => {
    const { service, source } = setup();
    source.definition = {
      ...legacyDefinition,
      nodes: [...legacyDefinition.nodes, { ...legacyDefinition.nodes[1], id: 'second-review' }],
      dependencies: [...legacyDefinition.dependencies, { from: 'draft', to: 'second-review', mode: 'all' }],
      terminalNodeIds: ['draft-review', 'second-review'],
    };
    source.version = 3;
    const changedHash = hashCollaborationTemplate(source.definition);
    const result = await service.preview('space-1', 'legacy-1', {
      ...input, expectedLegacyDefinitionHash: changedHash, taskTargets: [],
    }, principal);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'LEGACY_REQUIRED_HUMAN_GATES_MULTIPLE', 'TEMPLATE_MARKDOWN_TARGET_REQUIRED',
    ]));
  });

  it('rejects system, cross-Space, stale version/hash and agents while leaving legacy untouched', async () => {
    const { service, source } = setup();
    await expect(service.preview('space-2', 'legacy-1', input, principal))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_TEMPLATE_NOT_FOUND' });
    source.spaceId = 'space-1';
    await expect(service.preview('space-1', 'legacy-1', { ...input, expectedLegacyVersion: 2 }, principal))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_TEMPLATE_VERSION_CONFLICT' });
    await expect(service.preview('space-1', 'legacy-1', {
      ...input, expectedLegacyDefinitionHash: '0'.repeat(64),
    }, principal)).rejects.toMatchObject({ businessCode: 'COLLABORATION_TEMPLATE_VERSION_CONFLICT' });
    await expect(service.preview('space-1', 'legacy-1', input, { userId: 'user-1', agentId: 'agent-1' }))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_PERMISSION_DENIED' });
  });
});
