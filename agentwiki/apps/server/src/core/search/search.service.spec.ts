import { SearchService } from './search.service';

describe('SearchService data minimization and durable index', () => {
  const prisma = {
    page: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    pageSearchDocument: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
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

  it('writes a lexical search document even when semantic indexing is unavailable', async () => {
    prisma.page.findUnique.mockResolvedValue({ id: 'page-1', title: 'Title', content: 'Body' });
    prisma.pageSearchDocument.upsert.mockResolvedValue({});
    llm.generateEmbedding.mockRejectedValue(new Error('offline'));
    await expect(service.indexPage('page-1')).resolves.toEqual({ lexicalIndexed: true, semanticIndexed: false });
    expect(prisma.pageSearchDocument.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ pageId: 'page-1', text: 'Title\nBody', contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }));
  });
});
