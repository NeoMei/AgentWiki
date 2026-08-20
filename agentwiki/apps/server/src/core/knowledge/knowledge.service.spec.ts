import { KnowledgeService } from './knowledge.service';

describe('KnowledgeService related pages', () => {
  it('does not return relations whose source or target page is archived', async () => {
    const prisma = {
      knowledgeRelation: { findMany: jest.fn().mockResolvedValue([]) },
      page: { findMany: jest.fn() },
    } as any;
    const service = new KnowledgeService(prisma);

    await expect(service.getRelatedPages('page-1')).resolves.toEqual([]);

    expect(prisma.knowledgeRelation.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ sourcePageId: 'page-1' }, { targetPageId: 'page-1' }],
        sourcePage: { deletedAt: null },
        targetPage: { deletedAt: null },
      },
    });
  });
});

describe('KnowledgeService relation ownership', () => {
  it('lets a manual relation replace an automatic relation on the same triple', async () => {
    const automatic = {
      id: 'auto-1',
      sourcePageId: 'page-1',
      targetPageId: 'page-2',
      relation: 'references',
      origin: 'auto_wikilink',
    };
    const tx = {
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      knowledgeRelation: {
        findUnique: jest.fn().mockResolvedValue(automatic),
        update: jest.fn().mockResolvedValue({ ...automatic, origin: 'manual' }),
        create: jest.fn(),
      },
      evidence: { update: jest.fn() },
    };
    const prisma = {
      page: { findMany: jest.fn().mockResolvedValue([
        { id: 'page-1', spaceId: 'space-1' },
        { id: 'page-2', spaceId: 'space-1' },
      ]) },
      evidence: { findUnique: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    } as any;
    const service = new KnowledgeService(prisma);

    await service.createRelation({
      sourcePageId: 'page-1',
      targetPageId: 'page-2',
      relation: 'references',
    }, 'user-1');

    expect(tx.knowledgeRelation.update).toHaveBeenCalledWith({
      where: { id: 'auto-1' },
      data: expect.objectContaining({
        origin: 'manual',
        lastModifiedByUserId: 'user-1',
      }),
    });
    expect(tx.knowledgeRelation.create).not.toHaveBeenCalled();
  });

  it('serializes manual takeover with automatic reconciliation', async () => {
    let graphLocked = false;
    const automatic = {
      id: 'auto-1',
      sourcePageId: 'page-1',
      targetPageId: 'page-2',
      relation: 'references',
      origin: 'auto_wikilink',
    };
    const tx = {
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockImplementation(async () => { graphLocked = true; }),
      knowledgeRelation: {
        findUnique: jest.fn().mockImplementation(async () => {
          if (!graphLocked) throw new Error('automatic reconciliation won the race');
          return automatic;
        }),
        update: jest.fn().mockResolvedValue({ ...automatic, origin: 'manual' }),
        create: jest.fn(),
      },
      evidence: { update: jest.fn() },
    };
    const prisma = {
      page: { findMany: jest.fn().mockResolvedValue([
        { id: 'page-1', spaceId: 'space-1' },
        { id: 'page-2', spaceId: 'space-1' },
      ]) },
      evidence: { findUnique: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    } as any;
    const service = new KnowledgeService(prisma);

    await expect(service.createRelation({
      sourcePageId: 'page-1',
      targetPageId: 'page-2',
      relation: 'references',
    }, 'user-1')).resolves.toMatchObject({ origin: 'manual' });

    expect(tx.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(tx.knowledgeRelation.findUnique.mock.invocationCallOrder[0]);
  });
});
