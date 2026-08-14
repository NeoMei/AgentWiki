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
    await service.lockSpace(tx as any, 'space-1');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('advances a revision with normalized rows, delta and bigint metrics', async () => {
    const createdRevision: any = {
      id: 'rev-1', sequence: 1, revisionContentHash: 'x', pageCount: 1n,
      revisionBodyBytes: 6n, revisionManifestByteLength: 100n,
    };
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ bytes: 6n }]),
      spaceKnowledgeRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdRevision),
        update: jest.fn().mockResolvedValue({}),
      },
      syncRevisionPageRow: {
        findMany: jest.fn().mockResolvedValue([{
          pageId: '11111111-1111-4111-8111-111111111111',
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
      agentMemory: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      knowledgeRelation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const body = 'Hello\n';
    const result = await service.advance(tx as any, 'space-1', [{
      operation: 'upsert',
      pageId: '11111111-1111-4111-8111-111111111111',
      path: 'Guide.md',
      title: 'Guide',
      body,
    }], { origin: 'obsidian_sync' });

    expect(result.sequence).toBe(1);
    expect(result.pageCount).toBe(1n);
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
});
