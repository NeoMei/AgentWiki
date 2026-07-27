import { BadRequestException } from '@nestjs/common';
import { ReviewService } from './review.service';

describe('ReviewService approval boundaries', () => {
  const prisma = {
    changeItem: { count: jest.fn(), updateMany: jest.fn() },
    changeSet: { updateMany: jest.fn(), findUnique: jest.fn() },
    approval: { create: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const search = { indexPage: jest.fn().mockResolvedValue({ lexicalIndexed: true, semanticIndexed: false }) } as any;
  const service = new ReviewService(prisma, search);

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
      page: { create: jest.fn().mockResolvedValue({ id: 'page-1' }), findUnique: jest.fn().mockResolvedValue({ title: 'A', content: 'ok', deletedAt: null }) },
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
