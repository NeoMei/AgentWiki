import { Prisma } from '@prisma/client';
import { hashCompositeDefinition } from './composite-template-validator';
import {
  TemplateInstantiationService,
  type TemplateInstantiationInput,
} from './template-instantiation.service';

const now = new Date('2026-09-05T00:00:00.000Z');
const principal = { userId: 'user-1', platformRole: 'user' as const };
const definition = {
  schemaVersion: 1 as const,
  kind: 'page_group' as const,
  nodes: [
    { nodeId: 'root', parentNodeId: null, kind: 'folder' as const, order: 0, nameI18n: { en: 'Project' } },
    { nodeId: 'intro', parentNodeId: 'root', kind: 'page' as const, order: 0, titleI18n: { en: 'Intro' }, contentI18n: { en: '# Intro' }, roleSlotKey: null },
    { nodeId: 'plan', parentNodeId: 'root', kind: 'folder' as const, order: 1, nameI18n: { en: 'Plan' } },
    { nodeId: 'tasks', parentNodeId: 'plan', kind: 'page' as const, order: 0, titleI18n: { en: 'Tasks' }, contentI18n: { en: '# Tasks' }, roleSlotKey: null },
    { nodeId: 'risks', parentNodeId: 'plan', kind: 'page' as const, order: 1, titleI18n: { en: 'Risks' }, contentI18n: { en: '# Risks' }, roleSlotKey: null },
  ],
  collaboration: null,
};

function input(overrides: Partial<TemplateInstantiationInput> = {}): TemplateInstantiationInput {
  return {
    templateVersion: 3,
    locale: 'en',
    targetParentFolderId: null,
    variables: {},
    collaborationEnabled: false,
    expectedTreeRevision: 4n,
    idempotencyKey: 'instantiate-0001',
    ...overrides,
  };
}

function makeHarness() {
  const folders = new Map<string, any>();
  const tx: any = Object.assign({
    $queryRaw: jest.fn().mockResolvedValue([]),
    pageTemplate: { findUnique: jest.fn().mockResolvedValue({
      id: 'template-1', scope: 'system', spaceId: null, sourceLocale: null, archivedAt: null,
    }) },
    pageTemplateVersion: { findUnique: jest.fn().mockResolvedValue({
      id: 'template-version-3', templateId: 'template-1', version: 3,
      definition, schemaVersion: 1, definitionHash: hashCompositeDefinition(definition),
    }) },
    templateInstantiation: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: data.id, ...data })),
    },
    templateInstantiationNode: { createMany: jest.fn().mockResolvedValue({ count: 5 }) },
    templateEffectJob: { createMany: jest.fn().mockResolvedValue({ count: 4 }) },
    folder: {
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: -1 } }),
    },
    page: {
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: -1 } }),
      create: jest.fn(async ({ data }: any) => ({ ...data, createdAt: now, updatedAt: now })),
    },
    pageVersion: { create: jest.fn(async ({ data }: any) => data) },
  }, { contentTreeRevision: 4n });
  const prisma: any = {
    $transaction: jest.fn(async (callback: (transaction: any) => unknown, options: unknown) => {
      expect(options).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 120_000,
      });
      return callback(tx);
    }),
  };
  const authorization: any = {
    lockLiveHumanPrincipal: jest.fn().mockResolvedValue({ id: 'user-1' }),
    assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner' }),
  };
  let folderSequence = 0;
  const contentTree: any = {
    lockPageMutationSpace: jest.fn(async () => tx),
    createFolderLocked: jest.fn(async (_lockedTx: any, folderInput: any) => {
      const folder = { id: `folder-${++folderSequence}`, ...folderInput, createdAt: now, updatedAt: now };
      folders.set(folderInput.name, folder);
      return folder;
    }),
    placePage: jest.fn(async (_lockedTx: any, pageInput: any) => ({
      folderId: pageInput.folderId,
      syncPath: `pages/${pageInput.title}.md`,
      syncPathKey: `pages/${pageInput.title.toLowerCase()}.md`,
    })),
    advancePageMutation: jest.fn().mockResolvedValue({ treeRevision: 5n, syncRevisionId: 'sync-1' }),
  };
  return {
    service: new TemplateInstantiationService(prisma, authorization, contentTree),
    prisma, tx, authorization, contentTree, folders,
  };
}

