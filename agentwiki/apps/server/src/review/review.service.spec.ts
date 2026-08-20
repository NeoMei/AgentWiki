import { BadRequestException } from '@nestjs/common';
import { pathKey } from '@neomei/agentwiki-sync-protocol';
import { ReviewService } from './review.service';

describe('ReviewService queue presentation', () => {
  const prisma = { changeSet: { count: jest.fn(), findMany: jest.fn() } } as any;
  const service = new ReviewService(prisma, {} as any, {} as any, {} as any, { enqueue: jest.fn() } as any);

  beforeEach(() => jest.clearAllMocks());

  it('counts only pending review sets in accessible spaces', async () => {
    prisma.changeSet.count.mockResolvedValue(2);
    await expect(service.countPending(['space-1', 'space-2'])).resolves.toEqual({ pending: 2 });
    expect(prisma.changeSet.count).toHaveBeenCalledWith({
      where: { spaceId: { in: ['space-1', 'space-2'] }, status: 'pending_review' },
    });
  });

  it('orders pending and approved work before historical states, newest first within status', async () => {
    prisma.changeSet.findMany.mockResolvedValue([
      { id: 'published', status: 'published', createdAt: new Date('2026-08-19T10:00:00Z') },
      { id: 'pending-old', status: 'pending_review', createdAt: new Date('2026-08-19T09:00:00Z') },
      { id: 'pending-new', status: 'pending_review', createdAt: new Date('2026-08-19T11:00:00Z') },
    ]);
    await expect(service.list(['space-1'])).resolves.toMatchObject([
      { id: 'pending-new' }, { id: 'pending-old' }, { id: 'published' },
    ]);
  });
});

