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
      spaceKnowledgeRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdRevision),
      },
      syncRevisionPageRow: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      syncRevisionDeltaRow: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      syncPageContentRow: {
        upsert: jest.fn().mockResolvedValue({}),
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
    expect(tx.syncRevisionPageRow.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        revisionId: 'rev-1',
        pageId: '11111111-1111-4111-8111-111111111111',
        path: 'Guide.md',
        pathKey: pathKey('Guide.md'),
        contentHash: await contentHash(body),
      })],
    });
  });
});