describe('TemplateInstantiationService', () => {
  it('creates the immutable Folder/Page definition with initial versions and exactly one revision', async () => {
    const h = makeHarness();

    const result = await h.service.instantiate('space-1', 'template-1', input(), principal);

    expect(result).toEqual({
      instantiationId: expect.any(String), rootFolderId: 'folder-1',
      pageIds: [expect.any(String), expect.any(String), expect.any(String)],
      runId: null, treeRevision: 5n,
    });
    expect(h.contentTree.createFolderLocked).toHaveBeenCalledTimes(2);
    expect(h.tx.page.create).toHaveBeenCalledTimes(3);
    expect(h.tx.pageVersion.create).toHaveBeenCalledTimes(3);
    expect(h.contentTree.advancePageMutation).toHaveBeenCalledTimes(1);
    expect(h.contentTree.advancePageMutation).toHaveBeenCalledWith(h.tx, expect.objectContaining({
      expectedTreeRevision: 4n, structural: true,
      changes: expect.arrayContaining([expect.objectContaining({ operation: 'upsert', pageId: expect.any(String) })]),
    }));
    expect(h.tx.templateInstantiationNode.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ templateNodeId: 'root', kind: 'folder', folderId: 'folder-1', pageId: null }),
        expect.objectContaining({ templateNodeId: 'intro', kind: 'page', folderId: null, pageId: expect.any(String) }),
      ]),
    });
    expect(h.tx.templateEffectJob.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ kind: 'page_index', effectKey: expect.stringMatching(/^page-index:/u), payload: { pageId: expect.any(String) } }),
        expect.objectContaining({ kind: 'space_graph', effectKey: 'space-graph:space-1', payload: { spaceId: 'space-1' } }),
      ]),
    });
  });

  it('preserves mixed Folder/Page sibling order instead of assigning independent defaults', async () => {
    const h = makeHarness();
    h.tx.folder.aggregate.mockResolvedValueOnce({ _max: { sortOrder: 8 } });
    h.tx.page.aggregate.mockResolvedValueOnce({ _max: { sortOrder: 6 } });

    await h.service.instantiate('space-1', 'template-1', input(), principal);

    expect(h.contentTree.createFolderLocked).toHaveBeenNthCalledWith(2, h.tx, expect.objectContaining({
      name: 'Plan', sortOrder: 1,
    }));
    expect(h.tx.page.create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({
      title: 'Intro', sortOrder: 0,
    }) });
  });

  it('applies rootName only to the root Folder through the shared deterministic expansion', async () => {
    const h = makeHarness();

    await h.service.instantiate('space-1', 'template-1', input({ rootName: 'My Project' }), principal);

    expect(h.contentTree.createFolderLocked).toHaveBeenNthCalledWith(1, h.tx, expect.objectContaining({
      name: 'My Project',
    }));
    expect(h.contentTree.createFolderLocked).toHaveBeenNthCalledWith(2, h.tx, expect.objectContaining({
      name: 'Plan',
    }));
  });

  it('uses one truthful system fallback locale for every expanded node and Page provenance', async () => {
    const h = makeHarness();

    await h.service.instantiate('space-1', 'template-1', input({ locale: 'zh-CN' }), principal);

    expect(h.tx.page.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      title: 'Intro', sourceTemplateLocale: 'en',
    }) });
  });

  it('rejects target-parent depth plus the full template depth before creating any node', async () => {
    const h = makeHarness();
    h.tx.$queryRaw.mockResolvedValue([{ depth: 30 }]);

    await expect(h.service.instantiate(
      'space-1', 'template-1', input({ targetParentFolderId: 'deep-parent' }), principal,
    )).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_DEPTH_LIMIT' }));
    expect(h.contentTree.createFolderLocked).not.toHaveBeenCalled();
    expect(h.tx.page.create).not.toHaveBeenCalled();
  });

  it('returns an authorized matching replay before checking a stale preview revision', async () => {
    const h = makeHarness();
    const first = await h.service.instantiate('space-1', 'template-1', input(), principal);
    h.tx.templateInstantiation.findUnique.mockResolvedValue({
      requestHash: h.tx.templateInstantiation.create.mock.calls[0][0].data.requestHash,
      result: { ...first, treeRevision: first.treeRevision.toString() },
    });
    h.contentTree.lockPageMutationSpace.mockImplementation(async (_tx: any, _spaceId: string, expected: bigint | undefined) => {
      if (expected !== undefined) throw new Error('stale preview should not be checked on replay');
      return h.tx;
    });

    await expect(h.service.instantiate('space-1', 'template-1', input(), principal)).resolves.toEqual(first);
    expect(h.authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(2);
    expect(h.tx.page.create).toHaveBeenCalledTimes(3);
  });

  it('rejects idempotency-key reuse with a different canonical payload', async () => {
    const h = makeHarness();
    h.tx.templateInstantiation.findUnique.mockResolvedValue({
      requestHash: 'different', result: {},
    });

    await expect(h.service.instantiate('space-1', 'template-1', input(), principal))
      .rejects.toEqual(expect.objectContaining({ businessCode: 'PAGE_TEMPLATE_INSTANTIATION_IDEMPOTENCY_CONFLICT' }));
    expect(h.tx.page.create).not.toHaveBeenCalled();
  });

  it.each([
    ['collaboration', { collaborationEnabled: true }],
    ['role bindings', { roleBindings: [] }],
    ['enabled tasks', { enabledTaskNodeIds: [] }],
    ['non-empty free-form variables', { variables: { project: 'unsupported DSL' } }],
  ])('rejects unsupported %s atomically instead of dropping it', async (_label, unsupported) => {
    const h = makeHarness();

    await expect(h.service.instantiate('space-1', 'template-1', input(unsupported), principal))
      .rejects.toEqual(expect.objectContaining({ businessCode: 'PAGE_TEMPLATE_INSTANTIATION_UNSUPPORTED' }));
    expect(h.contentTree.lockPageMutationSpace).not.toHaveBeenCalled();
    expect(h.tx.page.create).not.toHaveBeenCalled();
  });

  it('retries the complete Serializable transaction only for a real Prisma P2034', async () => {
    const h = makeHarness();
    const conflict = new Prisma.PrismaClientKnownRequestError('serialization conflict', {
      code: 'P2034', clientVersion: 'test',
    });
    h.prisma.$transaction.mockRejectedValueOnce(conflict);

    await expect(h.service.instantiate('space-1', 'template-1', input(), principal)).resolves.toEqual(
      expect.objectContaining({ treeRevision: 5n }),
    );
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
