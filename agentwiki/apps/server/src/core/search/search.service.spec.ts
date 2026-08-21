import { SearchService } from './search.service';

describe('SearchService data minimization and durable index', () => {
  const prisma = {
    page: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    pageSearchDocument: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  } as any;
  const llm = { generateEmbedding: jest.fn() } as any;
  const service = new SearchService(prisma, llm);

  beforeEach(() => jest.clearAllMocks());

  it('uses the persistent lexical index and selects only public author fields', async () => {
    llm.generateEmbedding.mockRejectedValue(new Error('offline'));
    prisma.pageSearchDocument.findMany.mockResolvedValue([{ page: { id: 'page-1' } }]);
    await service.searchPages('term', undefined, 10, ['space-1']);
    const query = prisma.pageSearchDocument.findMany.mock.calls[0][0];
    expect(query.where.page.spaceId).toEqual({ in: ['space-1'] });
    expect(query.include.page.include.author.select).toEqual({ id: true, email: true, name: true, type: true });
    expect(query.include.page.include.author.select).not.toHaveProperty('password');
    expect(query.include.page.include.author.select).not.toHaveProperty('apiKey');
  });

  it('falls back to the lexical index when semantic candidates are below the similarity threshold', async () => {
    llm.generateEmbedding.mockResolvedValue({ embedding: [1, 0] });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.pageSearchDocument.findMany.mockResolvedValue([
      { page: { id: 'lexical-match' } },
    ]);

    await expect(service.searchPages('exact term', undefined, 10, ['space-1'])).resolves.toEqual([
      { page: { id: 'lexical-match' }, similarity: 1 },
    ]);
    expect(prisma.pageSearchDocument.findMany).toHaveBeenCalled();
  });

  it('writes a lexical search document even when semantic indexing is unavailable', async () => {
    prisma.page.findUnique.mockResolvedValue({ id: 'page-1', title: 'Title', content: 'Body' });
    prisma.pageSearchDocument.findMany.mockResolvedValue([]);
    prisma.pageSearchDocument.upsert.mockResolvedValue({});
    llm.generateEmbedding.mockRejectedValue(new Error('offline'));
    await expect(service.indexPage('page-1')).resolves.toEqual({ lexicalIndexed: true, semanticIndexed: false });
    expect(prisma.pageSearchDocument.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ pageId: 'page-1', text: 'Title\nBody', contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }));
  });

  it('runs semantic search through pgvector cosine ordering', async () => {
    llm.generateEmbedding.mockResolvedValue({ embedding: [1, 0] });
    prisma.$queryRaw.mockResolvedValue([{ id: 'semantic-hit', similarity: 0.9 }]);
    prisma.page.findMany.mockResolvedValue([
      { id: 'semantic-hit', author: {}, space: {} },
    ]);

    await expect(service.searchPages('term', 'space-1', 10, [])).resolves.toEqual([
      { page: { id: 'semantic-hit', author: {}, space: {} }, similarity: 0.9 },
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.page.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['semantic-hit'] } },
    }));
  });

  it('skips both index writes when the content hash and vector are unchanged', async () => {
    const text = 'Title\nBody';
    const hash = require('crypto').createHash('sha256').update(text).digest('hex');
    prisma.page.findUnique.mockResolvedValue({ id: 'page-1', title: 'Title', content: 'Body' });
    prisma.pageSearchDocument.findMany.mockResolvedValue([{ contentHash: hash }]);
    prisma.$queryRaw.mockResolvedValue([{ exists: true }]);

    await expect(service.indexPage('page-1')).resolves.toEqual({
      lexicalIndexed: true, semanticIndexed: true, skipped: true,
    });
    expect(prisma.pageSearchDocument.upsert).not.toHaveBeenCalled();
    expect(llm.generateEmbedding).not.toHaveBeenCalled();
  });

  it('never builds the semantic query when the principal has no accessible spaces', async () => {
    llm.generateEmbedding.mockResolvedValue({ embedding: [1, 0] });
    prisma.pageSearchDocument.findMany.mockResolvedValue([]);

    await expect(service.searchPages('term', undefined, 10, [])).resolves.toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('clears the vector alongside the lexical document for a missing page', async () => {
    prisma.page.findUnique.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.pageSearchDocument.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.indexPage('archived-page')).resolves.toEqual({
      lexicalIndexed: false, semanticIndexed: false,
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.pageSearchDocument.deleteMany).toHaveBeenCalledWith({ where: { pageId: 'archived-page' } });
  });

  it('guards the vector write against a concurrent newer index run', async () => {
    prisma.page.findUnique.mockResolvedValue({ id: 'page-1', title: 'Title', content: 'Body' });
    prisma.pageSearchDocument.findMany.mockResolvedValue([]);
    llm.generateEmbedding.mockResolvedValue({ embedding: [0.1] });
    prisma.$executeRaw.mockResolvedValueOnce(0);

    await expect(service.indexPage('page-1')).resolves.toEqual({
      lexicalIndexed: true, semanticIndexed: true,
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('repairs active pages whose lexical document is missing', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'orphan-1' }, { id: 'orphan-2' }]);
    prisma.page.findUnique
      .mockResolvedValueOnce({ id: 'orphan-1', title: 'One', content: 'a' })
      .mockResolvedValueOnce({ id: 'orphan-2', title: 'Two', content: 'b' });
    prisma.pageSearchDocument.findMany.mockResolvedValue([]);
    llm.generateEmbedding.mockRejectedValue(new Error('offline'));

    await expect(service.repairMissingIndexes()).resolves.toBe(2);
    expect(prisma.pageSearchDocument.upsert).toHaveBeenCalledTimes(2);
  });
});
