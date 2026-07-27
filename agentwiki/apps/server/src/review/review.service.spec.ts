import { BadRequestException, ConflictException } from '@nestjs/common';
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

  it('reverts only resources that were actually published', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'published', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [
        { id: 'published', type: 'create_page', status: 'published', publishedResourceId: 'page-1', payload: {} },
        { id: 'rejected', type: 'create_page', status: 'rejected', publishedResourceId: null, payload: {} },
      ], approvals: [], space: {}, run: null,
    });
    const tx = {
      page: { updateMany: jest.fn(), findUnique: jest.fn().mockResolvedValue({ deletedAt: new Date(), title: 'A', content: '' }) },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      knowledgeRelation: { deleteMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await service.revert('cs-1');
    expect(tx.page.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'page-1' } }));
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
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
