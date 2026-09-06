import type { CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import {
  FolderTemplateSnapshotService,
  snapshotDefinition,
  snapshotDefinitionWithSourceMap,
  type FolderSnapshotSource,
  type FolderTemplateSnapshotSaveInput,
  type FolderTemplateSnapshotSelection,
} from './folder-template-snapshot.service';
import type { Principal } from '../core/authorization/authorization.service';
import { hashCompositeDefinition } from './composite-template-validator';
import { expandTemplateDefinition } from './template-instantiation.service';

const workflow: CollaborationTemplateDefinition = {
  schemaVersion: 1,
  inputs: [],
  roleSlots: [{ id: 'writer', name: 'Writer', required: true, description: 'Writes' }],
  nodes: [{
    kind: 'agent_task', id: 'draft', name: 'Draft', roleSlotId: 'writer', objective: 'Draft',
    inputKeys: [], upstreamArtifacts: [], output: { key: 'draft', kind: 'markdown' },
    evidenceRequired: [], humanAcceptance: true, leaseSeconds: 300, maxExecutionSeconds: 3600,
    retryBudget: 1, repairBudget: 1, skippable: false,
    todos: [{ id: 'write', name: 'Write', required: true, evidenceKinds: [] }],
  }, {
    kind: 'human_review', id: 'review-draft', name: 'Review', artifactTaskId: 'draft',
    minimumRole: 'editor', reviewerUserIds: [], approvalCriteria: ['Complete'],
    revisionTaskId: 'draft', allowTerminate: true,
  }],
  dependencies: [{ from: 'draft', to: 'review-draft', mode: 'all' }],
  terminalNodeIds: ['review-draft'],
};

const source = (): FolderSnapshotSource => ({
  nodes: [
    { sourceId: 'root-id', parentSourceId: null, kind: 'folder', order: 0, name: 'Root' },
    { sourceId: 'child-id', parentSourceId: 'root-id', kind: 'folder', order: 1, name: 'Child' },
    {
      sourceId: 'page-a', parentSourceId: 'root-id', kind: 'page', order: 0,
      title: 'Overview', content: '# Saved\n![[assets/chart.png]]', sourceSyncPath: 'pages/Root/Overview.md',
    },
    {
      sourceId: 'page-b', parentSourceId: 'child-id', kind: 'page', order: 0,
      title: 'Details', content: '# Details', sourceSyncPath: 'pages/Root/Child/Details.md',
    },
  ],
  bindings: [
    { pageId: 'page-b', hasAgent: true, roleSlotKey: null, agentId: 'agent-secret-2' },
  ],
});

describe('folder template snapshot transformation', () => {
  it('preserves eleven equal-order Pages and folder-first source sibling order with deterministic ranks', () => {
    const input: FolderSnapshotSource = { bindings: [], nodes: [
      { sourceId: 'root', parentSourceId: null, kind: 'folder', name: 'Root', order: 0 },
      ...Array.from({ length: 11 }, (_, index) => ({
        sourceId: `p${String(index + 1).padStart(2, '0')}`, parentSourceId: 'root', kind: 'page' as const,
        order: 0, title: `Page ${index + 1}`, content: '', sourceSyncPath: '',
      })),
      { sourceId: 'child', parentSourceId: 'root', kind: 'folder', name: 'Folder first', order: 0 },
    ] };
    const saved = snapshotDefinition(input, { kind: 'structure_only' });
    const expanded = expandTemplateDefinition(saved, 'en');
    expect(expanded.filter((node) => node.parentNodeId !== null).map((node) => node.kind === 'page' ? node.title : node.name))
      .toEqual(['Folder first', 'Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5', 'Page 6', 'Page 7', 'Page 8', 'Page 9', 'Page 10', 'Page 11']);
    expect(saved.nodes.filter((node) => node.parentNodeId !== null).map((node) => node.order))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
  it('strips every role and collaboration field for structure-only snapshots', () => {
    const input = source();
    const before = structuredClone(input);

    const saved = snapshotDefinition(input, { kind: 'structure_only' });

    expect(saved.collaboration).toBeNull();
    expect(saved.nodes.filter((node) => node.kind === 'page')
      .every((node) => node.roleSlotKey === null)).toBe(true);
    expect(saved.nodes.map((node) => node.nodeId)).toEqual(['folder-1', 'folder-2', 'page-1', 'page-2']);
    expect(saved.nodes.find((node) => node.kind === 'page' && node.nodeId === 'page-2'))
      .toEqual(expect.objectContaining({ contentI18n: { en: '# Saved\n![[assets/chart.png]]' } }));
    expect(JSON.stringify(saved)).not.toMatch(/root-id|page-a|agent-secret/u);
    expect(input).toEqual(before);
  });

  it('creates one independent task and one human gate for each assigned simple page', () => {
    const selection: FolderTemplateSnapshotSelection = {
      excludedFolderIds: [], locale: 'en',
      excludedPageIds: [],
      roleSlotsByPage: [{ pageId: 'page-a', roleSlotKey: 'lead' }],
      source: { kind: 'simple_pages' },
    };

    const saved = snapshotDefinition(source(), selection.source, selection.roleSlotsByPage);

    expect(saved.collaboration?.taskTargets).toHaveLength(2);
    expect(saved.collaboration?.workflow.nodes.filter((node) => node.kind === 'agent_task')).toHaveLength(2);
    expect(saved.collaboration?.workflow.nodes.filter((node) => node.kind === 'human_review')).toHaveLength(2);
    expect(saved.collaboration?.workflow.roleSlots.map((slot) => slot.id)).toEqual([
      'page-2-lead',
      'page-1-owner',
    ]);
    expect(JSON.stringify(saved)).not.toMatch(/agent-secret/u);
  });

  it('retains an explicit workflow mapping and rejects pruning required terminal controls', () => {
    const prepared = source();
    prepared.workflow = { definition: workflow, taskTargets: [{ taskNodeId: 'draft', pageId: 'page-a' }] };

    expect(snapshotDefinition(prepared, {
      kind: 'legacy_workflow', templateId: 'legacy', version: 1,
      taskTargets: [{ taskNodeId: 'draft', pageId: 'page-a' }],
    }).collaboration?.taskTargets).toEqual([{ taskNodeId: 'draft', pageNodeId: 'page-2' }]);

    prepared.nodes = prepared.nodes.filter((node) => node.sourceId !== 'page-a');
    expect(() => snapshotDefinition(prepared, {
      kind: 'legacy_workflow', templateId: 'legacy', version: 1,
      taskTargets: [{ taskNodeId: 'draft', pageId: 'page-a' }],
    })).toThrow(expect.objectContaining({ businessCode: 'PAGE_TEMPLATE_INVALID' }));
  });

  it('returns source identity and parent mappings from the same traversal despite repeated names', () => {
    const repeated: FolderSnapshotSource = {
      nodes: [
        { sourceId: 'folder-root', parentSourceId: null, kind: 'folder', order: 0, name: 'Repeated' },
        { sourceId: 'folder-child', parentSourceId: 'folder-root', kind: 'folder', order: 0, name: 'Repeated' },
        {
          sourceId: 'page-root', parentSourceId: 'folder-root', kind: 'page', order: 0,
          title: 'Repeated', content: '# Root', sourceSyncPath: 'root.md',
        },
        {
          sourceId: 'page-child', parentSourceId: 'folder-child', kind: 'page', order: 0,
          title: 'Repeated', content: '# Child', sourceSyncPath: 'child.md',
        },
      ],
      bindings: [],
    };

    const result = snapshotDefinitionWithSourceMap(repeated, { kind: 'structure_only' });

    expect(result.sourceNodes).toEqual([
      {
        templateNodeId: 'folder-1', sourceNodeId: 'folder-root', parentSourceNodeId: null,
        parentTemplateNodeId: null, kind: 'folder', name: 'Repeated',
      },
      {
        templateNodeId: 'folder-2', sourceNodeId: 'folder-child', parentSourceNodeId: 'folder-root',
        parentTemplateNodeId: 'folder-1', kind: 'folder', name: 'Repeated',
      },
      {
        templateNodeId: 'page-1', sourceNodeId: 'page-child', parentSourceNodeId: 'folder-child',
        parentTemplateNodeId: 'folder-2', kind: 'page', title: 'Repeated',
      },
      {
        templateNodeId: 'page-2', sourceNodeId: 'page-root', parentSourceNodeId: 'folder-root',
        parentTemplateNodeId: 'folder-1', kind: 'page', title: 'Repeated',
      },
    ]);
    expect(JSON.stringify(result.definition)).not.toMatch(/folder-root|folder-child|page-root|page-child/u);
  });

});

describe('FolderTemplateSnapshotService', () => {
  const principal: Principal = { userId: 'owner-1' };
  const root = {
    id: 'root-id', spaceId: 'space-1', parentId: null, name: 'Root', sortOrder: 0,
    updatedAt: new Date('2026-09-05T01:00:00.000Z'),
  };
  const page = {
    id: 'page-a', folderId: 'root-id', title: 'Overview', content: '# Saved',
    format: 'markdown', syncPath: 'pages/Root/Overview.md', sortOrder: 0,
    updatedAt: new Date('2026-09-05T01:00:00.000Z'), spaceId: 'space-1', deletedAt: null,
  };
  const tx = {
    space: { findUnique: jest.fn() },
    folder: { findFirst: jest.fn(), findMany: jest.fn() },
    page: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    pageVersion: { findFirst: jest.fn() },
    pageAgentBinding: { findMany: jest.fn() },
    pageTemplateVersion: { findFirst: jest.fn(), findUnique: jest.fn() },
    templateInstantiation: { findFirst: jest.fn() },
    collaborationTemplate: { findFirst: jest.fn() },
    spaceAttachment: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  } as any;
  const prisma = { $transaction: jest.fn() } as any;
  const authorization = {
    lockLiveHumanPrincipal: jest.fn(),
    assertLiveHumanSpaceAccess: jest.fn(),
  } as any;
  const revisionWriter = { lockSpace: jest.fn() } as any;
  const markdownResources = { resolveReferencedAttachmentsBatch: jest.fn() } as any;
  const pageTemplates = { createCompositeSpaceTemplateInLockedTransaction: jest.fn() } as any;
  let service: FolderTemplateSnapshotService;

  const selection: FolderTemplateSnapshotSelection = {
    excludedFolderIds: [], excludedPageIds: [], locale: 'en', source: { kind: 'structure_only' },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx));
    revisionWriter.lockSpace.mockResolvedValue(tx);
    tx.space.findUnique.mockResolvedValue({ contentTreeRevision: 9n });
    tx.folder.findFirst.mockResolvedValue(root);
    tx.folder.findMany.mockResolvedValue([]);
    tx.$queryRaw.mockResolvedValue([{ ...root, depth: 1 }]);
    tx.page.findMany.mockResolvedValue([page]);
    tx.page.findUnique.mockResolvedValue(page);
    tx.pageVersion.findFirst.mockResolvedValue({ id: 'page-version-current' });
    tx.pageAgentBinding.findMany.mockResolvedValue([]);
    markdownResources.resolveReferencedAttachmentsBatch.mockResolvedValue([{
      attachmentIds: [], references: [], errors: [],
    }]);
    pageTemplates.createCompositeSpaceTemplateInLockedTransaction.mockResolvedValue({
      id: 'saved-template', currentVersion: 1,
    });
    service = new FolderTemplateSnapshotService(
      prisma, authorization, revisionWriter, markdownResources, pageTemplates,
    );
  });

  it('detects a persisted body-only change even when tree revision is unchanged', async () => {
    const preview = await service.preview('space-1', 'root-id', selection, principal);
    tx.page.findMany.mockResolvedValue([{ ...page, content: '# Changed' }]);
    tx.page.findUnique.mockResolvedValue({ ...page, content: '# Changed' });

    await expect(service.save('space-1', {
      rootFolderId: 'root-id', selection, sourceToken: preview.sourceToken,
      acknowledgedWarnings: [], name: 'Saved folder', defaultTitle: 'Root',
      description: '', category: 'knowledge', locale: 'en',
    }, principal)).rejects.toMatchObject({ businessCode: 'SOURCE_CHANGED' });
    expect(pageTemplates.createCompositeSpaceTemplateInLockedTransaction).not.toHaveBeenCalled();
  });

  it('warns without rewriting Markdown and requires explicit attachment acknowledgement', async () => {
    tx.page.findMany.mockResolvedValue([{ ...page, content: '# Saved\n![[assets/chart.png]]' }]);
    tx.page.findUnique.mockResolvedValue({ ...page, content: '# Saved\n![[assets/chart.png]]' });
    markdownResources.resolveReferencedAttachmentsBatch.mockResolvedValue([{
      attachmentIds: ['attachment-1'], references: [{ attachmentId: 'attachment-1' }],
      errors: [{ code: 'ATTACHMENT_MISSING', targetStart: 10, targetEnd: 34 }],
    }]);
    const preview = await service.preview('space-1', 'root-id', selection, principal);
    expect(preview.warnings).toContainEqual(expect.objectContaining({
      code: 'ATTACHMENTS_NOT_COPIED', affectedPageIds: ['page-a'],
    }));
    expect(preview.definition.nodes.find((node) => node.kind === 'page')).toEqual(
      expect.objectContaining({ contentI18n: { en: '# Saved\n![[assets/chart.png]]' } }),
    );

    const input: FolderTemplateSnapshotSaveInput = {
      rootFolderId: 'root-id', selection, sourceToken: preview.sourceToken,
      acknowledgedWarnings: [], name: 'Saved folder', defaultTitle: 'Root',
      description: '', category: 'knowledge', locale: 'en',
    };
    await expect(service.save('space-1', input, principal))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_WARNING_CONFIRMATION_REQUIRED' });

    await expect(service.save('space-1', {
      ...input, acknowledgedWarnings: ['ATTACHMENTS_NOT_COPIED'],
    }, principal)).resolves.toEqual({ id: 'saved-template', currentVersion: 1 });
    expect(pageTemplates.createCompositeSpaceTemplateInLockedTransaction).toHaveBeenCalledWith(
      tx,
      'space-1',
      expect.objectContaining({
        locale: 'en',
        definition: expect.objectContaining({ nodes: expect.any(Array) }),
      }),
      principal,
    );
  });

  it('rejects source objects outside the explicit workflow-source union', async () => {
    await expect(service.preview('space-1', 'root-id', {
      ...selection,
      source: { kind: 'structure_only', versionId: 'smuggled-version' } as any,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
  });

  it('rejects oversized selection vectors before running a recursive source query', async () => {
    await expect(service.preview('space-1', 'root-id', {
      ...selection,
      excludedFolderIds: Array.from({ length: 101 }, (_, index) => `folder-${index}`),
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();

    await expect(service.preview('space-1', 'root-id', {
      ...selection,
      roleSlotsByPage: Array.from({ length: 51 }, (_, index) => ({
        pageId: `page-${index}`, roleSlotKey: 'writer',
      })),
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
  });

  it('rejects malformed role overrides and warning acknowledgements with stable errors', async () => {
    await expect(service.preview('space-1', 'root-id', {
      ...selection, roleSlotsByPage: {} as any,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });

    const preview = await service.preview('space-1', 'root-id', selection, principal);
    expect(() => service.save('space-1', {
      rootFolderId: 'root-id', selection, sourceToken: preview.sourceToken,
      acknowledgedWarnings: null as any, name: 'Saved folder', defaultTitle: 'Root',
      description: '', category: 'knowledge', locale: 'en',
    }, principal)).toThrow(expect.objectContaining({ businessCode: 'PAGE_TEMPLATE_INVALID' }));
  });

  it('uses only the exact same-Space template instantiation mapping for workflow targets', async () => {
    const templateDefinition = {
      schemaVersion: 1 as const,
      kind: 'page_group' as const,
      nodes: [
        { nodeId: 'template-root', parentNodeId: null, kind: 'folder' as const, order: 0, nameI18n: { en: 'Root' } },
        {
          nodeId: 'template-page', parentNodeId: 'template-root', kind: 'page' as const,
          order: 0, titleI18n: { en: 'Overview' }, contentI18n: { en: '# Source' }, roleSlotKey: 'writer',
        },
      ],
      collaboration: {
        workflow,
        taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'template-page' }],
      },
    };
    tx.pageTemplateVersion.findFirst.mockResolvedValue({
      id: 'template-version', version: 3, definition: templateDefinition,
      schemaVersion: 1, definitionHash: hashCompositeDefinition(templateDefinition),
      template: { id: 'template-id', sourceLocale: 'en' },
    });
    tx.templateInstantiation.findFirst.mockResolvedValue({
      id: 'instantiation-id',
      nodes: [
        { templateNodeId: 'template-root', kind: 'folder', folderId: 'root-id', pageId: null },
        { templateNodeId: 'template-page', kind: 'page', folderId: null, pageId: 'page-a' },
      ],
    });

    const preview = await service.preview('space-1', 'root-id', {
      ...selection, source: { kind: 'template', versionId: 'template-version' },
    }, principal);

    expect(preview.definition.collaboration?.taskTargets).toEqual([
      { taskNodeId: 'draft', pageNodeId: 'page-1' },
    ]);
    expect(preview.sourceToken.workflowSource).toEqual(expect.objectContaining({
      kind: 'template', versionId: 'template-version', instantiationId: 'instantiation-id',
    }));

    tx.templateInstantiation.findFirst.mockResolvedValue(null);
    await expect(service.preview('space-1', 'root-id', {
      ...selection, source: { kind: 'template', versionId: 'template-version' },
    }, principal)).rejects.toMatchObject({ businessCode: 'SOURCE_INVALID' });
  });

  it('resolves a next Run only from the exact instance root and mapped Pages', async () => {
    const templateDefinition = {
      schemaVersion: 1 as const,
      kind: 'page_group' as const,
      nodes: [
        { nodeId: 'template-root', parentNodeId: null, kind: 'folder' as const, order: 0, nameI18n: { en: 'Root' } },
        {
          nodeId: 'template-page', parentNodeId: 'template-root', kind: 'page' as const,
          order: 0, titleI18n: { en: 'Overview' }, contentI18n: { en: '# Source' }, roleSlotKey: 'writer',
        },
      ],
      collaboration: { workflow, taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'template-page' }] },
    };
    tx.page.findFirst.mockResolvedValue(null);
    tx.templateInstantiation.findFirst.mockResolvedValue({
      id: 'instantiation-id',
      compositeTemplateVersion: {
        id: 'template-version', version: 3, definition: templateDefinition, schemaVersion: 1,
        definitionHash: hashCompositeDefinition(templateDefinition), template: { archivedAt: null },
      },
      nodes: [
        { templateNodeId: 'template-root', kind: 'folder', folderId: 'root-id', pageId: null },
        { templateNodeId: 'template-page', kind: 'page', folderId: null, pageId: 'page-a' },
      ],
    });

    await expect(service.prepareExistingRunSource(tx, 'space-1', 'root-id', {
      source: { kind: 'template_instantiation', sourceInstantiationId: 'instantiation-id' },
      pageIds: ['page-a'],
    })).resolves.toEqual(expect.objectContaining({
      source: {
        kind: 'composite', compositeTemplateVersionId: 'template-version',
        templateInstantiationId: null, templateVersion: 3,
      },
      sourceInstantiationId: 'instantiation-id',
      pageIds: ['page-a'], taskPageIds: { draft: 'page-a' },
    }));

    tx.templateInstantiation.findFirst.mockResolvedValueOnce({
      id: 'instantiation-id',
      compositeTemplateVersion: {
        id: 'template-version', version: 3, definition: templateDefinition, schemaVersion: 1,
        definitionHash: hashCompositeDefinition(templateDefinition), template: { archivedAt: null },
      },
      nodes: [
        { templateNodeId: 'template-root', kind: 'folder', folderId: 'other-root', pageId: null },
        { templateNodeId: 'template-page', kind: 'page', folderId: null, pageId: 'page-a' },
      ],
    });
    await expect(service.prepareExistingRunSource(tx, 'space-1', 'root-id', {
      source: { kind: 'template_instantiation', sourceInstantiationId: 'instantiation-id' },
      pageIds: ['page-a'],
    })).rejects.toMatchObject({ businessCode: 'SOURCE_INVALID' });
  });

  it('previews an unbound historical Page as a stable role-required issue without inventing a task', async () => {
    tx.page.findFirst.mockResolvedValue(null);
    const preview = await service.prepareExistingRunSource(tx, 'space-1', 'root-id', {
      source: { kind: 'page_selection' }, pageIds: ['page-a'],
    });
    expect(preview).toEqual(expect.objectContaining({
      definition: null,
      pageIds: ['page-a'],
      pages: [{ pageId: 'page-a', title: 'Overview' }],
      taskPageIds: {},
      defaultBindings: [],
      issues: [{ code: 'PAGE_ROLE_REQUIRED', pageId: 'page-a' }],
    }));
    await expect(service.prepareExistingRunSource(tx, 'space-1', 'root-id', {
      source: { kind: 'page_selection' }, pageIds: ['page-a'], enabledTaskNodeIds: [],
    })).rejects.toMatchObject({ businessCode: 'COLLABORATION_TEMPLATE_INVALID' });

    await expect(service.prepareExistingRunSource(tx, 'space-1', 'root-id', {
      source: { kind: 'page_selection' }, pageIds: ['page-a'],
      roleSlotsByPage: [{ pageId: 'page-a', roleSlotKey: 'writer' }],
    })).resolves.toEqual(expect.objectContaining({
      pageIds: ['page-a'],
      taskPageIds: { 'write-page-1': 'page-a' },
    }));
  });

  it('prunes independent simple-page tasks, gates, targets, and default Agents from one stable full-scope mapping', async () => {
    tx.page.findFirst.mockResolvedValue(null);
    const pageB = {
      ...page,
      id: 'page-b', title: 'Details', sortOrder: 1,
      syncPath: 'pages/Root/Details.md',
    };
    tx.page.findMany.mockResolvedValue([page, pageB]);
    tx.pageAgentBinding.findMany.mockResolvedValue([
      { pageId: 'page-a', agentId: 'agent-a', roleSlotKey: 'writer' },
      { pageId: 'page-b', agentId: 'agent-b', roleSlotKey: 'editor' },
    ]);

    const first = await service.prepareExistingRunSource(tx, 'space-1', 'root-id', {
      source: { kind: 'page_selection' }, pageIds: ['page-a', 'page-b'],
      enabledTaskNodeIds: ['write-page-1'],
    });
    expect(first.taskPageIds).toEqual({ 'write-page-1': 'page-a' });
    expect(first.defaultBindings).toEqual([
      expect.objectContaining({ nodeId: 'write-page-1', agentId: 'agent-a' }),
    ]);
    expect(first.definition?.nodes.map((node) => node.id)).toEqual([
      'write-page-1', 'write-page-1-page-review',
    ]);
    expect(first.definition?.terminalNodeIds).toEqual(['write-page-1-page-review']);

    const second = await service.prepareExistingRunSource(tx, 'space-1', 'root-id', {
      source: { kind: 'page_selection' }, pageIds: ['page-a', 'page-b'],
      enabledTaskNodeIds: ['write-page-2'],
    });
    expect(second.taskPageIds).toEqual({ 'write-page-2': 'page-b' });
    expect(second.defaultBindings).toEqual([
      expect.objectContaining({ nodeId: 'write-page-2', agentId: 'agent-b' }),
    ]);
    expect(second.definition?.nodes.map((node) => node.id)).toEqual([
      'write-page-2', 'write-page-2-page-review',
    ]);
    expect(second.definition?.terminalNodeIds).toEqual(['write-page-2-page-review']);

    await expect(service.prepareExistingRunSource(tx, 'space-1', 'root-id', {
      source: { kind: 'page_selection' }, pageIds: ['page-a', 'page-b'],
      enabledTaskNodeIds: [],
    })).rejects.toMatchObject({ businessCode: 'COLLABORATION_TEMPLATE_INVALID' });
    await expect(service.prepareExistingRunSource(tx, 'space-1', 'root-id', {
      source: { kind: 'page_selection' }, pageIds: ['page-a', 'page-b'],
      enabledTaskNodeIds: ['write-page-unknown'],
    })).rejects.toMatchObject({ businessCode: 'COLLABORATION_TEMPLATE_INVALID' });
  });
});
