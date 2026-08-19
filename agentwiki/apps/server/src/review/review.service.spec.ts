import { BadRequestException } from '@nestjs/common';
import { ReviewService } from './review.service';

describe('ReviewService queue presentation', () => {
  const prisma = { changeSet: { count: jest.fn(), findMany: jest.fn() } } as any;
  const service = new ReviewService(prisma, {} as any, {} as any);

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
  const service = new ReviewService(prisma, search, { advance: jest.fn(), lockSpace: jest.fn() } as any);

  beforeEach(() => {
    jest.clearAllMocks();
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
      syncPath: 'docs/a.md', syncPathKey: 'docs/a.md', deletedAt: archivedAt,
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
      where: { id: archived.id, spaceId: 'space-1', deletedAt: archivedAt },
      data: expect.objectContaining({
        title: 'Restored', content: 'new', deletedAt: null,
        sourceId: 'source-1', sourceVersionId: 'version-2', sourcePath: 'docs/a.md',
        sourceChangeSetId: 'cs-restore', lastChangeSetId: 'cs-restore',
      }),
    });
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'restore' },
      data: { status: 'published', publishedResourceId: archived.id },
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
      sourceId: 'source-1', sourceVersionId: 'version-1', sourcePath: 'docs/a.md',
      syncPath: 'docs/a.md', syncPathKey: 'docs/a.md', deletedAt: archivedAt,
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
      page: { findMany: jest.fn().mockResolvedValue([{ id: 'page-1', spaceId: 'space-1' }, { id: 'page-2', spaceId: 'space-1' }]) },
      knowledgeRelation: { create: jest.fn().mockResolvedValue({ id: 'relation-1' }) },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-relation');

    expect(tx.knowledgeRelation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ strength: 0, confidence: 0 }),
    }));
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
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-old')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'page-1',
        spaceId: 'space-1',
        lastChangeSetId: 'cs-old',
        updatedAt: { lte: publishedAt },
      }),
    }));
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ deletedAt: new Date(), title: 'A', content: '' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
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
        update: jest.fn().mockResolvedValue({ id: 'relation-1' }),
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
    expect(tx.knowledgeRelation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'relation-1' },
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
    expect(tx.page.updateMany).toHaveBeenCalledTimes(2);
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
        findFirst: jest.fn().mockResolvedValue({ id: 'page-1', spaceId: 'space-1', title: 'Before', slug: 'before', content: 'Old', parentId: null, format: 'markdown', sourceChangeSetId: null, createdByAgentId: null, authorId: 'owner-1' }),
        findUnique: jest.fn().mockResolvedValue({ title: 'After', content: 'New', deletedAt: null }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
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
    expect(tx.page.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'After', sourceChangeSetId: 'cs-update', createdByAgentId: 'agent-1' }) }));
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
  const service = new ReviewService(prisma, search, { advance: jest.fn(), lockSpace: jest.fn() } as any);

  beforeEach(() => {
    jest.clearAllMocks();
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