describe('ReviewService approval boundaries', () => {
  const prisma = {
    changeItem: { count: jest.fn(), updateMany: jest.fn() },
    changeSet: { updateMany: jest.fn(), findUnique: jest.fn() },
    approval: { create: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const search = { indexPage: jest.fn().mockResolvedValue({ lexicalIndexed: true, semanticIndexed: false }) } as any;
  const graphMaintenance = { enqueue: jest.fn() } as any;
  const syncPaths = { allocate: jest.fn() } as any;
  const revisionWriter = { advance: jest.fn(), lockSpace: jest.fn() } as any;
  const service = new ReviewService(
    prisma,
    search,
    revisionWriter,
    syncPaths,
    graphMaintenance,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    syncPaths.allocate.mockResolvedValue({
      path: 'pages/Generated.md',
      pathKey: pathKey('pages/Generated.md'),
    });
    revisionWriter.lockSpace.mockImplementation(async (tx: unknown) => tx);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    prisma.changeSet.updateMany.mockResolvedValue({ count: 1 });
  });

  it('refuses approval while any item is still pending', async () => {
    prisma.changeItem.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    await expect(service.approve('cs-1', 'user-1')).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.changeSet.updateMany).not.toHaveBeenCalled();
  });

  it('refuses approval when every item was rejected', async () => {
    prisma.changeItem.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    await expect(service.approve('cs-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns CHANGESET_INVALID_STATE with 409 for a stale publish request', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-stale-publish', status: 'published', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [], approvals: [], space: {}, run: null,
    });

    await expect(service.publish('cs-stale-publish')).rejects.toMatchObject({
      businessCode: 'CHANGESET_INVALID_STATE',
      statusCode: 409,
    });
  });

  it.each(['draft', 'pending_review'])('keeps APPROVAL_REQUIRED with 403 for an unapproved %s publish request', async (status) => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: `cs-${status}`, status, spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [], approvals: [], space: {}, run: null,
    });

    await expect(service.publish(`cs-${status}`)).rejects.toMatchObject({
      businessCode: 'APPROVAL_REQUIRED',
      statusCode: 403,
    });
  });

  it('returns CHANGESET_INVALID_STATE with 409 for a stale revert request', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-stale-revert', status: 'reverted', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [], approvals: [], space: {}, run: null,
    });

    await expect(service.revert('cs-stale-revert')).rejects.toMatchObject({
      businessCode: 'CHANGESET_INVALID_STATE',
      statusCode: 409,
    });
  });

  it('publishes only explicitly accepted items', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [
        { id: 'accepted', type: 'create_page', status: 'accepted', payload: { title: 'A', content: 'ok' } },
        { id: 'pending', type: 'create_page', status: 'pending', payload: { title: 'B', content: 'no' } },
        { id: 'rejected', type: 'create_page', status: 'rejected', payload: { title: 'C', content: 'no' } },
      ], approvals: [], space: {}, run: null,
    });
    const tx = {
      page: { create: jest.fn().mockResolvedValue({ id: 'page-1' }), findUnique: jest.fn().mockResolvedValue({ title: 'A', content: 'ok', deletedAt: null }), findMany: jest.fn().mockResolvedValue([]) },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await service.publish('cs-1');
    expect(tx.page.create).toHaveBeenCalledTimes(1);
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'accepted' } }));
  });

  it('restores an archived page with the same source identity instead of creating a duplicate', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-restore', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'restore', type: 'create_page', status: 'accepted',
        payload: { sourceId: 'source-1', sourcePath: 'docs/a.md', sourceVersionId: 'version-2', title: 'Restored', content: 'new' },
      }],
      approvals: [], space: {}, run: null,
    });
    const archivedAt = new Date('2026-08-18T08:00:00Z');
    const archived = {
      id: 'page-existing', spaceId: 'space-1', knowledgeKey: 'knowledge-existing', authorId: 'user-old',
      title: 'Archived', slug: 'archived', content: 'old', format: 'markdown', parentId: null,
      sourceChangeSetId: 'cs-old', createdByAgentId: null, lastChangeSetId: 'cs-old',
      lastModifiedByUserId: 'user-old', lastModifiedByAgentId: null, lastModifiedAt: archivedAt,
      sourceId: 'source-1', sourceVersionId: 'version-1', sourcePath: 'docs/a.md',
      syncPath: 'docs/a.md', syncPathKey: 'docs/a.md', deletedAt: archivedAt, updatedAt: archivedAt,
    };
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(archived),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ title: 'Restored', content: 'new', deletedAt: null }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-restore');

    expect(tx.page.create).not.toHaveBeenCalled();
    expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pageId: archived.id, title: 'Archived', content: 'old' }),
    }));
    expect(tx.page.updateMany).toHaveBeenCalledWith({
      where: { id: archived.id, spaceId: 'space-1', deletedAt: archivedAt, updatedAt: archivedAt },
      data: expect.objectContaining({
        title: 'Restored', content: 'new', deletedAt: null,
        sourceId: 'source-1', sourceVersionId: 'version-2', sourcePath: 'docs/a.md',
        sourceChangeSetId: 'cs-restore', lastChangeSetId: 'cs-restore',
      }),
    });
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'restore' },
      data: expect.objectContaining({ payload: expect.objectContaining({
        before: expect.objectContaining({
          restoredFromArchive: true, title: 'Archived', content: 'old',
          sourceChangeSetId: 'cs-old', lastModifiedAt: archivedAt.toISOString(),
        }),
      }) }),
    }));
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'restore' },
      data: { status: 'published', publishedResourceId: archived.id },
    }));
  });

  it('allocates a readable path when restoring an archived source page with a non-portable source path', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-readable-restore', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'restore-readable', type: 'create_page', status: 'accepted',
        payload: {
          sourceId: 'source-1', sourcePath: '/legacy-source.md', sourceVersionId: 'version-2',
          title: 'Readable restored', content: 'new',
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const archivedAt = new Date('2026-08-18T08:00:00Z');
    const archived = {
      id: 'page-existing', spaceId: 'space-1', knowledgeKey: 'knowledge-existing', authorId: 'user-old',
      title: 'Archived', slug: 'archived', content: 'old', format: 'markdown', parentId: null,
      sourceChangeSetId: 'cs-old', createdByAgentId: null, lastChangeSetId: 'cs-old',
      lastModifiedByUserId: 'user-old', lastModifiedByAgentId: null, lastModifiedAt: archivedAt,
      sourceId: 'source-1', sourceVersionId: 'version-1', sourcePath: '/legacy-source.md',
      syncPath: 'guides/Archived.md', syncPathKey: pathKey('guides/Archived.md'),
      deletedAt: archivedAt, updatedAt: archivedAt,
    };
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(archived),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ title: 'Readable restored', content: 'new', deletedAt: null }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    syncPaths.allocate.mockResolvedValueOnce({
      path: 'guides/Readable restored.md',
      pathKey: pathKey('guides/Readable restored.md'),
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-readable-restore');

    expect(tx.page.create).not.toHaveBeenCalled();
    expect(syncPaths.allocate).toHaveBeenCalledWith(tx, {
      spaceId: 'space-1',
      directory: 'guides',
      title: 'Readable restored',
      excludePageId: archived.id,
    });
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        syncPath: 'guides/Readable restored.md',
        syncPathKey: pathKey('guides/Readable restored.md'),
      }),
    }));
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'restore-readable' },
      data: expect.objectContaining({ payload: expect.objectContaining({
        before: expect.objectContaining({
          restoredFromArchive: true,
          syncPath: 'guides/Archived.md',
          syncPathKey: pathKey('guides/Archived.md'),
        }),
      }) }),
    }));
  });

  it('loses a concurrent archive-restoration race instead of overwriting the winner', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-restore-race', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'restore-race', type: 'create_page', status: 'accepted',
        payload: { sourceId: 'source-1', sourcePath: 'docs/a.md', sourceVersionId: 'version-2', title: 'Racing restore', content: 'new' },
      }],
      approvals: [], space: {}, run: null,
    });
    const archivedAt = new Date('2026-08-18T08:00:00Z');
    const archived = {
      id: 'page-existing', knowledgeKey: 'knowledge-existing', authorId: 'user-old',
      title: 'Archived', slug: 'archived', content: 'old', format: 'markdown', parentId: null,
      sourceChangeSetId: 'cs-old', createdByAgentId: null, lastChangeSetId: 'cs-old',
      lastModifiedByUserId: 'user-old', lastModifiedByAgentId: null, lastModifiedAt: archivedAt,
      sourceId: 'source-1', sourceVersionId: 'version-1', sourcePath: 'docs/a.md',
      syncPath: 'docs/a.md', syncPathKey: 'docs/a.md', deletedAt: archivedAt, updatedAt: archivedAt,
    };
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(archived),
        update: jest.fn().mockResolvedValue({ id: archived.id }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pageVersion: { create: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-restore-race')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
  });

  it('returns a stable conflict when the source identity already belongs to an active page', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-duplicate', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'duplicate', type: 'create_page', status: 'accepted',
        payload: { sourceId: 'source-1', sourcePath: 'docs/a.md', title: 'Duplicate', content: 'new' },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: { findFirst: jest.fn().mockResolvedValue({ id: 'page-active', deletedAt: null }), create: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-duplicate')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(tx.page.create).not.toHaveBeenCalled();
  });

  it('translates a create race unique violation into a stable change-set conflict', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-race', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'race', type: 'create_page', status: 'accepted',
        payload: { sourceId: 'source-1', sourcePath: 'docs/a.md', title: 'Racing', content: 'new' },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
      },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-race')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
  });

  it('preserves zero strength and confidence when publishing a relation', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-relation', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'relation', type: 'create_relation', status: 'accepted',
        payload: { sourcePageId: 'page-1', targetPageId: 'page-2', relation: 'supports', strength: 0, confidence: 0 },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      page: { findMany: jest.fn().mockResolvedValue([{ id: 'page-1', spaceId: 'space-1' }, { id: 'page-2', spaceId: 'space-1' }]) },
      knowledgeRelation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'relation-1' }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-relation');

    expect(tx.knowledgeRelation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ strength: 0, confidence: 0 }),
    }));
    expect(graphMaintenance.enqueue).toHaveBeenCalledWith('space-1');
  });

  it('preserves auto_llm origin when an approved graph proposal is published', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-auto-graph', status: 'approved', spaceId: 'space-1', createdByUserId: 'owner-1', createdByAgentId: null,
      items: [{
        id: 'relation', type: 'create_relation', status: 'accepted',
        payload: {
          sourcePageId: 'page-1', targetPageId: 'page-2', relation: 'extends', origin: 'auto_llm',
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      page: { findMany: jest.fn().mockResolvedValue([{ id: 'page-1', spaceId: 'space-1' }, { id: 'page-2', spaceId: 'space-1' }]) },
      knowledgeRelation: { createMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-auto-graph');

    expect(tx.knowledgeRelation.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ origin: 'auto_llm' }),
      skipDuplicates: true,
    }));
  });

  it('skips an auto_llm relation when a human-owned triple already exists', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-auto-conflict', status: 'approved', spaceId: 'space-1', createdByUserId: 'owner-1', createdByAgentId: null,
      items: [{
        id: 'relation', type: 'create_relation', status: 'accepted',
        payload: {
          sourcePageId: 'page-1', targetPageId: 'page-2', relation: 'extends', origin: 'auto_llm',
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      page: { findMany: jest.fn().mockResolvedValue([{ id: 'page-1', spaceId: 'space-1' }, { id: 'page-2', spaceId: 'space-1' }]) },
      knowledgeRelation: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-auto-conflict')).resolves.toMatchObject({ id: 'cs-auto-conflict' });

    expect(tx.knowledgeRelation.create).not.toHaveBeenCalled();
    expect(tx.changeItem.update).toHaveBeenCalledWith({
      where: { id: 'relation' },
      data: { status: 'rejected' },
    });
  });

  it('atomically skips an auto_llm relation created by a concurrent writer', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-auto-race', status: 'approved', spaceId: 'space-1', createdByUserId: 'owner-1', createdByAgentId: null,
      items: [{
        id: 'relation', type: 'create_relation', status: 'accepted',
        payload: {
          sourcePageId: 'page-1', targetPageId: 'page-2', relation: 'extends', origin: 'auto_llm',
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      page: { findMany: jest.fn().mockResolvedValue([{ id: 'page-1', spaceId: 'space-1' }, { id: 'page-2', spaceId: 'space-1' }]) },
      knowledgeRelation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-auto-race')).resolves.toMatchObject({ id: 'cs-auto-race' });

    expect(tx.knowledgeRelation.create).not.toHaveBeenCalled();
    expect(tx.changeItem.update).toHaveBeenCalledWith({
      where: { id: 'relation' },
      data: { status: 'rejected' },
    });
  });

  it('lets a compiled relation take ownership of an automatic triple', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-compiled-takeover', status: 'approved', spaceId: 'space-1', createdByUserId: 'owner-1', createdByAgentId: null,
      items: [{
        id: 'relation', type: 'create_relation', status: 'accepted',
        payload: { sourcePageId: 'page-1', targetPageId: 'page-2', relation: 'extends' },
      }],
      approvals: [], space: {}, run: null,
    });
    const automatic = { id: 'auto-1', origin: 'auto_llm' };
    const tx = {
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      page: { findMany: jest.fn().mockResolvedValue([{ id: 'page-1', spaceId: 'space-1' }, { id: 'page-2', spaceId: 'space-1' }]) },
      knowledgeRelation: {
        findUnique: jest.fn().mockResolvedValue(automatic),
        update: jest.fn().mockResolvedValue({ ...automatic, origin: 'compiled' }),
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-compiled-takeover')).resolves.toMatchObject({ id: 'cs-compiled-takeover' });

    expect(tx.knowledgeRelation.update).toHaveBeenCalledWith({
      where: { id: 'auto-1' },
      data: expect.objectContaining({ origin: 'compiled', sourceChangeSetId: 'cs-compiled-takeover' }),
    });
    expect(tx.knowledgeRelation.create).not.toHaveBeenCalled();
  });

  it('loses a concurrent approval race without creating a duplicate approval', async () => {
    prisma.changeItem.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prisma.changeSet.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approve('cs-1', 'user-1')).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.approval.create).not.toHaveBeenCalled();
  });

  it('rejects a parent change that would create a multi-level page cycle', async () => {
    const tx = {
      page: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ spaceId: 'space-1', parentId: 'page-1' }),
      },
    } as any;
    await expect((service as any).assertValidParent(tx, 'space-1', 'page-2', 'page-1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['create_page', {}],
    ['update_page', { before: { title: 'Before' } }],
    ['archive_page', { before: { deletedAt: null } }],
  ])('rejects reverting a %s item when its page was changed later', async (type, payload) => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-old', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'item-1', type, status: 'published', publishedResourceId: 'page-1', payload }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-old')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(tx.page.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'page-1',
        spaceId: 'space-1',
        lastChangeSetId: 'cs-old',
        updatedAt: { lte: publishedAt },
      }),
    }));
    expect(tx.page.updateMany).not.toHaveBeenCalled();
    expect(tx.pageVersion.create).not.toHaveBeenCalled();
    expect(tx.changeItem.update).not.toHaveBeenCalled();
  });

  it('reverts an unchanged created page owned by the published change set', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [
        { id: 'published', type: 'create_page', status: 'published', publishedResourceId: 'page-1', payload: {} },
        { id: 'rejected', type: 'create_page', status: 'rejected', publishedResourceId: null, payload: {} },
      ], approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'page-1', title: 'A', content: '', authorId: 'user-1', slug: 'a', format: 'markdown',
          parentId: null, syncPath: 'pages/A.md', syncPathKey: 'pages/a.md',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ deletedAt: new Date(), title: 'A', content: '' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await service.revert('cs-1');
    expect(tx.page.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'page-1',
        spaceId: 'space-1',
        sourceChangeSetId: 'cs-1',
        lastChangeSetId: 'cs-1',
        deletedAt: null,
        updatedAt: { lte: publishedAt },
      },
    }));
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
    expect(graphMaintenance.enqueue).toHaveBeenCalledWith('space-1');
  });

  it('reverts a restored page to its complete prior archived state', async () => {
    const publishedAt = new Date('2026-08-19T12:00:00Z');
    const archivedAt = new Date('2026-08-18T08:00:00Z');
    const priorModifiedAt = new Date('2026-08-18T07:00:00Z');
    const before = {
      restoredFromArchive: true,
      title: 'Archived title', content: 'Archived body', format: 'markdown', parentId: 'parent-old',
      deletedAt: archivedAt.toISOString(), sourceChangeSetId: 'cs-old', createdByAgentId: 'agent-old',
      lastChangeSetId: 'cs-old', lastModifiedByUserId: null, lastModifiedByAgentId: 'agent-old',
      lastModifiedAt: priorModifiedAt.toISOString(), sourceId: 'source-1', sourceVersionId: 'version-1',
      sourcePath: 'docs/a.md', syncPath: 'pages/Archived title.md',
      syncPathKey: pathKey('pages/Archived title.md'),
    };
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-restore', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'restore', type: 'create_page', status: 'published', publishedResourceId: 'page-1', payload: { before } }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'page-1', title: 'Restored title', content: 'Restored body', authorId: 'user-1',
          slug: 'restored-title', format: 'markdown', parentId: null,
          syncPath: 'pages/Restored title.md', syncPathKey: pathKey('pages/Restored title.md'),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ deletedAt: archivedAt, title: 'Archived title', content: 'Archived body' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.revert('cs-restore');

    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'page-1', sourceChangeSetId: 'cs-restore', lastChangeSetId: 'cs-restore' }),
      data: expect.objectContaining({
        title: 'Archived title', content: 'Archived body', parentId: 'parent-old', deletedAt: archivedAt,
        sourceChangeSetId: 'cs-old', lastChangeSetId: 'cs-old', lastModifiedAt: priorModifiedAt,
        syncPath: 'pages/Archived title.md', syncPathKey: pathKey('pages/Archived title.md'),
      }),
    }));
    expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ syncPath: 'pages/Restored title.md' }),
    }));
  });

  it.each([
    ['update_page', { before: { title: 'Before' } }, null],
    ['archive_page', { before: { deletedAt: null } }, { not: null }],
  ])('reverts an unchanged %s item owned by the published change set', async (type, payload, deletedAt) => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'item-1', type, status: 'published', publishedResourceId: 'page-1', payload }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'page-1', title: 'Current', content: 'Current body', authorId: 'user-1', slug: 'current', format: 'markdown',
          parentId: null, syncPath: 'pages/Current.md', syncPathKey: 'pages/current.md',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-1')).resolves.toMatchObject({ id: 'cs-1' });
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'page-1',
        spaceId: 'space-1',
        lastChangeSetId: 'cs-1',
        deletedAt,
        updatedAt: { lte: publishedAt },
      },
    }));
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['create_relation', {}],
    ['archive_relation', {
      before: {
        id: 'relation-1', relation: 'supports', sourcePageId: 'page-1', targetPageId: 'page-2',
        strength: 1, confidence: 1, origin: 'compiled', sourceChangeSetId: 'cs-source',
        createdByAgentId: null, evidenceId: null, lastModifiedByUserId: null,
        lastModifiedAt: new Date('2026-07-26T08:00:00.000Z'),
      },
    }],
  ])('rejects reverting a %s item when its relation was changed later', async (type, payload) => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-old', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'item-1', type, status: 'published', publishedResourceId: 'relation-1', payload }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      knowledgeRelation: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'relation-1' }),
      },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-old')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    if (type === 'create_relation') {
      expect(tx.knowledgeRelation.deleteMany).toHaveBeenCalledWith({
        where: {
          id: 'relation-1',
          sourceChangeSetId: 'cs-old',
          lastModifiedAt: { lte: publishedAt },
        },
      });
    } else {
      expect(tx.knowledgeRelation.createMany).toHaveBeenCalledWith({
        data: { ...(payload as any).before, id: 'relation-1' },
        skipDuplicates: true,
      });
    }
    expect(tx.changeItem.update).not.toHaveBeenCalled();
  });

  it('reverts an unchanged created relation owned by the published change set', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'item-1', type: 'create_relation', status: 'published', publishedResourceId: 'relation-1', payload: {} }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      knowledgeRelation: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-1')).resolves.toMatchObject({ id: 'cs-1' });
    expect(tx.knowledgeRelation.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'relation-1',
        sourceChangeSetId: 'cs-1',
        lastModifiedAt: { lte: publishedAt },
      },
    });
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
  });

  it('publishes a relation update with prior state and change-set ownership for rollback', async () => {
    const beforeModifiedAt = new Date('2026-07-26T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-update-relation', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'item-1', type: 'update_relation', status: 'accepted',
        payload: {
          relationId: 'relation-1', sourceKnowledgeKey: 'page-key-1',
          targetKnowledgeKey: 'page-key-2', relation: 'contradicts',
          expectedLastModifiedAt: beforeModifiedAt.toISOString(),
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const existing = {
      id: 'relation-1', knowledgeKey: 'relation-key-1', relation: 'supports',
      sourcePageId: 'page-1', targetPageId: 'page-2', strength: 1, confidence: 1,
      origin: 'compiled', sourceChangeSetId: 'cs-before', createdByAgentId: 'agent-before',
      evidenceId: null, lastModifiedByUserId: null, lastModifiedAt: beforeModifiedAt,
      createdAt: new Date('2026-07-25T08:00:00.000Z'),
      sourcePage: { spaceId: 'space-1' }, targetPage: { spaceId: 'space-1' },
    };
    const tx = {
      page: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: 'page-1' })
          .mockResolvedValueOnce({ id: 'page-2' }),
      },
      knowledgeRelation: {
        findUnique: jest.fn().mockResolvedValue(existing),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-update-relation');

    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        payload: expect.objectContaining({
          before: expect.objectContaining({ relation: 'supports', sourceChangeSetId: 'cs-before' }),
        }),
      }),
    }));
    expect(tx.knowledgeRelation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'relation-1', lastModifiedAt: beforeModifiedAt },
      data: expect.objectContaining({
        relation: 'contradicts', sourceChangeSetId: 'cs-update-relation',
        createdByAgentId: 'agent-before', lastModifiedByUserId: 'user-1',
      }),
    }));
  });

  it('reverts an unchanged relation update to its prior state', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    const before = {
      id: 'relation-1', knowledgeKey: 'relation-key-1', relation: 'supports',
      sourcePageId: 'page-1', targetPageId: 'page-2', strength: 1, confidence: 1,
      origin: 'compiled', sourceChangeSetId: 'cs-before', createdByAgentId: 'agent-before',
      evidenceId: null, lastModifiedByUserId: null,
      lastModifiedAt: new Date('2026-07-26T08:00:00.000Z'),
    };
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-update-relation', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'item-1', type: 'update_relation', status: 'published',
        publishedResourceId: 'relation-1', payload: { before },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      knowledgeRelation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-update-relation')).resolves.toMatchObject({ id: 'cs-update-relation' });
    const { id: _id, ...restored } = before;
    expect(tx.knowledgeRelation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'relation-1', sourceChangeSetId: 'cs-update-relation',
        lastModifiedAt: { lte: publishedAt },
      },
      data: restored,
    });
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
  });

  it('reverts created, updated, and archived shared memories without overwriting later changes', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    const before = {
      type: 'preference', content: 'before', importance: 0.5, tags: [], entities: null,
      contentHash: 'before-hash', visibility: 'space', embedding: [], embeddingModel: null,
      status: 'active', sourceEvidenceId: null, sourceMemoryIds: [], expiresAt: null,
      lastAccessedAt: null, agentId: 'agent-1', spaceId: 'space-1', archivedAt: null,
      deletedAt: null,
    };
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-memory', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: null, createdByAgentId: 'agent-1',
      items: [
        {
          id: 'create', type: 'upsert_space_memory', status: 'published',
          publishedResourceId: 'memory-created', payload: { before: null },
        },
        {
          id: 'update', type: 'upsert_space_memory', status: 'published',
          publishedResourceId: 'memory-updated', payload: { before, publishedUpdatedAt: publishedAt.toISOString() },
        },
        {
          id: 'archive', type: 'archive_space_memory', status: 'published',
          publishedResourceId: 'memory-archived', payload: { before },
        },
      ],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      agentMemory: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-memory')).resolves.toMatchObject({ id: 'cs-memory' });
    expect(tx.agentMemory.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'memory-created', spaceId: 'space-1', updatedAt: { lte: publishedAt } },
      data: expect.objectContaining({ status: 'archived', deletedAt: expect.any(Date) }),
    });
    expect(tx.agentMemory.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'memory-updated', spaceId: 'space-1', updatedAt: { lte: publishedAt } },
      data: before,
    });
    expect(tx.agentMemory.updateMany).toHaveBeenNthCalledWith(3, {
      where: { id: 'memory-archived', spaceId: 'space-1', updatedAt: { lte: publishedAt } },
      data: before,
    });
    expect(tx.changeItem.update).toHaveBeenCalledTimes(3);
  });

  it('publishes an existing shared-memory update with optimistic locking and rollback state', async () => {
    const updatedAt = new Date('2026-07-26T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-memory-update', status: 'approved', spaceId: 'space-1',
      createdByUserId: null, createdByAgentId: 'agent-1',
      items: [{
        id: 'memory-item', type: 'upsert_space_memory', status: 'accepted',
        payload: {
          knowledgeKey: 'memory-1', key: 'preference', value: 'after',
          contentHash: 'after-hash', expectedUpdatedAt: updatedAt.toISOString(),
        },
      }],
      approvals: [], space: {}, run: null,
    });
    (prisma as any).agent = { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) };
    const existing = {
      id: 'memory-1', type: 'preference', content: 'before', importance: 0.5,
      tags: [], entities: null, contentHash: 'before-hash', visibility: 'space',
      embedding: [], embeddingModel: null, status: 'active', sourceEvidenceId: null,
      sourceMemoryIds: [], expiresAt: null, lastAccessedAt: null, agentId: 'agent-1',
      spaceId: 'space-1', createdAt: new Date('2026-07-25T08:00:00.000Z'),
      updatedAt, archivedAt: null, deletedAt: null,
    };
    const tx = {
      agentMemory: {
        findUnique: jest.fn().mockResolvedValue(existing),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-memory-update');

    expect(tx.agentMemory.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'memory-1', spaceId: 'space-1', updatedAt },
      data: expect.objectContaining({ content: 'after', contentHash: 'after-hash' }),
    }));
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'memory-item' },
      data: expect.objectContaining({
        payload: expect.objectContaining({
          before: expect.objectContaining({ content: 'before', contentHash: 'before-hash' }),
        }),
      }),
    }));
  });

  it('restores an unchanged relation archived by the published change set', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    const before = {
      id: 'relation-1', relation: 'supports', sourcePageId: 'page-1', targetPageId: 'page-2',
      strength: 1, confidence: 1, origin: 'compiled', sourceChangeSetId: 'cs-source',
      createdByAgentId: null, evidenceId: 'evidence-1', lastModifiedByUserId: null,
      lastModifiedAt: new Date('2026-07-26T08:00:00.000Z'),
    };
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'item-1', type: 'archive_relation', status: 'published',
        publishedResourceId: 'relation-1', payload: { before },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      knowledgeRelation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      evidence: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-1')).resolves.toMatchObject({ id: 'cs-1' });
    expect(tx.knowledgeRelation.createMany).toHaveBeenCalledWith({
      data: { ...before, id: 'relation-1' },
      skipDuplicates: true,
    });
    expect(tx.evidence.updateMany).toHaveBeenCalledWith({
      where: { id: 'evidence-1', targetRelationId: null },
      data: { targetRelationId: 'relation-1' },
    });
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
  });

  it('rejects restoring an archived relation when its evidence was rebound later', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    const before = {
      id: 'relation-1', relation: 'supports', sourcePageId: 'page-1', targetPageId: 'page-2',
      strength: 1, confidence: 1, origin: 'compiled', sourceChangeSetId: 'cs-source',
      createdByAgentId: null, evidenceId: 'evidence-1', lastModifiedByUserId: null,
      lastModifiedAt: new Date('2026-07-26T08:00:00.000Z'),
    };
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-old', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'item-1', type: 'archive_relation', status: 'published',
        publishedResourceId: 'relation-1', payload: { before },
      }],
      approvals: [], space: {}, run: null,
    });
    const evidenceState = { targetRelationId: 'relation-2' as string | null };
    const tx = {
      knowledgeRelation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      evidence: {
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          if (where.id !== 'evidence-1') return { count: 0 };
          if (where.targetRelationId !== undefined && where.targetRelationId !== evidenceState.targetRelationId) {
            return { count: 0 };
          }
          evidenceState.targetRelationId = data.targetRelationId;
          return { count: 1 };
        }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-old')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(evidenceState.targetRelationId).toBe('relation-2');
    expect(tx.changeItem.update).not.toHaveBeenCalled();
  });

  it('rolls back earlier item mutations when a later item conflicts in the same transaction', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    const unchangedAt = new Date('2026-07-27T07:59:00.000Z');
    let state = {
      changeSet: { id: 'cs-old', status: 'published' },
      pages: {
        'page-1': {
          id: 'page-1', spaceId: 'space-1', sourceChangeSetId: 'cs-old',
          lastChangeSetId: 'cs-old', deletedAt: null as Date | null, updatedAt: unchangedAt,
        },
        'page-2': {
          id: 'page-2', spaceId: 'space-1', sourceChangeSetId: 'cs-old',
          lastChangeSetId: 'cs-new', deletedAt: null as Date | null, updatedAt: unchangedAt,
        },
      },
      items: {
        'item-1': { status: 'published' },
        'item-2': { status: 'published' },
      },
    };
    const initialState = structuredClone(state);
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-old', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [
        { id: 'item-1', type: 'create_page', status: 'published', publishedResourceId: 'page-1', payload: {} },
        { id: 'item-2', type: 'create_page', status: 'published', publishedResourceId: 'page-2', payload: {} },
      ],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      changeSet: {
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          if (state.changeSet.id !== where.id || state.changeSet.status !== where.status) return { count: 0 };
          state.changeSet.status = data.status;
          return { count: 1 };
        }),
      },
      page: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          const page = state.pages[where.id as keyof typeof state.pages];
          const matches = page
            && page.spaceId === where.spaceId
            && page.sourceChangeSetId === where.sourceChangeSetId
            && page.lastChangeSetId === where.lastChangeSetId
            && page.deletedAt === where.deletedAt
            && page.updatedAt <= where.updatedAt.lte;
          if (!matches) return null;
          return {
            ...page,
            title: 'Current',
            content: 'Current body',
            authorId: 'user-1',
            slug: 'current',
            format: 'markdown',
            parentId: null,
            syncPath: 'pages/Current.md',
            syncPathKey: 'pages/current.md',
          };
        }),
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          const page = state.pages[where.id as keyof typeof state.pages];
          const matches = page
            && page.spaceId === where.spaceId
            && page.sourceChangeSetId === where.sourceChangeSetId
            && page.lastChangeSetId === where.lastChangeSetId
            && page.deletedAt === where.deletedAt
            && page.updatedAt <= where.updatedAt.lte;
          if (!matches) return { count: 0 };
          page.deletedAt = data.deletedAt;
          return { count: 1 };
        }),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      changeItem: {
        update: jest.fn().mockImplementation(async ({ where, data }: any) => {
          state.items[where.id as keyof typeof state.items].status = data.status;
        }),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => {
      const snapshot = structuredClone(state);
      try {
        return await callback(tx);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    });

    await expect(service.revert('cs-old')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(tx.page.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
    expect(state).toEqual(initialState);
  });

  it('publishes an Agent page update with prior state captured for rollback', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-update', status: 'approved', spaceId: 'space-1', createdByUserId: null, createdByAgentId: 'agent-1',
      items: [{ id: 'update', type: 'update_page', status: 'accepted', payload: { pageId: 'page-1', changes: { title: 'After', content: 'New' } } }],
      approvals: [], space: {}, run: null,
    });
    (prisma as any).agent = { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) };
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'page-1', spaceId: 'space-1', title: 'Before', slug: 'before', content: 'Old',
          parentId: null, format: 'markdown', sourceChangeSetId: null, createdByAgentId: null,
          authorId: 'owner-1', updatedAt: new Date('2026-08-19T10:00:00Z'),
          syncPath: 'pages/Before.md', syncPathKey: pathKey('pages/Before.md'),
        }),
        findUnique: jest.fn().mockResolvedValue({ title: 'After', content: 'New', deletedAt: null }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      pageVersion: { create: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await service.publish('cs-update');
    expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'Before', content: 'Old' }) }));
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ before: expect.objectContaining({ title: 'Before' }) }) }) }));
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'After', sourceChangeSetId: 'cs-update', createdByAgentId: 'agent-1' }) }));
  });

  it('rejects a page update that loses the publication compare-and-set race', async () => {
    const updatedAt = new Date('2026-08-19T10:00:00Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-page-race', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'update', type: 'update_page', status: 'accepted', payload: { pageId: 'page-1', expectedUpdatedAt: updatedAt.toISOString(), changes: { title: 'After' } } }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'page-1', spaceId: 'space-1', title: 'Before', slug: 'before', content: 'Old',
          parentId: null, format: 'markdown', sourceChangeSetId: null, createdByAgentId: null,
          authorId: 'user-1', updatedAt,
          syncPath: 'pages/Before.md', syncPathKey: pathKey('pages/Before.md'),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pageVersion: { create: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-page-race')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'page-1', spaceId: 'space-1', deletedAt: null, updatedAt },
    }));
  });

  it('rejects a relation update that loses the publication compare-and-set race', async () => {
    const modifiedAt = new Date('2026-08-19T10:00:00Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-relation-race', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'relation-update', type: 'update_relation', status: 'accepted', payload: {
        relationId: 'relation-1', sourceKnowledgeKey: 'source-key', targetKnowledgeKey: 'target-key',
        relation: 'supports', expectedLastModifiedAt: modifiedAt.toISOString(),
      } }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: { findFirst: jest.fn().mockResolvedValueOnce({ id: 'page-1' }).mockResolvedValueOnce({ id: 'page-2' }) },
      knowledgeRelation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'relation-1', relation: 'related', sourcePageId: 'page-1', targetPageId: 'page-2',
          lastModifiedAt: modifiedAt, sourcePage: { spaceId: 'space-1' }, targetPage: { spaceId: 'space-1' },
          createdAt: new Date('2026-08-18T10:00:00Z'),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-relation-race')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(tx.knowledgeRelation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'relation-1', lastModifiedAt: modifiedAt },
    }));
  });
});

