import {
  canonicalizeMemoryContent,
  canonicalMemoryHash,
  MemoryService,
} from './memory.service';

describe('MemoryService', () => {
  const prisma = {
    agentMemory: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    page: { findMany: jest.fn() },
    knowledgeRelation: { findMany: jest.fn() },
    evidence: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const llm = { generateEmbedding: jest.fn().mockRejectedValue(new Error('not configured')) } as any;
  const authorization = { assertLiveAgentWriteAccess: jest.fn().mockResolvedValue(undefined) } as any;
  const humanPrincipal = { userId: 'user-1' };
  const service = new MemoryService(prisma, { get: jest.fn() } as any, llm, authorization);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.page.findMany.mockResolvedValue([]);
    prisma.knowledgeRelation.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (operation: any) => operation(prisma));
    authorization.assertLiveAgentWriteAccess.mockResolvedValue(undefined);
    llm.generateEmbedding.mockRejectedValue(new Error('not configured'));
  });

  it('ranks recall with explainable lexical, vector and entity-graph signals', async () => {
    prisma.agentMemory.findMany.mockResolvedValue([
      { id: 'a', content: 'PostgreSQL backup procedure', tags: ['database'], entities: { system: 'PostgreSQL' }, importance: 0.7 },
      { id: 'b', content: 'Frontend color palette', tags: ['css'], entities: {}, importance: 0.9 },
    ]);
    prisma.agentMemory.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.recall('agent-1', 'space-1', 'PostgreSQL database backup', undefined, humanPrincipal);
    expect(result[0].memory.id).toBe('a');
    expect(result[0].reasons).toEqual(expect.objectContaining({ lexical: expect.any(Number), vector: expect.any(Number), graph: expect.any(Number) }));
  });

  it('privacy-deletes content and structured entities', async () => {
    prisma.agentMemory.updateMany.mockResolvedValue({ count: 1 });
    await service.remove('agent-1', 'space-1', 'memory-1', humanPrincipal);
    expect(prisma.agentMemory.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ agentId: 'agent-1', spaceId: 'space-1', id: 'memory-1' }),
      data: expect.objectContaining({ content: '[deleted]', tags: [], entities: {}, sourceEvidenceId: null, embedding: [] }),
    }));
  });

  it('returns the winning row when concurrent writes hit the unique memory key', async () => {
    prisma.agentMemory.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner', content: 'same' });
    prisma.agentMemory.count.mockResolvedValue(0);
    prisma.agentMemory.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    const result = await service.create('agent-1', { spaceId: 'space-1', type: 'semantic', content: 'same' } as any, humanPrincipal);
    expect(result).toMatchObject({ id: 'winner', deduplicated: true });
  });

  it('deduplicates normalized content before consuming quota', async () => {
    prisma.agentMemory.findFirst.mockResolvedValue({ id: 'existing', content: 'same' });
    const result = await service.create('agent-1', { spaceId: 'space-1', type: 'semantic', content: ' Same  ' } as any, humanPrincipal);
    expect(result).toMatchObject({ id: 'existing', deduplicated: true });
    expect(prisma.agentMemory.count).not.toHaveBeenCalled();
  });

  it('rejects evidence from a different space', async () => {
    prisma.evidence.findUnique.mockResolvedValue({ run: { spaceId: 'space-2' } });
    await expect(service.create('agent-1', { spaceId: 'space-1', type: 'episodic', content: 'Observed failure', sourceEvidenceId: 'evidence-1' } as any, humanPrincipal)).rejects.toThrow('Source evidence must belong');
  });

  it('writes nothing when an Agent Credential is revoked before a memory delete', async () => {
    authorization.assertLiveAgentWriteAccess.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { businessCode: 'SPACE_ACCESS_DENIED' }),
    );

    await expect(service.remove(
      'agent-1', 'space-1', 'memory-1',
      { userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1' },
    )).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });

    expect(prisma.agentMemory.updateMany).not.toHaveBeenCalled();
  });

  it('retrieves private memory only for the target Agent plus shared memory in the same space', async () => {
    prisma.agentMemory.findMany.mockResolvedValue([]);
    await service.list('agent-1', 'space-1');
    expect(prisma.agentMemory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ spaceId: 'space-1', OR: [{ agentId: 'agent-1' }, { visibility: 'space' }] }),
    }));
  });

  it('uses stored embedding vectors when available', async () => {
    llm.generateEmbedding.mockResolvedValue({ embedding: [1, 0], modelId: 'embedding-test' });
    prisma.agentMemory.findMany.mockResolvedValue([
      { id: 'near', content: 'unrelated words', tags: [], entities: {}, importance: 0, embedding: [1, 0] },
      { id: 'far', content: 'unrelated words', tags: [], entities: {}, importance: 0, embedding: [0, 1] },
    ]);
    prisma.agentMemory.updateMany.mockResolvedValue({ count: 2 });
    const result = await service.recall('agent-1', 'space-1', 'query', undefined, humanPrincipal);
    expect(result[0].memory.id).toBe('near');
    expect(result[0].reasons.vector).toBeGreaterThan(0.9);
  });

  it('meets the synthetic Recall@3 and MRR quality gate for the two approved use cases', async () => {
    const corpus = [
      { id: 'db-backup', content: 'PostgreSQL disaster recovery backup procedure', tags: ['runbook'], entities: { system: 'PostgreSQL' }, importance: 0.7 },
      { id: 'deploy', content: 'Production deployment rollback checklist', tags: ['runbook'], entities: { system: 'deployment' }, importance: 0.7 },
      { id: 'decision-auth', content: 'Architecture decision use scoped Agent credentials for automation', tags: ['decision'], entities: { topic: 'authentication' }, importance: 0.7 },
      { id: 'decision-db', content: 'Architecture decision PostgreSQL is the durable data store', tags: ['decision'], entities: { topic: 'database' }, importance: 0.7 },
      { id: 'ui', content: 'Frontend color palette and typography', tags: ['design'], entities: {}, importance: 0.5 },
    ];
    prisma.agentMemory.findMany.mockResolvedValue(corpus);
    prisma.agentMemory.updateMany.mockResolvedValue({ count: 1 });
    const cases = [
      { query: 'PostgreSQL backup recovery runbook', relevant: 'db-backup' },
      { query: 'rollback production deployment procedure', relevant: 'deploy' },
      { query: 'why scoped Agent credentials authentication', relevant: 'decision-auth' },
      { query: 'durable database architecture PostgreSQL decision', relevant: 'decision-db' },
    ];
    let hitsAt3 = 0;
    let reciprocalRank = 0;
    for (const qualityCase of cases) {
      const result = await service.recall('agent-1', 'space-1', qualityCase.query, 3, humanPrincipal);
      const rank = result.findIndex((entry) => entry.memory.id === qualityCase.relevant) + 1;
      if (rank > 0 && rank <= 3) hitsAt3 += 1;
      if (rank > 0) reciprocalRank += 1 / rank;
    }
    expect(hitsAt3 / cases.length).toBeGreaterThanOrEqual(0.9);
    expect(reciprocalRank / cases.length).toBeGreaterThanOrEqual(0.8);
  });
});

