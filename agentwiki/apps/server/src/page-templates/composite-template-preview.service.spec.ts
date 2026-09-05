import { CompositeTemplatePreviewService } from './composite-template-preview.service';

const principal = { userId: 'human-1' };
const definition = {
  schemaVersion: 1 as const,
  kind: 'single_page' as const,
  nodes: [{
    nodeId: 'page', parentNodeId: null, kind: 'page' as const, order: 0,
    titleI18n: { en: 'Draft' }, contentI18n: { en: '# Draft' }, roleSlotKey: null,
  }],
  collaboration: null,
};

const requiredInputDefinition = {
  ...definition,
  collaboration: {
    workflow: {
      schemaVersion: 1 as const,
      inputs: [{ key: 'brief', label: 'Brief', type: 'long_text' as const, required: true }],
      roleSlots: [{ id: 'writer', name: 'Writer', required: true, description: 'Writes' }],
      nodes: [{
        kind: 'agent_task' as const, id: 'write-page', name: 'Write', roleSlotId: 'writer', objective: 'Write',
        inputKeys: ['brief'], upstreamArtifacts: [], output: { key: 'page-markdown', kind: 'markdown' as const },
        evidenceRequired: [], humanAcceptance: true, leaseSeconds: 300, maxExecutionSeconds: 3600,
        retryBudget: 1, repairBudget: 1, skippable: false,
        todos: [{ id: 'write', name: 'Write', required: true, evidenceKinds: [] }],
      }, {
        kind: 'human_review' as const, id: 'review-write-page', name: 'Review', artifactTaskId: 'write-page',
        minimumRole: 'editor' as const, reviewerUserIds: [], approvalCriteria: ['Complete'],
        revisionTaskId: 'write-page', allowTerminate: true,
      }],
      dependencies: [{ from: 'write-page', to: 'review-write-page', mode: 'all' as const }],
      terminalNodeIds: ['review-write-page'],
    },
    taskTargets: [{ taskNodeId: 'write-page', pageNodeId: 'page' }],
  },
};

describe('CompositeTemplatePreviewService', () => {
  it('uses the exact resolved version and returns missing mappings without writes', async () => {
    const tx: any = { space: { findUnique: jest.fn().mockResolvedValue({ contentTreeRevision: 7n }) } };
    const prisma: any = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const authorization: any = { assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'viewer' }) };
    const catalog: any = { resolve: jest.fn().mockResolvedValue({
      definition, definitionHash: 'a'.repeat(64), locale: 'en',
    }) };
    const service = new CompositeTemplatePreviewService(prisma, authorization, catalog);

    const result = await service.preview('space-1', 'template-1', {
      templateVersion: 3, locale: 'en', variables: {}, collaborationEnabled: true,
      roleBindings: [],
    }, principal as any);

    expect(result).toEqual(expect.objectContaining({
      definitionHash: 'a'.repeat(64), treeRevision: 7n,
      pageCount: 1, folderCount: 0, roleCount: 1,
      participants: [],
      issues: [{ code: 'ROLE_BINDING_REQUIRED', roleSlotId: 'writer', nodeIds: ['write-page'] }],
    }));
    expect(catalog.resolve).toHaveBeenCalledWith(tx, 'space-1', 'template-1', 3, 'en');
    expect(Object.keys(tx)).toEqual(['space']);
  });

  it('deduplicates mapped participants and reports conflicting roles deterministically', async () => {
    const tx: any = { space: { findUnique: jest.fn().mockResolvedValue({ contentTreeRevision: 7n }) } };
    const service = new CompositeTemplatePreviewService(
      { $transaction: (callback: any) => callback(tx) } as any,
      { assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'editor' }) } as any,
      { resolve: jest.fn().mockResolvedValue({ definition, definitionHash: 'a'.repeat(64), locale: 'en' }) } as any,
    );
    const result = await service.preview('space-1', 'template-1', {
      templateVersion: 3, locale: 'en', variables: {}, collaborationEnabled: true,
      roleBindings: [
        { kind: 'role_override', roleSlotId: 'writer', agentId: 'agent-b' },
        { kind: 'role_override', roleSlotId: 'writer', agentId: 'agent-a' },
      ],
    }, principal as any);
    expect(result.assignments).toEqual([]);
    expect(result.participants).toEqual([]);
    expect(result.issues).toEqual([{
      code: 'ROLE_BINDING_CONFLICT', roleSlotId: 'writer', nodeIds: ['write-page'],
      agentIds: ['agent-a', 'agent-b'],
    }]);
  });

  it('returns input, Agent preparation, and target-parent issues without writing', async () => {
    const tx: any = {
      space: { findUnique: jest.fn().mockResolvedValue({ contentTreeRevision: 7n }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      agentGrant: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CompositeTemplatePreviewService(
      { $transaction: (callback: any) => callback(tx) } as any,
      { assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'viewer' }) } as any,
      { resolve: jest.fn().mockResolvedValue({ definition, definitionHash: 'a'.repeat(64), locale: 'en' }) } as any,
    );
    const result = await service.preview('space-1', 'template-1', {
      templateVersion: 3, locale: 'en', targetParentFolderId: 'deleted-parent',
      variables: {}, collaborationEnabled: true,
      collaborationInputs: {},
      roleBindings: [{ kind: 'role_override', roleSlotId: 'writer', agentId: 'agent-1' }],
    }, principal as any);
    expect(result.inputs).toEqual([]);
    expect(result.issues).toEqual(expect.arrayContaining([
      { code: 'TARGET_PARENT_FOLDER_NOT_FOUND', folderId: 'deleted-parent' },
      { code: 'COLLABORATION_AGENT_CANNOT_EXECUTE', agentId: 'agent-1' },
    ]));
    expect(tx.agentGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { spaceId: 'space-1', agentId: { in: ['agent-1'] } },
    }));
    expect(Object.keys(tx).sort()).toEqual(['$queryRaw', 'agentGrant', 'space']);
  });

  it('returns a stable missing-input issue instead of failing preview configuration', async () => {
    const tx: any = { space: { findUnique: jest.fn().mockResolvedValue({ contentTreeRevision: 7n }) } };
    const service = new CompositeTemplatePreviewService(
      { $transaction: (callback: any) => callback(tx) } as any,
      { assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'viewer' }) } as any,
      { resolve: jest.fn().mockResolvedValue({
        definition: requiredInputDefinition, definitionHash: 'a'.repeat(64), locale: 'en',
      }) } as any,
    );
    const result = await service.preview('space-1', 'template-1', {
      templateVersion: 3, locale: 'en', variables: {}, collaborationEnabled: true,
      roleBindings: [], collaborationInputs: {},
    }, principal as any);
    expect(result.inputs).toEqual([{ key: 'brief', label: 'Brief', type: 'long_text', required: true }]);
    expect(result.issues).toEqual(expect.arrayContaining([
      { code: 'COLLABORATION_INPUT_REQUIRED', inputKey: 'brief' },
    ]));
  });
});