describe('one-shot review-publish and agent auto-publish', () => {
  const prisma = {
    changeItem: { count: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    changeSet: { updateMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    approval: { create: jest.fn() },
    space: { findUnique: jest.fn() },
    agent: { findUnique: jest.fn() },
    agentGrant: { findUnique: jest.fn() },
    page: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
    evidence: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const search = { indexPage: jest.fn().mockResolvedValue({ lexicalIndexed: true }) } as any;
  const syncPaths = { allocate: jest.fn() } as any;
  const graphMaintenance = { enqueue: jest.fn() } as any;
  const service = new ReviewService(
    prisma,
    search,
    { advance: jest.fn(), lockSpace: jest.fn() } as any,
    syncPaths,
    graphMaintenance,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    syncPaths.allocate.mockResolvedValue({
      path: 'pages/Generated.md',
      pathKey: pathKey('pages/Generated.md'),
    });
    prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
    prisma.changeSet.updateMany.mockResolvedValue({ count: 1 });
  });

  it('reviewPublish accepts pending items, approves and publishes in one call', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'i1', type: 'create_page', status: 'accepted', payload: { title: 'A', content: 'x' } }],
      approvals: [], space: {}, run: null,
    });
    prisma.page.create.mockResolvedValue({ id: 'page-1' });
    await service.reviewPublish('cs-1', 'reviewer-1');
    expect(prisma.changeItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { changeSetId: 'cs-1', status: 'pending' },
      data: { status: 'accepted' },
    }));
    expect(prisma.approval.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ changeSetId: 'cs-1', reviewerId: 'reviewer-1', decision: 'approved' }),
    }));
    expect(prisma.page.create).toHaveBeenCalled();
  });

  it('reviewPublish refuses a change set not pending review', async () => {
    prisma.changeSet.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reviewPublish('cs-1', 'reviewer-1')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('reviewPublish refuses to approve and publish when no item is accepted', async () => {
    prisma.changeItem.count.mockResolvedValue(0);

    await expect(service.reviewPublish('cs-empty', 'reviewer-1')).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.changeItem.count).toHaveBeenCalledWith({
      where: { changeSetId: 'cs-empty', status: 'accepted' },
    });
    expect(prisma.approval.create).not.toHaveBeenCalled();
  });

  it('propose auto-publishes when space, agent and credential all allow it', async () => {
    prisma.space.findUnique.mockResolvedValue({ approvalPolicy: 'scoped-auto-publish' });
    prisma.agent.findUnique.mockResolvedValue({ approvalMode: 'scoped-auto-publish' });
    prisma.agentGrant.findUnique.mockResolvedValue({ scopes: [] });
    prisma.changeSet.create.mockResolvedValue({ id: 'cs-auto', status: 'approved' });
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-auto', status: 'approved', spaceId: 'space-1', createdByUserId: null, createdByAgentId: 'agent-1',
      items: [{ id: 'i1', type: 'create_page', status: 'accepted', payload: { title: 'A', content: 'x' } }],
      approvals: [], space: {}, run: null,
    });
    prisma.page.create.mockResolvedValue({ id: 'page-1' });
    const result = await service.propose(
      { userId: 'owner-1', agentId: 'agent-1', scopes: ['review:auto-publish'] },
      'space-1', 'Auto', { type: 'create_page', payload: { title: 'A', content: 'x' } },
    );
    expect(prisma.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'approved' }),
    }));
    expect(result.autoPublished).toBe(true);
  });

  it('propose stays pending_review when the space grant excludes auto-publish', async () => {
    prisma.space.findUnique.mockResolvedValue({ approvalPolicy: 'scoped-auto-publish' });
    prisma.agent.findUnique.mockResolvedValue({ approvalMode: 'scoped-auto-publish' });
    prisma.agentGrant.findUnique.mockResolvedValue({ scopes: ['pages:read', 'pages:write'] });
    prisma.changeSet.create.mockResolvedValue({ id: 'cs-p', status: 'pending_review', items: [] });

    const result = await service.propose(
      { userId: 'owner-1', agentId: 'agent-1', scopes: ['pages:write', 'review:auto-publish'] },
      'space-1', 'Manual', { type: 'create_page', payload: { title: 'A' } },
    );

    expect(prisma.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending_review' }),
    }));
    expect(result.autoPublished).toBeFalsy();
  });

  it('propose stays pending_review when auto-publish conditions are not met', async () => {
    prisma.space.findUnique.mockResolvedValue({ approvalPolicy: 'always-review' });
    prisma.agent.findUnique.mockResolvedValue({ approvalMode: 'scoped-auto-publish' });
    prisma.changeSet.create.mockResolvedValue({ id: 'cs-p', status: 'pending_review', items: [] });
    const result = await service.propose(
      { userId: 'owner-1', agentId: 'agent-1', scopes: ['review:auto-publish'] },
      'space-1', 'Manual', { type: 'create_page', payload: { title: 'A' } },
    );
    expect(prisma.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending_review' }),
    }));
    expect(result.autoPublished).toBeFalsy();
  });
});

