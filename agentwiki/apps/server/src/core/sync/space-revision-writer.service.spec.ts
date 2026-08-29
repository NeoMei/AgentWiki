import { SpaceRevisionWriterService } from './space-revision-writer.service';
import { contentHash, pathKey } from '@neomei/agentwiki-sync-protocol';

describe('SpaceRevisionWriterService', () => {
  const prisma = {} as any;
  let service: SpaceRevisionWriterService;

  beforeEach(() => {
    service = new SpaceRevisionWriterService(prisma);
  });

  it('locks a space with a transaction-scoped advisory lock', async () => {
    const tx = { $executeRaw: jest.fn() };
    const locked = await service.lockSpace(tx as any, 'space-1');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(locked).toBe(tx);
  });

  it('reads the active Space revision only through the ContentTree advisory-lock entrypoint', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      space: { findUnique: jest.fn().mockResolvedValue({ contentTreeRevision: 7n }) },
    };
    const locked = await service.lockContentTreeSpace(tx as any, 'space-1');
    expect(locked?.contentTreeRevision).toBe(7n);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('locks the active Space row FOR NO KEY UPDATE after the advisory lock for Sync cutover', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ contentTreeRevision: 7n }]),
    };
    const locked = await service.lockSyncSpace(tx as any, 'space-1');
    expect(locked?.contentTreeRevision).toBe(7n);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0])
      .toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
  });

  it('returns null for a missing/deleted ContentTree Space without changing shared lockSpace errors', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      space: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    await expect(service.lockContentTreeSpace(tx as any, 'missing')).resolves.toBeNull();
    await expect(service.lockSpace({ $executeRaw: jest.fn() } as any, 'missing')).resolves.toBeDefined();
  });

  it('advances the content tree revision with compare-and-swap', async () => {
    const tx = {
      space: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
      },
    };
    await expect(service.advanceContentTreeRevision(tx as any, 'space-1', 4n)).resolves.toBe(5n);
    expect(tx.space.updateMany).toHaveBeenCalledWith({
      where: { id: 'space-1', deletedAt: null, contentTreeRevision: 4n },
      data: { contentTreeRevision: { increment: 1n } },
    });
  });

  it('reports a stale compare-and-swap as a content-tree conflict', async () => {
    const tx = {
      space: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ contentTreeRevision: 9n }),
      },
    };
    await expect(service.advanceContentTreeRevision(tx as any, 'space-1', 8n)).rejects.toEqual(
      expect.objectContaining({ code: 'CONTENT_TREE_CONFLICT' }),
    );
  });

  it('advances a locked revision without reacquiring the Space advisory lock', async () => {
    const createdRevision: any = {
      id: 'rev-1', sequence: 1, revisionContentHash: 'x', pageCount: 1n,
      revisionBodyBytes: 6n, revisionManifestByteLength: 100n,
    };
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ bytes: 6n }]),
      space: {
        findUnique: jest.fn().mockResolvedValue({ contentTreeRevision: 0n }),
      },
      spaceKnowledgeRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'rev-1', spaceId: 'space-1', sequence: 1, parentRevisionId: null,
          schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', migrationBatchId: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(createdRevision),
        update: jest.fn().mockResolvedValue({}),
      },
      spaceRevisionChainCheckpoint: { findUnique: jest.fn().mockResolvedValue(null) },
      syncRevisionPageRow: {
        findMany: jest.fn().mockResolvedValue([{
          pageId: '11111111-1111-4111-8111-111111111111',
          folderId: null,
          path: 'Guide.md',
          title: 'Guide',
          contentHash: '66a045b452102c59d840ec097d59d9467e13a3f34f6494e539ffd32c1bb35f18',
        }]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      syncRevisionDeltaRow: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      syncRevisionFolderRow: { findMany: jest.fn().mockResolvedValue([]) },
      syncRevisionTreeDeltaRow: { findMany: jest.fn().mockResolvedValue([]) },
      legacyRevisionSidecar: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      syncPageContentRow: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      legacyPageBodyRow: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      legacyRevisionPageExtra: {
        aggregate: jest.fn().mockResolvedValue({ _max: { ordinal: null } }),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      page: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      folder: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      agentMemory: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      knowledgeRelation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const body = 'Hello\n';
    const result = await service.advanceLocked(tx as any, 'space-1', [{
      operation: 'upsert',
      pageId: '11111111-1111-4111-8111-111111111111',
      path: 'Guide.md',
      title: 'Guide',
      body,
    }], { origin: 'obsidian_sync' });

    expect(result.sequence).toBe(1);
    expect(result.pageCount).toBe(1n);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.syncRevisionPageRow.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { revisionId_pageId: { revisionId: 'rev-1', pageId: '11111111-1111-4111-8111-111111111111' } },
      create: expect.objectContaining({
        revisionId: 'rev-1',
        pageId: '11111111-1111-4111-8111-111111111111',
        path: 'Guide.md',
        pathKey: pathKey('Guide.md'),
        contentHash: await contentHash(body),
      }),
    }));
  });

  it('advances 10,000 structural Page changes with a bounded database query budget', async () => {
    const body = '# Body\n';
    const hash = await contentHash(body);
    const changes = Array.from({ length: 10_000 }, (_, index) => {
      const pageId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      return {
        operation: 'upsert' as const,
        pageId,
        folderId: 'folder-1',
        path: `pages/Bulk/Page-${index}.md`,
        title: `Page ${index}`,
        body,
      };
    });
    const settled = changes.map((change) => ({
      pageId: change.pageId,
      folderId: null,
      path: change.path,
      title: change.title,
      contentHash: hash,
    }));
    const extras = changes.map((change, ordinal) => ({
      revisionId: 'rev-bulk',
      pageId: change.pageId,
      ordinal,
      legacyBodyHash: hash,
      extra: {
        spaceId: 'space-1', title: change.title, path: change.path, order: ordinal,
        metadata: null, artifactIds: [], legacyBodyHash: hash,
        contentHash: hash, updatedAt: '2026-08-28T00:00:00.000Z',
      },
    }));
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(10_000),
      $queryRaw: jest.fn().mockResolvedValue([{ bytes: BigInt(Buffer.byteLength(body) * changes.length) }]),
      spaceKnowledgeRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'rev-bulk', spaceId: 'space-1', sequence: 1, parentRevisionId: null,
          schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', migrationBatchId: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'rev-bulk', sequence: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      spaceRevisionChainCheckpoint: { findUnique: jest.fn().mockResolvedValue(null) },
      syncRevisionPageRow: { findMany: jest.fn().mockResolvedValue(settled) },
      syncRevisionDeltaRow: { createMany: jest.fn().mockResolvedValue({ count: changes.length }) },
      syncRevisionFolderRow: { findMany: jest.fn().mockResolvedValue([]) },
      syncRevisionTreeDeltaRow: { findMany: jest.fn().mockResolvedValue([]) },
      legacyRevisionSidecar: { findUnique: jest.fn().mockResolvedValue(null) },
      legacyRevisionPageExtra: { findMany: jest.fn().mockResolvedValue(extras) },
      legacyPageBodyRow: { findMany: jest.fn().mockResolvedValue([{ contentHash: hash, body }]) },
      folder: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const result = await (service as any).advanceStructuralPages(
      tx,
      'space-1',
      changes,
      { origin: 'web_editor', createdByUserId: 'user-1' },
    );

    const queryFunctions = [
      tx.$executeRaw, tx.$queryRaw,
      ...Object.values(tx).flatMap((delegate: any) => (
        delegate && typeof delegate === 'object'
          ? Object.values(delegate).filter((value: any) => jest.isMockFunction(value))
          : []
      )),
    ] as jest.Mock[];
    const queryCount = queryFunctions.reduce((count, query) => count + query.mock.calls.length, 0);
    expect(result.pageCount).toBe(10_000n);
    // Full-chain and persisted-marker integrity add a fixed query budget, not a
    // per-Page query. The 10k boundary must remain constant-sized.
    expect(queryCount).toBeLessThanOrEqual(24);
  }, 20_000);

  function emptyStructuralTransaction() {
    return {
      $queryRaw: jest.fn().mockResolvedValue([{ bytes: 0n }]),
      spaceKnowledgeRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'revision-1', sequence: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      syncRevisionPageRow: { findMany: jest.fn().mockResolvedValue([]) },
      legacyRevisionSidecar: { findUnique: jest.fn().mockResolvedValue(null) },
      legacyRevisionPageExtra: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
  }

  function v2FinalizerTransaction(current: any, parent: any = null) {
    const revisions = new Map<string, any>([[current.id, current]]);
    if (parent) revisions.set(parent.id, parent);
    return {
      folder: { findMany: jest.fn().mockResolvedValue([]) },
      spaceRevisionChainCheckpoint: { findUnique: jest.fn().mockResolvedValue(null) },
      spaceKnowledgeRevision: {
        findUnique: jest.fn(async ({ where }: any) => revisions.get(where.id) ?? null),
        findMany: jest.fn(async ({ where }: any) => [...revisions.values()]
          .filter((revision) => revision.spaceId === where.spaceId && revision.sequence < where.sequence.lt)
          .sort((left, right) => right.sequence - left.sequence)),
      },
      syncRevisionFolderRow: { findMany: jest.fn().mockResolvedValue([]) },
      syncRevisionPageRow: { findMany: jest.fn().mockResolvedValue([]) },
      legacyRevisionSidecar: { findUnique: jest.fn().mockResolvedValue(null) },
      syncRevisionTreeDeltaRow: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
  }

  const fallback = {
    revisionId: 'rev-2', sequence: 2, revisionContentHash: '0'.repeat(64),
    pageCount: 0n, revisionManifestByteLength: 0n, revisionBodyBytes: 0n,
  };

  it.each([
    ['missing parent', null],
    ['self parent', {
      id: 'rev-2', spaceId: 'space-1', sequence: 2, parentRevisionId: 'rev-2',
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', migrationBatchId: null,
    }],
    ['cross-Space parent', {
      id: 'rev-1', spaceId: 'space-2', sequence: 1, parentRevisionId: null,
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', migrationBatchId: null,
    }],
    ['wrong predecessor sequence', {
      id: 'rev-1', spaceId: 'space-1', sequence: 0, parentRevisionId: null,
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', migrationBatchId: null,
    }],
  ])('fails the writer finalizer closed for a %s', async (_label, parent) => {
    const current = {
      id: 'rev-2', spaceId: 'space-1', sequence: 2, parentRevisionId: 'rev-1',
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', migrationBatchId: null,
    };
    if (parent?.id === 'rev-2') current.parentRevisionId = 'rev-2';
    const tx = v2FinalizerTransaction(current, parent);

    await expect((service as any).finalizeTreeV2IfRequired(
      tx, 'space-1', 'rev-2', current.parentRevisionId, fallback,
    )).rejects.toMatchObject({ code: 'CONTENT_TREE_REVISION_GONE' });
  });

  it('rejects an incomplete parent identified only by a non-schema v2 marker', async () => {
    const current = {
      id: 'rev-2', spaceId: 'space-1', sequence: 2, parentRevisionId: 'rev-1',
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', migrationBatchId: null,
    };
    const parent = {
      id: 'rev-1', spaceId: 'space-1', sequence: 1, parentRevisionId: null,
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'space-folders-v1', migrationBatchId: null,
    };
    const tx = v2FinalizerTransaction(current, parent);

    await expect((service as any).finalizeTreeV2IfRequired(
      tx, 'space-1', 'rev-2', 'rev-1', fallback,
    )).rejects.toMatchObject({ code: 'CONTENT_TREE_REVISION_GONE' });
  });

  it.each([
    ['initial revision', {
      current: {
        id: 'rev-1', spaceId: 'space-1', sequence: 1, parentRevisionId: null,
        schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', migrationBatchId: null,
      }, parent: null, fallback: { ...fallback, revisionId: 'rev-1', sequence: 1 },
    }],
    ['exact marker-free legacy predecessor', {
      current: {
        id: 'rev-2', spaceId: 'space-1', sequence: 2, parentRevisionId: 'rev-1',
        schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', migrationBatchId: null,
      },
      parent: {
        id: 'rev-1', spaceId: 'space-1', sequence: 1, parentRevisionId: null,
        schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', migrationBatchId: null,
      },
      fallback,
    }],
  ])('keeps the legal Folder-free %s chain compatible', async (_label, value) => {
    const tx = v2FinalizerTransaction(value.current, value.parent);

    await expect((service as any).finalizeTreeV2IfRequired(
      tx, 'space-1', value.current.id, value.current.parentRevisionId, value.fallback,
    )).resolves.toBe(value.fallback);
    const chainQuery = tx.spaceKnowledgeRevision.findMany.mock.calls[0][0];
    expect(chainQuery.select).toEqual(expect.objectContaining({
      id: true, spaceId: true, sequence: true, parentRevisionId: true,
    }));
    expect(chainQuery.select).not.toHaveProperty('snapshot');
    expect(chainQuery.select).not.toHaveProperty('delta');
  });

  it('keeps automatic v2 finalization enabled even if external origin metadata names the migration defer flag', async () => {
    const finalize = jest.spyOn(service as any, 'finalizeTreeV2IfRequired')
      .mockImplementation(async (_tx, _spaceId, revisionId, _parentRevisionId, fallback) => ({
        ...(fallback as any), revisionId,
      }));

    await service.advanceStructuralPagesLocked(
      emptyStructuralTransaction(),
      'space-1',
      [],
      { origin: 'obsidian_sync', deferTreeV2Finalization: true } as any,
    );

    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('lets only the dedicated migration writer defer initial v2 persistence to the Task 6 finalizer', async () => {
    const finalize = jest.spyOn(service as any, 'finalizeTreeV2IfRequired');

    await service.advanceMigrationStructuralPagesLocked(
      emptyStructuralTransaction(),
      'space-1',
      [],
      { origin: 'migration', migrationBatchId: 'space-folders-v1:space-1' },
    );

    expect(finalize).not.toHaveBeenCalled();
  });
});