describe('canonical memory hashing', () => {
  it('collapses and trims only explicit ASCII whitespace and lowercases only ASCII A-Z', () => {
    expect(canonicalizeMemoryContent(' \tA\r\nB\f\v ')).toBe('a b');
  });

  it('preserves FEFF, U+0130 and NBSP code points', () => {
    expect(canonicalizeMemoryContent('\uFEFF A \uFEFF')).toBe('\uFEFF a \uFEFF');
    expect(canonicalizeMemoryContent('İ A')).toBe('İ a');
    expect(canonicalizeMemoryContent('A\u00a0B')).toBe('a\u00a0b');
    expect(canonicalizeMemoryContent('A\u00a0B')).not.toBe(canonicalizeMemoryContent('A B'));
  });

  it('hashes the locale-independent canonical representation', () => {
    expect(canonicalMemoryHash(' \tA\r\nB\f\v ')).toBe('0cc9cd4dd26c5137b675a0d819cb9ab0');
    expect(canonicalMemoryHash('\uFEFF A \uFEFF')).toBe('6ff7fce6bd22edeac246eed56dbe39f5');
    expect(canonicalMemoryHash('İ A')).toBe('f768706201e258a59afff4ab3e0dc686');
    expect(canonicalMemoryHash('A\u00a0B')).toBe('7570c04097240e0563415b8d354c4607');
  });
});