describe('ReviewService readable page paths', () => {
  const prisma = {
    changeSet: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const search = {
    indexPage: jest.fn().mockResolvedValue({ lexicalIndexed: true }),
  } as any;
  const revisionWriter = {
    lockSpace: jest.fn().mockImplementation(async (tx: unknown) => tx),
    advance: jest.fn().mockResolvedValue({ revisionId: 'revision-1' }),
  } as any;
  const syncPaths = {
    allocate: jest.fn(),
  } as any;
  const graphMaintenance = { enqueue: jest.fn() } as any;
  const service = new ReviewService(
    prisma,
    search,
    revisionWriter,
    syncPaths,
    graphMaintenance,
  );

  let changeSet: any;
  let tx: any;

  beforeEach(() => {
    jest.clearAllMocks();
    changeSet = {
      id: 'cs-1',
      status: 'approved',
      spaceId: 'space-1',
      createdByUserId: 'user-1',
      createdByAgentId: null,
      items: [],
      approvals: [],
      space: {},
      run: null,
    };
    tx = {
      changeSet: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      changeItem: { update: jest.fn().mockResolvedValue({}) },
      page: {
        create: jest.fn().mockResolvedValue({
          id: 'page-1',
          knowledgeKey: 'knowledge-1',
        }),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          title: 'Guide',
          content: '# Guide\n\nBody',
          deletedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([{
          knowledgeKey: 'knowledge-1',
          syncPath: 'pages/Guide.md',
          title: 'Guide',
          content: '# Guide\n\nBody',
          deletedAt: null,
        }]),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      evidence: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    prisma.changeSet.findUnique.mockImplementation(async () => changeSet);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    syncPaths.allocate.mockResolvedValue({
      path: 'pages/Guide.md',
      pathKey: pathKey('pages/Guide.md'),
    });
  });

  it('uses a legal sourcePath without allocating a title path', async () => {
    changeSet.items = [{
      id: 'create-1',
      type: 'create_page',
      status: 'accepted',
      payload: {
        title: 'Setup',
        content: '# Setup\n\nBody',
        sourcePath: 'guides/Setup.md',
      },
    }];
    tx.page.findUnique.mockResolvedValue({
      title: 'Setup',
      content: '# Setup\n\nBody',
      deletedAt: null,
    });
    tx.page.findMany.mockResolvedValue([{
      knowledgeKey: 'knowledge-1',
      syncPath: 'guides/Setup.md',
      title: 'Setup',
      content: '# Setup\n\nBody',
      deletedAt: null,
    }]);

    await service.publish('cs-1');

    expect(syncPaths.allocate).not.toHaveBeenCalled();
    expect(tx.page.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        syncPath: 'guides/Setup.md',
        syncPathKey: pathKey('guides/Setup.md'),
      }),
    }));
  });

  it('allocates a readable path when sourcePath is absent or non-portable', async () => {
    changeSet.items = [{
      id: 'create-1',
      type: 'create_page',
      status: 'accepted',
      payload: {
        title: 'Guide',
        content: '# Guide\n\nBody',
        sourcePath: '/not-portable.md',
      },
    }];

    await service.publish('cs-1');

    expect(syncPaths.allocate).toHaveBeenCalledWith(tx, {
      spaceId: 'space-1',
      directory: 'pages',
      title: 'Guide',
    });
    expect(tx.page.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        syncPath: 'pages/Guide.md',
        syncPathKey: pathKey('pages/Guide.md'),
      }),
    }));
  });

  it('renames the existing path when an accepted update changes title', async () => {
    const updatedAt = new Date('2026-08-20T00:00:00.000Z');
    changeSet.items = [{
      id: 'update-1',
      type: 'update_page',
      status: 'accepted',
      payload: {
        pageId: 'page-1',
        changes: { title: 'New' },
      },
    }];
    tx.page.findFirst.mockResolvedValue({
      id: 'page-1',
      knowledgeKey: 'knowledge-1',
      spaceId: 'space-1',
      title: 'Old',
      slug: 'old',
      content: '# Old\n\nBody',
      parentId: null,
      format: 'markdown',
      authorId: 'user-1',
      updatedAt,
      sourceChangeSetId: null,
      createdByAgentId: null,
      lastChangeSetId: null,
      lastModifiedByUserId: 'user-1',
      lastModifiedByAgentId: null,
      lastModifiedAt: updatedAt,
      sourceId: null,
      sourceVersionId: null,
      sourcePath: null,
      syncPath: 'guides/Old.md',
      syncPathKey: pathKey('guides/Old.md'),
    });
    syncPaths.allocate.mockResolvedValue({
      path: 'guides/New.md',
      pathKey: pathKey('guides/New.md'),
    });
    tx.page.findUnique.mockResolvedValue({
      title: 'New',
      content: '# Old\n\nBody',
      deletedAt: null,
    });
    tx.page.findMany.mockResolvedValue([{
      knowledgeKey: 'knowledge-1',
      syncPath: 'guides/New.md',
      title: 'New',
      content: '# Old\n\nBody',
      deletedAt: null,
    }]);

    await service.publish('cs-1');

    expect(syncPaths.allocate).toHaveBeenCalledWith(tx, {
      spaceId: 'space-1',
      directory: 'guides',
      title: 'New',
      excludePageId: 'page-1',
    });
    expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        syncPath: 'guides/Old.md',
        syncPathKey: pathKey('guides/Old.md'),
      }),
    }));
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          before: expect.objectContaining({
            syncPath: 'guides/Old.md',
            syncPathKey: pathKey('guides/Old.md'),
          }),
        }),
      }),
    }));
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: 'New',
        syncPath: 'guides/New.md',
        syncPathKey: pathKey('guides/New.md'),
      }),
    }));
    expect(revisionWriter.advance).toHaveBeenCalledWith(
      tx,
      'space-1',
      [expect.objectContaining({
        path: 'guides/New.md',
        body: '# Old\n\nBody',
      })],
      expect.anything(),
    );
  });

  it('preserves body bytes including a matching H1 during path allocation', async () => {
    changeSet.items = [{
      id: 'create-1',
      type: 'create_page',
      status: 'accepted',
      payload: { title: 'Title', content: '# Title\n\nBody' },
    }];
    syncPaths.allocate.mockResolvedValue({
      path: 'pages/Title.md',
      pathKey: pathKey('pages/Title.md'),
    });
    tx.page.findUnique.mockResolvedValue({
      title: 'Title',
      content: '# Title\n\nBody',
      deletedAt: null,
    });
    tx.page.findMany.mockResolvedValue([{
      knowledgeKey: 'knowledge-1',
      syncPath: 'pages/Title.md',
      title: 'Title',
      content: '# Title\n\nBody',
      deletedAt: null,
    }]);

    await service.publish('cs-1');

    expect(tx.page.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ content: '# Title\n\nBody' }),
    }));
    expect(revisionWriter.advance).toHaveBeenCalledWith(
      tx,
      'space-1',
      [expect.objectContaining({ body: '# Title\n\nBody' })],
      expect.anything(),
    );
  });

  it('advances a normal ChangeSet when the real knowledgeSubmission delegate finds no submission', async () => {
    changeSet.items = [{
      id: 'create-1',
      type: 'create_page',
      status: 'accepted',
      payload: { title: 'Guide', content: '# Guide\n\nBody' },
    }];
    tx.knowledgeSubmission = {
      findUnique: jest.fn().mockResolvedValue(null),
    };

    await service.publish('cs-1');

    expect(tx.knowledgeSubmission.findUnique).toHaveBeenCalledWith({
      where: { changeSetId: 'cs-1' },
    });
    expect(revisionWriter.advance).toHaveBeenCalledWith(
      tx,
      'space-1',
      [expect.objectContaining({ operation: 'upsert', pageId: 'knowledge-1' })],
      expect.objectContaining({ sourceChangeSetId: 'cs-1' }),
    );
  });

  it('keeps the current path for a sanitization-equivalent title update', async () => {
    const updatedAt = new Date('2026-08-20T00:00:00.000Z');
    changeSet.items = [{
      id: 'update-1',
      type: 'update_page',
      status: 'accepted',
      payload: {
        pageId: 'page-1',
        changes: { title: 'A <> B' },
      },
    }];
    tx.page.findFirst.mockResolvedValue({
      id: 'page-1',
      knowledgeKey: 'knowledge-1',
      spaceId: 'space-1',
      title: 'A / B',
      slug: 'a-b',
      content: '# A / B\n\nBody',
      parentId: null,
      format: 'markdown',
      authorId: 'user-1',
      updatedAt,
      sourceChangeSetId: null,
      createdByAgentId: null,
      lastChangeSetId: null,
      lastModifiedByUserId: 'user-1',
      lastModifiedByAgentId: null,
      lastModifiedAt: updatedAt,
      sourceId: null,
      sourceVersionId: null,
      sourcePath: null,
      syncPath: 'notes/custom.md',
      syncPathKey: pathKey('notes/custom.md'),
    });
    tx.page.findUnique.mockResolvedValue({
      title: 'A <> B',
      content: '# A / B\n\nBody',
      deletedAt: null,
    });
    tx.page.findMany.mockResolvedValue([{
      knowledgeKey: 'knowledge-1',
      syncPath: 'notes/custom.md',
      title: 'A <> B',
      content: '# A / B\n\nBody',
      deletedAt: null,
    }]);

    await service.publish('cs-1');

    expect(syncPaths.allocate).not.toHaveBeenCalled();
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({
        syncPath: expect.anything(),
        syncPathKey: expect.anything(),
      }),
    }));
    expect(revisionWriter.advance).toHaveBeenCalledWith(
      tx,
      'space-1',
      [expect.objectContaining({
        path: 'notes/custom.md',
        body: '# A / B\n\nBody',
      })],
      expect.anything(),
    );
  });

  it('locks the Space before allocating or writing a page', async () => {
    changeSet.items = [{
      id: 'create-1',
      type: 'create_page',
      status: 'accepted',
      payload: { title: 'Guide', content: '' },
    }];

    await service.publish('cs-1');

    expect(revisionWriter.lockSpace).toHaveBeenCalledWith(tx, 'space-1');
    expect(revisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(
      syncPaths.allocate.mock.invocationCallOrder[0],
    );
    expect(syncPaths.allocate.mock.invocationCallOrder[0]).toBeLessThan(
      tx.page.create.mock.invocationCallOrder[0],
    );
  });
});

