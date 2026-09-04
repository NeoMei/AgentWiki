import { KnowledgeService } from './knowledge.service';

const principal = { userId: 'user-1', platformRole: 'user' as const };
const authorization = {
  lockLiveHumanPrincipal: jest.fn().mockResolvedValue({ id: 'user-1' }),
  assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner' }),
};
const revisionWriter = { lockSpace: jest.fn(async (tx: any) => tx) };

describe('KnowledgeService related pages', () => {
  it('does not return relations whose source or target page is archived', async () => {
    const prisma = {
      knowledgeRelation: { findMany: jest.fn().mockResolvedValue([]) },
      page: { findMany: jest.fn() },
    } as any;
    const service = new KnowledgeService(prisma, authorization as any, revisionWriter as any);

    await expect(service.getRelatedPages('page-1')).resolves.toEqual([]);

    expect(prisma.knowledgeRelation.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ sourcePageId: 'page-1' }, { targetPageId: 'page-1' }],
        sourcePage: { deletedAt: null },
        targetPage: { deletedAt: null },
      },
    });
  });

  it('adds Folder placement and canonical path to each related Page', async () => {
    const relation = {
      id: 'relation-1', sourcePageId: 'page-1', targetPageId: 'page-2',
      relation: 'references', strength: 1, confidence: 1, origin: 'manual',
      evidenceId: null, createdByAgentId: null,
    };
    const prisma = {
      knowledgeRelation: { findMany: jest.fn().mockResolvedValue([relation]) },
      page: { findMany: jest.fn().mockResolvedValue([{
        id: 'page-2', title: 'Target', slug: 'target', spaceId: 'space-1',
        folderId: 'folder-1', syncPath: 'pages/Project/Target.md', deletedAt: null,
      }]) },
    } as any;
    const service = new KnowledgeService(prisma, authorization as any, revisionWriter as any);

    await expect(service.getRelatedPages('page-1')).resolves.toEqual([
      expect.objectContaining({
        page: expect.objectContaining({
          id: 'page-2', folderId: 'folder-1', path: 'pages/Project/Target.md',
        }),
      }),
    ]);
  });
});

describe('KnowledgeService graph Page nodes', () => {
  it('adds Folder placement and canonical path without changing graph coordinates', async () => {
    const prisma = {
      page: { findMany: jest.fn().mockResolvedValue([{
        id: 'page-1', title: 'Page', folderId: null, syncPath: 'pages/Page.md',
      }]) },
      knowledgeRelation: { findMany: jest.fn().mockResolvedValue([]) },
      changeSet: { findMany: jest.fn() },
      evidence: { findMany: jest.fn() },
      agent: { findMany: jest.fn() },
      user: { findMany: jest.fn() },
    } as any;
    const service = new KnowledgeService(prisma, authorization as any, revisionWriter as any);

    await expect(service.getGraph('space-1')).resolves.toEqual({
      nodes: [expect.objectContaining({
        id: 'page-1', folderId: null, path: 'pages/Page.md',
        x: expect.any(Number), y: expect.any(Number),
      })],
      edges: [],
    });
  });
});

