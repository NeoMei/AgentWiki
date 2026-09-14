import { SearchService } from './search.service';

describe('SearchService data minimization and durable index', () => {
  const prisma = {
    page: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    pageSearchDocument: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(async (ops: any) => typeof ops === 'function' ? ops(prisma) : Promise.all(ops)),
  } as any;
  const llm = { generateEmbedding: jest.fn() } as any;
  const service = new SearchService(prisma, llm);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pageSearchDocument.findUnique.mockResolvedValue(null);
    prisma.pageSearchDocument.findMany.mockResolvedValue([]);
  });

  it('uses bounded lexical IDs and selects only public author fields when hydrating winners', async () => {
    llm.generateEmbedding.mockRejectedValue(new Error('offline'));
    prisma.$queryRaw.mockResolvedValue([{ id: 'page-1', titleRank: 0, similarity: 0, textMatch: true }]);
    prisma.page.findMany.mockResolvedValue([{ id: 'page-1' }]);
    await service.searchPages('term', undefined, 10, ['space-1']);
    const query = prisma.page.findMany.mock.calls[0][0];
    expect(query.where.spaceId).toEqual({ in: ['space-1'] });
    expect(query.include.author.select).toEqual({ id: true, email: true, name: true, type: true });
    expect(query.take).toBe(10);
    expect(prisma.pageSearchDocument.findMany).not.toHaveBeenCalled();
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.strings.join(' ')).toContain('FROM "PageSearchDocument"');
    expect(sql.values).toEqual(expect.arrayContaining(['term', 'space-1', 10]));
  });

  it('keeps lexical IDs when semantic candidates are below the threshold', async () => {
    llm.generateEmbedding.mockResolvedValue({ embedding: [1, 0] });
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'lexical-match', titleRank: 0, similarity: 0, textMatch: true }]).mockResolvedValueOnce([]);
    prisma.page.findMany.mockResolvedValue([{ id: 'lexical-match' }]);
    await expect(service.searchPages('exact term', undefined, 10, ['space-1'])).resolves.toEqual([
      { page: { id: 'lexical-match', path: null }, similarity: 0, matchType: 'text' },
    ]);
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
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'semantic-hit', titleRank: 0, similarity: 0.9, textMatch: false }]);
    prisma.page.findMany.mockResolvedValue([
      { id: 'semantic-hit', author: {}, space: {} },
    ]);

    await expect(service.searchPages('term', 'space-1', 10, [])).resolves.toEqual([
      { page: { id: 'semantic-hit', author: {}, space: {}, path: null }, similarity: 0.9, matchType: 'semantic' },
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.page.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['semantic-hit'] }, deletedAt: null, spaceId: 'space-1' },
    }));
  });

  it('adds Folder placement and canonical path to search Page results', async () => {
    llm.generateEmbedding.mockRejectedValue(new Error('offline'));
    prisma.$queryRaw.mockResolvedValue([{ id: 'page-1', titleRank: 1, similarity: 0, textMatch: true }]);
    prisma.page.findMany.mockResolvedValue([{ id: 'page-1', folderId: 'folder-1', syncPath: 'pages/Project/Page.md' }]);

    await expect(service.searchPages('Page', 'space-1', 10, [])).resolves.toEqual([{
      page: expect.objectContaining({
        id: 'page-1', folderId: 'folder-1', path: 'pages/Project/Page.md',
      }),
      similarity: 0, matchType: 'text',
    }]);
  });

  it('skips both index writes when the content hash and vector are unchanged', async () => {
    const text = 'Title\nBody';
    const hash = require('crypto').createHash('sha256').update(text).digest('hex');
    prisma.page.findUnique.mockResolvedValue({ id: 'page-1', title: 'Title', content: 'Body' });
    prisma.pageSearchDocument.findUnique.mockResolvedValue({ contentHash: hash });
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
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(service.indexPage('page-1')).resolves.toEqual({
      lexicalIndexed: true, semanticIndexed: false, superseded: true,
    });
    const vectorWrite = prisma.$executeRaw.mock.calls[1][0];
    expect(vectorWrite.strings.join(' ')).toContain('page."title"');
    expect(vectorWrite.strings.join(' ')).toContain('page."content"');
    expect(vectorWrite.values).toEqual(expect.arrayContaining(['Title', 'Body']));
  });

  it('forces an effect retry to replace an unproven cached vector for the current lexical hash', async () => {
    const text = 'Title\nBody';
    const hash = require('crypto').createHash('sha256').update(text).digest('hex');
    prisma.page.findUnique.mockResolvedValue({ id: 'page-1', title: 'Title', content: 'Body' });
    prisma.pageSearchDocument.findUnique.mockResolvedValue({ contentHash: hash });
    prisma.$queryRaw.mockResolvedValue([{ exists: true }]);
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.pageSearchDocument.upsert.mockResolvedValue({});
    llm.generateEmbedding.mockResolvedValue({ embedding: [0.2] });

    await expect(service.indexPage('page-1', { requireSemanticWrite: true })).resolves.toEqual({
      lexicalIndexed: true, semanticIndexed: true,
    });
    expect(llm.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
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

describe('Q3 hybrid authorized search', () => {
  function setup() {
    const pages = [
      { id: 'one', title: 'Project notes', spaceId: 'space', deletedAt: null },
      { id: 'two', title: 'PROJECT', spaceId: 'space', deletedAt: null },
      { id: 'three', title: 'Old project', spaceId: 'space', deletedAt: null },
      { id: 'semantic', title: 'Related idea', spaceId: 'space', deletedAt: null },
    ];
    const semantic = [{ id: 'one', titleRank: 1, similarity: 0.8, textMatch: true },
      { id: 'semantic', titleRank: 0, similarity: 0.95, textMatch: false }];
    const prisma: any = {
      $queryRaw: jest.fn(async (sql: any) => sql.strings.join(' ').includes('FROM "PageSearchDocument"')
        ? [{ id: 'two', titleRank: 2, similarity: 0, textMatch: true },
          { id: 'one', titleRank: 1, similarity: 0, textMatch: true },
          { id: 'three', titleRank: 1, similarity: 0, textMatch: true }].slice(0, sql.values.at(-1))
        : semantic),
      page: { findMany: jest.fn(async ({ where }: any) => pages.filter(page => where.id.in.includes(page.id))) },
      pageSearchDocument: { findMany: jest.fn() },
    };
    const llm: any = { generateEmbedding: jest.fn().mockResolvedValue({ embedding: [1, 0] }) };
    return { prisma, llm, semantic, service: new SearchService(prisma, llm) };
  }

  it('keeps all three title hits when semantic search finds only one, plus semantic-only results', async () => {
    const { service, prisma } = setup();
    const result = await service.searchPages('project', undefined, 10, ['space']);
    expect(result.map(r => r.page.id)).toEqual(['two', 'one', 'three', 'semantic']);
    expect(result.map(r => r.matchType)).toEqual(['text', 'text', 'text', 'semantic']);
    expect(result.find(r => r.page.id === 'one')?.similarity).toBe(0.8);
    expect(result.find(r => r.page.id === 'three')?.similarity).toBe(0);
    expect(prisma.pageSearchDocument.findMany).not.toHaveBeenCalled();
  });

  it('applies limit after title ranking and deduplication', async () => {
    const { service } = setup();
    expect((await service.searchPages('project', undefined, 2, ['space'])).map(r => r.page.id)).toEqual(['two', 'one']);
  });

  it.each([null, { embedding: [] }])('finds titles without embeddings %p and never reports text as 100%% similarity', async (embedding) => {
    const { service, llm, prisma } = setup(); llm.generateEmbedding.mockResolvedValue(embedding);
    const result = await service.searchPages('project', undefined, 10, ['space']);
    expect(result.map(r => r.page.id)).toEqual(['two', 'one', 'three']);
    expect(result.every(r => r.matchType === 'text' && r.similarity === 0)).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not query pages or generate embeddings with empty authorization', async () => {
    const { service, prisma, llm } = setup();
    expect(await service.searchPages('project', undefined, 10, [])).toEqual([]);
    expect(prisma.pageSearchDocument.findMany).not.toHaveBeenCalled();
    expect(llm.generateEmbedding).not.toHaveBeenCalled();
  });

  it('rechecks authorized, active pages when hydrating semantic candidates', async () => {
    const { service, prisma, semantic } = setup();
    semantic.splice(0, semantic.length, { id: 'moved-private', titleRank: 0, similarity: 0.99, textMatch: false });
    const result = await service.searchPages('project', undefined, 10, ['space']);
    expect(result.map(r => r.page.id)).toEqual(['two', 'one', 'three']);
    expect(prisma.page.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['two', 'one', 'three', 'moved-private'] }, deletedAt: null, spaceId: { in: ['space'] } },
    }));
    expect(prisma.page.findMany).toHaveBeenCalledTimes(1);
  });

  it('hydrates only the exact-title winner at limit one despite semantic candidates', async () => {
    const { service, prisma } = setup();
    expect((await service.searchPages('project', undefined, 1, ['space'])).map(r => r.page.id)).toEqual(['two']);
    expect(prisma.page.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['two'] }, deletedAt: null, spaceId: { in: ['space'] } }, take: 1,
    }));
    expect(prisma.pageSearchDocument.findMany).not.toHaveBeenCalled();
  });
});