describe('ReviewService page revert ordering and audit', () => {
  const prisma = {
    changeSet: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const search = {
    indexPage: jest.fn().mockResolvedValue({ lexicalIndexed: true }),
  } as any;
  const revisionWriter = {
    lockSpace: jest.fn().mockImplementation(async (tx: unknown) => tx),
    advance: jest.fn().mockResolvedValue({ revisionId: 'revision-1' }),
  } as any;
  const graphMaintenance = { enqueue: jest.fn() } as any;
  const service = new ReviewService(
    prisma,
    search,
    revisionWriter,
    { allocate: jest.fn() } as any,
    graphMaintenance,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['create_page', {}, null],
    ['update_page', { before: { title: 'Before', content: 'Old', syncPath: 'guides/Before.md' } }, null],
    ['archive_page', { before: { deletedAt: null } }, new Date('2026-08-20T00:00:00.000Z')],
  ])('locks and snapshots the current Page before reverting %s', async (type, payload, deletedAt) => {
    const publishedAt = new Date('2026-08-20T00:01:00.000Z');
    const current = {
      id: 'page-1',
      knowledgeKey: 'knowledge-1',
      spaceId: 'space-1',
      title: 'Current title',
      content: 'Current body',
      authorId: 'user-1',
      slug: 'current-title',
      format: 'markdown',
      parentId: null,
      syncPath: 'guides/Current title.md',
      syncPathKey: 'guides/current title.md',
      sourceChangeSetId: 'cs-1',
      lastChangeSetId: 'cs-1',
      updatedAt: new Date('2026-08-20T00:00:30.000Z'),
      deletedAt,
    };
    const changeSet = {
      id: 'cs-1',
      status: 'published',
      spaceId: 'space-1',
      publishedAt,
      createdByUserId: 'user-1',
      createdByAgentId: null,
      items: [{
        id: 'item-1',
        type,
        status: 'published',
        publishedResourceId: 'page-1',
        payload,
      }],
      approvals: [],
      space: {},
      run: null,
    };
    const tx = {
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn().mockResolvedValue({}) },
      page: {
        findFirst: jest.fn().mockResolvedValue(current),
        findUnique: jest.fn().mockResolvedValue({
          title: current.title,
          content: current.content,
          deletedAt: type === 'archive_page' ? null : new Date(),
        }),
        findMany: jest.fn().mockResolvedValue([current]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.changeSet.findUnique.mockResolvedValue(changeSet);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.revert('cs-1');

    expect(tx.changeSet.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      revisionWriter.lockSpace.mock.invocationCallOrder[0],
    );
    expect(revisionWriter.lockSpace).toHaveBeenCalledWith(tx, 'space-1');
    const firstPageOperation = Math.min(
      tx.page.findFirst.mock.invocationCallOrder[0],
      tx.page.findUnique.mock.invocationCallOrder[0],
      tx.page.findMany.mock.invocationCallOrder[0],
      tx.page.updateMany.mock.invocationCallOrder[0],
    );
    expect(revisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(firstPageOperation);
    expect(tx.page.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      tx.pageVersion.create.mock.invocationCallOrder[0],
    );
    expect(tx.pageVersion.create).toHaveBeenCalledWith({
      data: {
        pageId: current.id,
        title: current.title,
        content: current.content,
        authorId: current.authorId,
        slug: current.slug,
        format: current.format,
        parentId: current.parentId,
        syncPath: current.syncPath,
        syncPathKey: current.syncPathKey,
      },
    });
    expect(tx.pageVersion.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.page.updateMany.mock.invocationCallOrder[0],
    );
    expect(tx.page.findFirst.mock.calls[0][0].where).toBe(
      tx.page.updateMany.mock.calls[0][0].where,
    );
    expect(revisionWriter.advance).toHaveBeenCalledWith(
      tx,
      'space-1',
      expect.any(Array),
      expect.objectContaining({ origin: 'change_set', sourceChangeSetId: 'cs-1' }),
    );
  });
});

describe('ReviewService archive audit and provenance', () => {
  const prisma = {
    changeSet: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const search = {
    indexPage: jest.fn().mockResolvedValue({ lexicalIndexed: true }),
  } as any;
  const revisionWriter = {
    lockSpace: jest.fn().mockImplementation(async (tx: unknown) => tx),
    advance: jest.fn().mockResolvedValue({ revisionId: 'revision-1' }),
  } as any;
  const graphMaintenance = { enqueue: jest.fn() } as any;
  const service = new ReviewService(
    prisma,
    search,
    revisionWriter,
    { allocate: jest.fn() } as any,
    graphMaintenance,
  );

  const originalUpdatedAt = new Date('2026-08-20T00:00:00.000Z');
  const originalModifiedAt = new Date('2026-08-19T23:59:00.000Z');
  const originalPage = {
    id: 'page-1', knowledgeKey: 'knowledge-1', spaceId: 'space-1',
    title: 'Archived title', slug: 'archived-title',
    content: '# Archived title\n\nOriginal body', format: 'markdown',
    parentId: 'parent-1', authorId: 'author-1',
    sourceChangeSetId: 'cs-origin', createdByAgentId: 'agent-origin',
    lastChangeSetId: 'cs-before', lastModifiedByUserId: 'user-before',
    lastModifiedByAgentId: null, lastModifiedAt: originalModifiedAt,
    sourceId: 'source-1', sourceVersionId: 'source-version-1',
    sourcePath: 'source/Archived.md', syncPath: 'guides/Archived title.md',
    syncPathKey: pathKey('guides/Archived title.md'), deletedAt: null,
    updatedAt: originalUpdatedAt,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes a complete pre-archive audit record and archives with exact row CAS', async () => {
    const changeSet = {
      id: 'cs-archive', status: 'approved', spaceId: 'space-1',
      createdByUserId: null, createdByAgentId: 'agent-archive',
      items: [{
        id: 'item-archive', type: 'archive_page', status: 'accepted',
        payload: { pageId: 'page-1', expectedUpdatedAt: originalUpdatedAt.toISOString() },
      }], approvals: [], space: {}, run: null,
    };
    (prisma as any).agent = { findUnique: jest.fn().mockResolvedValue({ ownerId: 'agent-owner' }) };
    const tx = {
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn().mockResolvedValue({}) },
      page: {
        findFirst: jest.fn().mockResolvedValue(originalPage),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          title: originalPage.title, content: originalPage.content,
          deletedAt: new Date('2026-08-20T00:01:00.000Z'),
        }),
        findMany: jest.fn().mockResolvedValue([{
          knowledgeKey: originalPage.knowledgeKey, syncPath: originalPage.syncPath,
          title: originalPage.title, content: originalPage.content,
          deletedAt: new Date('2026-08-20T00:01:00.000Z'),
        }]),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.changeSet.findUnique.mockResolvedValue(changeSet);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-archive');

    expect(revisionWriter.lockSpace).toHaveBeenCalledWith(tx, 'space-1');
    expect(revisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(
      tx.page.findFirst.mock.invocationCallOrder[0],
    );
    expect(tx.pageVersion.create).toHaveBeenCalledWith({
      data: {
        pageId: originalPage.id, title: originalPage.title,
        content: originalPage.content, authorId: originalPage.authorId,
        slug: originalPage.slug, format: originalPage.format,
        parentId: originalPage.parentId, syncPath: originalPage.syncPath,
        syncPathKey: originalPage.syncPathKey,
      },
    });
    expect(tx.changeItem.update).toHaveBeenCalledWith({
      where: { id: 'item-archive' },
      data: { payload: {
        pageId: 'page-1', expectedUpdatedAt: originalUpdatedAt.toISOString(),
        before: {
          lastChangeSetId: originalPage.lastChangeSetId,
          lastModifiedByUserId: originalPage.lastModifiedByUserId,
          lastModifiedByAgentId: originalPage.lastModifiedByAgentId,
          lastModifiedAt: originalModifiedAt.toISOString(),
          deletedAt: null,
        },
      } },
    });
    expect(tx.page.updateMany).toHaveBeenCalledWith({
      where: {
        id: originalPage.id, spaceId: originalPage.spaceId,
        deletedAt: null, updatedAt: originalUpdatedAt,
      },
      data: expect.objectContaining({
        deletedAt: expect.any(Date), lastChangeSetId: 'cs-archive',
        lastModifiedByAgentId: 'agent-archive', lastModifiedByUserId: null,
        lastModifiedAt: expect.any(Date),
      }),
    });
    expect(tx.pageVersion.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.page.updateMany.mock.invocationCallOrder[0],
    );
  });

  it('rolls back archive audit, item status and revision when exact row CAS loses a race', async () => {
    const changeSet = {
      id: 'cs-archive', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-archive', createdByAgentId: null,
      items: [{ id: 'item-archive', type: 'archive_page', status: 'accepted', payload: { pageId: 'page-1' } }],
      approvals: [], space: {}, run: null,
    };
    let committed = {
      changeSetStatus: 'approved', itemStatus: 'accepted',
      itemPayload: { pageId: 'page-1' } as Record<string, unknown>,
      page: { ...originalPage }, versions: [] as unknown[],
    };
    prisma.changeSet.findUnique.mockResolvedValue(changeSet);
    prisma.$transaction.mockImplementation(async (callback: any) => {
      const local = structuredClone(committed);
      const tx = {
        changeSet: { updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          if (local.changeSetStatus !== where.status) return { count: 0 };
          local.changeSetStatus = data.status;
          return { count: 1 };
        }) },
        changeItem: { update: jest.fn().mockImplementation(async ({ data }: any) => {
          if (data.payload) local.itemPayload = data.payload;
          if (data.status) local.itemStatus = data.status;
          return {};
        }) },
        page: {
          findFirst: jest.fn().mockImplementation(async () => {
            const snapshot = structuredClone(local.page);
            committed.page.updatedAt = new Date('2026-08-20T00:00:01.000Z');
            return snapshot;
          }),
          updateMany: jest.fn().mockImplementation(async ({ where }: any) => ({
            count: committed.page.updatedAt.getTime() === where.updatedAt.getTime() ? 1 : 0,
          })),
          findUnique: jest.fn(), findMany: jest.fn(),
        },
        pageVersion: { create: jest.fn().mockImplementation(async ({ data }: any) => {
          local.versions.push(data);
          return {};
        }) },
        pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      };
      const result = await callback(tx);
      committed = local;
      return result;
    });

    await expect(service.publish('cs-archive')).rejects.toMatchObject({
      businessCode: 'CHANGESET_INVALID_STATE',
      message: 'The page changed while it was being archived',
    });

    expect(committed.changeSetStatus).toBe('approved');
    expect(committed.itemStatus).toBe('accepted');
    expect(committed.itemPayload).toEqual({ pageId: 'page-1' });
    expect(committed.versions).toEqual([]);
    expect(committed.page.deletedAt).toBeNull();
    expect(committed.page.updatedAt).toEqual(new Date('2026-08-20T00:00:01.000Z'));
    expect(revisionWriter.advance).not.toHaveBeenCalled();
    expect(search.indexPage).not.toHaveBeenCalled();
  });

  it('reconstructs JSON dates and restores complete pre-archive provenance', async () => {
    const publishedAt = new Date('2026-08-20T00:02:00.000Z');
    const archivedAt = new Date('2026-08-20T00:01:00.000Z');
    const before = {
      lastChangeSetId: originalPage.lastChangeSetId,
      lastModifiedByUserId: originalPage.lastModifiedByUserId,
      lastModifiedByAgentId: originalPage.lastModifiedByAgentId,
      lastModifiedAt: originalModifiedAt.toISOString(),
      deletedAt: null,
      id: 'attacker-controlled-page-id',
      spaceId: 'attacker-controlled-space-id',
      updatedAt: '1999-01-01T00:00:00.000Z',
      title: 'must not be restored',
      content: 'must not be restored',
      unknownKey: 'must not reach Prisma',
    };
    const archivedPage = {
      ...originalPage, deletedAt: archivedAt, updatedAt: archivedAt,
      lastChangeSetId: 'cs-archive', lastModifiedByUserId: null,
      lastModifiedByAgentId: 'agent-archive', lastModifiedAt: archivedAt,
    };
    const changeSet = {
      id: 'cs-archive', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: null, createdByAgentId: 'agent-archive',
      items: [{
        id: 'item-archive', type: 'archive_page', status: 'published',
        publishedResourceId: 'page-1', payload: { pageId: 'page-1', before },
      }], approvals: [], space: {}, run: null,
    };
    const tx = {
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn().mockResolvedValue({}) },
      page: {
        findFirst: jest.fn().mockResolvedValue(archivedPage),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          title: originalPage.title, content: originalPage.content,
          deletedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([{
          knowledgeKey: originalPage.knowledgeKey,
          syncPath: originalPage.syncPath,
          title: originalPage.title, content: originalPage.content,
          deletedAt: null,
        }]),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.changeSet.findUnique.mockResolvedValue(changeSet);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.revert('cs-archive');

    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        lastChangeSetId: originalPage.lastChangeSetId,
        lastModifiedByUserId: originalPage.lastModifiedByUserId,
        lastModifiedByAgentId: originalPage.lastModifiedByAgentId,
        lastModifiedAt: originalModifiedAt,
        deletedAt: null,
      },
    }));
    expect(tx.page.updateMany.mock.calls[0][0].data.lastChangeSetId).toBe('cs-before');
    expect(tx.page.updateMany.mock.calls[0][0].data.lastModifiedByUserId).toBe('user-before');
    expect(tx.page.updateMany.mock.calls[0][0].data.lastModifiedByAgentId).toBeNull();
    expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        syncPath: archivedPage.syncPath, syncPathKey: archivedPage.syncPathKey,
      }),
    }));
  });

  it.each([
    [
      'supports a legacy deletedAt-only prior state',
      { deletedAt: null },
      { deletedAt: null },
    ],
    [
      'preserves nullable provenance ID nulls',
      {
        lastChangeSetId: null,
        lastModifiedByUserId: null,
        lastModifiedByAgentId: null,
        deletedAt: null,
      },
      {
        lastChangeSetId: null,
        lastModifiedByUserId: null,
        lastModifiedByAgentId: null,
        deletedAt: null,
      },
    ],
    [
      'converts a valid lastModifiedAt ISO date',
      {
        lastModifiedAt: '2026-08-19T23:59:00.000Z',
        deletedAt: null,
      },
      {
        lastModifiedAt: new Date('2026-08-19T23:59:00.000Z'),
        deletedAt: null,
      },
    ],
    [
      'copies a valid lastModifiedAt Date value',
      {
        lastModifiedAt: new Date('2026-08-19T23:58:00.000Z'),
        deletedAt: null,
      },
      {
        lastModifiedAt: new Date('2026-08-19T23:58:00.000Z'),
        deletedAt: null,
      },
    ],
  ] as Array<[string, Record<string, unknown>, Record<string, unknown>]>)('%s', async (_label, before, expectedData) => {
    const publishedAt = new Date('2026-08-20T00:02:00.000Z');
    const archivedAt = new Date('2026-08-20T00:01:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-archive', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-archive', createdByAgentId: null,
      items: [{
        id: 'item-archive', type: 'archive_page', status: 'published',
        publishedResourceId: 'page-1', payload: { pageId: 'page-1', before },
      }], approvals: [], space: {}, run: null,
    });
    const tx = {
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn().mockResolvedValue({}) },
      page: {
        findFirst: jest.fn().mockResolvedValue({ ...originalPage, deletedAt: archivedAt }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          title: originalPage.title, content: originalPage.content, deletedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.revert('cs-archive');

    expect(tx.page.updateMany.mock.calls[0][0].data).toEqual(expectedData);
  });

  it.each([
    ['missing before', { pageId: 'page-1' }],
    ['missing deletedAt', { pageId: 'page-1', before: {} }],
    ['undefined deletedAt', { pageId: 'page-1', before: { deletedAt: undefined } }],
    ['non-null deletedAt', { pageId: 'page-1', before: { deletedAt: '2026-08-19T00:00:00.000Z' } }],
    ['null lastModifiedAt', { pageId: 'page-1', before: { deletedAt: null, lastModifiedAt: null } }],
    ['undefined lastModifiedAt', { pageId: 'page-1', before: { deletedAt: null, lastModifiedAt: undefined } }],
    ['invalid lastModifiedAt string', { pageId: 'page-1', before: { deletedAt: null, lastModifiedAt: 'not-a-date' } }],
    ['invalid lastModifiedAt Date', { pageId: 'page-1', before: { deletedAt: null, lastModifiedAt: new Date('invalid') } }],
  ] as Array<[string, Record<string, unknown>]>)('fails closed before starting revert work for %s', async (_label, payload) => {
    const publishedAt = new Date('2026-08-20T00:02:00.000Z');
    const archivedAt = new Date('2026-08-20T00:01:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-archive', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-archive', createdByAgentId: null,
      items: [{
        id: 'item-archive', type: 'archive_page', status: 'published',
        publishedResourceId: 'page-1', payload,
      }], approvals: [], space: {}, run: null,
    });
    const initialState = {
      changeSetStatus: 'published',
      itemStatus: 'published',
      page: {
        deletedAt: archivedAt,
        lastChangeSetId: 'cs-archive',
      },
      pageVersions: [] as unknown[],
    };
    let committed = structuredClone(initialState);
    const changeSetClaim = jest.fn();
    const changeItemUpdate = jest.fn();
    const pageFindFirst = jest.fn();
    const pageUpdate = jest.fn();
    const pageVersionCreate = jest.fn();
    prisma.$transaction.mockImplementation(async (callback: any) => {
      const local = structuredClone(committed);
      changeSetClaim.mockImplementation(async () => {
        local.changeSetStatus = 'reverting';
        return { count: 1 };
      });
      changeItemUpdate.mockImplementation(async ({ data }: any) => {
        if (data.status) local.itemStatus = data.status;
        return {};
      });
      pageFindFirst.mockResolvedValue({
        ...originalPage,
        deletedAt: archivedAt,
        lastChangeSetId: 'cs-archive',
      });
      pageUpdate.mockImplementation(async ({ data }: any) => {
        if (Object.prototype.hasOwnProperty.call(data, 'deletedAt')) {
          local.page.deletedAt = data.deletedAt;
        }
        return { count: 1 };
      });
      pageVersionCreate.mockImplementation(async ({ data }: any) => {
        local.pageVersions.push(data);
        return {};
      });
      const tx = {
        changeSet: { updateMany: changeSetClaim },
        changeItem: { update: changeItemUpdate },
        page: {
          findFirst: pageFindFirst,
          updateMany: pageUpdate,
          findUnique: jest.fn().mockResolvedValue({
            title: originalPage.title,
            content: originalPage.content,
            deletedAt: local.page.deletedAt,
          }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        pageVersion: { create: pageVersionCreate },
        pageSearchDocument: {
          upsert: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      const result = await callback(tx);
      committed = local;
      return result;
    });

    await expect(service.revert('cs-archive')).rejects.toMatchObject({
      businessCode: 'CHANGESET_INVALID_STATE',
      message: 'Archived page prior state is invalid',
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(changeSetClaim).not.toHaveBeenCalled();
    expect(pageFindFirst).not.toHaveBeenCalled();
    expect(pageVersionCreate).not.toHaveBeenCalled();
    expect(pageUpdate).not.toHaveBeenCalled();
    expect(changeItemUpdate).not.toHaveBeenCalled();
    expect(revisionWriter.advance).not.toHaveBeenCalled();
    expect(search.indexPage).not.toHaveBeenCalled();
    expect(committed).toEqual(initialState);
  });
});