describe('KnowledgeService relation ownership', () => {
  beforeEach(() => jest.clearAllMocks());

  it('locks the Space and rejects a manual relation write after human access is revoked', async () => {
    const tx = {
      user: { findUnique: jest.fn() },
      space: { findUnique: jest.fn() },
      spaceMember: { findUnique: jest.fn() },
      page: { findMany: jest.fn() },
      knowledgeRelation: { create: jest.fn(), update: jest.fn() },
    };
    const prisma = {
      page: { findMany: jest.fn().mockResolvedValue([
        { id: 'page-1', spaceId: 'space-1' },
        { id: 'page-2', spaceId: 'space-1' },
      ]) },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    } as any;
    const revoked = new Error('membership revoked');
    const authorization = {
      lockLiveHumanPrincipal: jest.fn().mockResolvedValue({ id: 'user-1' }),
      assertLiveHumanSpaceAccess: jest.fn().mockRejectedValue(revoked),
    };
    const revisionWriter = { lockSpace: jest.fn(async () => tx) };
    const service = new (KnowledgeService as any)(prisma, authorization, revisionWriter);

    await expect(service.createRelation({
      sourcePageId: 'page-1', targetPageId: 'page-2', relation: 'references',
    }, { userId: 'user-1' })).rejects.toBe(revoked);

    expect(revisionWriter.lockSpace).toHaveBeenCalledWith(tx, 'space-1');
    expect(tx.knowledgeRelation.create).not.toHaveBeenCalled();
    expect(tx.knowledgeRelation.update).not.toHaveBeenCalled();
  });

  it.each(['delete', 'update'] as const)(
    'blocks a %s after the caller loses human access while waiting for the Space lock',
    async (operation) => {
      const relation = { id: 'relation-1', sourcePage: { spaceId: 'space-1' } };
      const tx = {
        spaceGraphState: { upsert: jest.fn() },
        $queryRaw: jest.fn(),
        knowledgeRelation: {
          findUnique: jest.fn(), delete: jest.fn(), update: jest.fn(),
        },
      };
      const prisma = {
        knowledgeRelation: { findUnique: jest.fn().mockResolvedValue(relation) },
        $transaction: jest.fn(async (callback: any) => callback(tx)),
      } as any;
      const revoked = new Error('membership revoked');
      const deniedAuthorization = {
        lockLiveHumanPrincipal: jest.fn().mockResolvedValue({ id: 'user-1' }),
        assertLiveHumanSpaceAccess: jest.fn().mockRejectedValue(revoked),
      };
      const writer = { lockSpace: jest.fn(async () => tx) };
      const service = new KnowledgeService(prisma, deniedAuthorization as any, writer as any);

      const result = operation === 'delete'
        ? service.deleteRelation('relation-1', principal)
        : service.updateRelationStrength('relation-1', 0.7, principal);
      await expect(result).rejects.toBe(revoked);

      expect(writer.lockSpace).toHaveBeenCalledWith(tx, 'space-1');
      expect(tx.spaceGraphState.upsert).not.toHaveBeenCalled();
      expect(tx.knowledgeRelation.delete).not.toHaveBeenCalled();
      expect(tx.knowledgeRelation.update).not.toHaveBeenCalled();
    },
  );

  it('lets a manual relation replace an automatic relation on the same triple', async () => {
    const automatic = {
      id: 'auto-1',
      sourcePageId: 'page-1',
      targetPageId: 'page-2',
      relation: 'references',
      origin: 'auto_wikilink',
    };
    const tx = {
      page: { findMany: jest.fn().mockResolvedValue([
        { id: 'page-1', spaceId: 'space-1' },
        { id: 'page-2', spaceId: 'space-1' },
      ]) },
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      knowledgeRelation: {
        findUnique: jest.fn().mockResolvedValue(automatic),
        update: jest.fn().mockResolvedValue({ ...automatic, origin: 'manual' }),
        create: jest.fn(),
      },
      evidence: { findUnique: jest.fn(), update: jest.fn() },
    };
    const prisma = {
      page: { findMany: jest.fn().mockResolvedValue([
        { id: 'page-1', spaceId: 'space-1' },
        { id: 'page-2', spaceId: 'space-1' },
      ]) },
      evidence: { findUnique: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    } as any;
    const service = new KnowledgeService(prisma, authorization as any, revisionWriter as any);

    await service.createRelation({
      sourcePageId: 'page-1',
      targetPageId: 'page-2',
      relation: 'references',
    }, principal);

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
      page: { findMany: jest.fn().mockResolvedValue([
        { id: 'page-1', spaceId: 'space-1' },
        { id: 'page-2', spaceId: 'space-1' },
      ]) },
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
      evidence: { findUnique: jest.fn(), update: jest.fn() },
    };
    const prisma = {
      page: { findMany: jest.fn().mockResolvedValue([
        { id: 'page-1', spaceId: 'space-1' },
        { id: 'page-2', spaceId: 'space-1' },
      ]) },
      evidence: { findUnique: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    } as any;
    const service = new KnowledgeService(prisma, authorization as any, revisionWriter as any);

    await expect(service.createRelation({
      sourcePageId: 'page-1',
      targetPageId: 'page-2',
      relation: 'references',
    }, principal)).resolves.toMatchObject({ origin: 'manual' });

    expect(tx.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(tx.knowledgeRelation.findUnique.mock.invocationCallOrder[0]);
    expect(authorization.lockLiveHumanPrincipal.mock.invocationCallOrder[0]).toBeLessThan(
      revisionWriter.lockSpace.mock.invocationCallOrder[0],
    );
    expect(revisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(
      authorization.assertLiveHumanSpaceAccess.mock.invocationCallOrder[0],
    );
    expect(authorization.assertLiveHumanSpaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
  });
});
