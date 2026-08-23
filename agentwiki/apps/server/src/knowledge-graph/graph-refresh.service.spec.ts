import { ForbiddenException } from '@nestjs/common';
import { GraphRefreshService } from './graph-refresh.service';
import { GraphExtractionService } from './graph-extraction.service';

describe('GraphRefreshService', () => {
  const extraction = new GraphExtractionService();
  const now = new Date('2026-08-17T00:00:00.000Z');

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const buildPrisma = (overrides: Record<string, any> = {}) => {
    const vectorRows: Array<{ id: string; vector: string }> = [];
    const prisma = {
      space: { findUnique: jest.fn().mockResolvedValue({
        id: 'space-1', members: [{ userId: 'owner-1' }],
      }) },
      spaceGraphState: {
        findUnique: jest.fn().mockResolvedValue({
          wikilinkEnabled: true,
          similarEnabled: false,
          similarThreshold: 0.86,
          llmEnabled: false,
          lastLlmRunAt: null,
        }),
        upsert: jest.fn().mockImplementation(async (args: any) => ({
          wikilinkEnabled: true,
          similarEnabled: false,
          similarThreshold: 0.86,
          llmEnabled: false,
          ...(args.create ?? args.update ?? {}),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      page: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', title: 'Alpha', slug: 'alpha', content: 'See [[Beta]].', embedding: null },
          { id: 'p2', title: 'Beta', slug: 'beta', content: 'Back to [[Alpha]].', embedding: null },
        ]),
      },
      knowledgeRelation: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockImplementation(async (args: any) => ({ count: args.data.length })),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      changeSet: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      $queryRaw: jest.fn().mockImplementation(async (sql: any) => {
        const text = Array.isArray(sql?.strings) ? sql.strings.join('') : String(sql);
        return text.includes('embeddingVector') ? vectorRows : [];
      }),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(prisma)),
      ...overrides,
    };
    (prisma as any).__setVectors = (rows: Array<{ id: string; vector: string }>) => {
      vectorRows.length = 0;
      vectorRows.push(...rows);
    };
    return prisma as any;
  };

  const buildLlm = () => ({ generateText: jest.fn() });

  it('creates wikilink relations and reports dangling links', async () => {
    const prisma = buildPrisma();
    const service = new GraphRefreshService(prisma, extraction, buildLlm() as any);
    jest.spyOn(global, 'Date').mockImplementation(() => now);
    const result = await service.refresh('space-1', ['wikilink']);
    expect(result.wikilink).toEqual({ created: 2, removed: 0, dangling: 0 });
    expect(prisma.knowledgeRelation.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ sourcePageId: 'p1', targetPageId: 'p2', relation: 'references', origin: 'auto_wikilink', confidence: 1 }),
        expect.objectContaining({ sourcePageId: 'p2', targetPageId: 'p1', relation: 'references', origin: 'auto_wikilink', confidence: 1 }),
      ]),
      skipDuplicates: true,
    });
    (global.Date as any).mockRestore();
  });

  it('keeps reconciliation atomic when relation creation fails', async () => {
    const prisma = buildPrisma({
      knowledgeRelation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'stale', sourcePageId: 'p2', targetPageId: 'p1', relation: 'references' },
        ]),
        createMany: jest.fn().mockRejectedValue(new Error('database unavailable')),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    prisma.page.findMany.mockResolvedValue([
      { id: 'p1', title: 'Alpha', slug: 'alpha', content: 'See [[Beta]].', embedding: null },
      { id: 'p2', title: 'Beta', slug: 'beta', content: '', embedding: null },
    ]);
    const service = new GraphRefreshService(prisma, extraction, buildLlm() as any);

    await expect(service.refresh('space-1', ['wikilink'])).rejects.toThrow('database unavailable');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.knowledgeRelation.deleteMany).not.toHaveBeenCalled();
    expect(prisma.spaceGraphState.upsert).not.toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ lastRunAt: expect.any(Date) }),
    }));
  });

  it('reports only rows actually inserted when conflicts are skipped', async () => {
    const prisma = buildPrisma();
    prisma.knowledgeRelation.createMany.mockResolvedValue({ count: 0 });
    prisma.page.findMany.mockResolvedValue([
      { id: 'p1', title: 'Alpha', slug: 'alpha', content: 'See [[Beta]].', embedding: null },
      { id: 'p2', title: 'Beta', slug: 'beta', content: '', embedding: null },
    ]);
    const service = new GraphRefreshService(prisma, extraction, buildLlm() as any);

    const result = await service.refresh('space-1', ['wikilink']);

    expect(result.wikilink.created).toBe(0);
  });

  it('serializes deterministic reconciliation with a database row lock', async () => {
    const prisma = buildPrisma();
    const service = new GraphRefreshService(prisma, extraction, buildLlm() as any);

    await service.refresh('space-1', ['wikilink']);

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.page.findMany.mock.invocationCallOrder[0]);
  });

  it('is idempotent on rerun and removes only its own origin', async () => {
    const own = { id: 'rel-1', sourcePageId: 'p1', targetPageId: 'p2', relation: 'references', origin: 'auto_wikilink' };
    const manual = { id: 'rel-2', sourcePageId: 'p2', targetPageId: 'p1', relation: 'references', origin: 'manual' };
    const prisma = buildPrisma({
      knowledgeRelation: {
        findMany: jest.fn().mockImplementation(async (args: any) =>
          [own, manual].filter((relation) => args.where.origin === undefined || relation.origin === args.where.origin)),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockImplementation(async (args: any) => ({ count: args.where.id.in.length })),
      },
    });
    // Rerun with links removed: only the auto_wikilink edge may be deleted.
    prisma.page.findMany.mockResolvedValue([
      { id: 'p1', title: 'Alpha', slug: 'alpha', content: 'no links now', embedding: null },
      { id: 'p2', title: 'Beta', slug: 'beta', content: 'text', embedding: null },
    ]);
    const service = new GraphRefreshService(prisma, extraction, buildLlm() as any);
    const result = await service.refresh('space-1', ['wikilink']);
    expect(result.wikilink).toEqual({ created: 0, removed: 1, dangling: 0 });
    expect(prisma.knowledgeRelation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['rel-1'] }, origin: 'auto_wikilink' },
    });
  });

  it('removes automatic relations whose target page was archived', async () => {
    const stale = {
      id: 'rel-archived',
      sourcePageId: 'p1',
      targetPageId: 'p2',
      relation: 'references',
      origin: 'auto_wikilink',
    };
    const prisma = buildPrisma({
      knowledgeRelation: {
        findMany: jest.fn().mockImplementation(async (args: any) => [stale].filter((relation) => {
          const sourceIds = args.where.sourcePageId?.in as string[] | undefined;
          const targetIds = args.where.targetPageId?.in as string[] | undefined;
          return (!sourceIds || sourceIds.includes(relation.sourcePageId))
            && (!targetIds || targetIds.includes(relation.targetPageId));
        })),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    prisma.page.findMany.mockResolvedValue([
      { id: 'p1', title: 'Alpha', slug: 'alpha', content: '', embedding: null },
    ]);
    const service = new GraphRefreshService(prisma, extraction, buildLlm() as any);

    const result = await service.refresh('space-1', ['wikilink']);

    expect(result.wikilink.removed).toBe(1);
    expect(prisma.knowledgeRelation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['rel-archived'] }, origin: 'auto_wikilink' },
    });
  });

  it('skips similar layer when disabled and honors canonical pairs when enabled', async () => {
    const prisma = buildPrisma();
    prisma.spaceGraphState.findUnique.mockResolvedValue({
      wikilinkEnabled: true, similarEnabled: true, similarThreshold: 0.9, llmEnabled: false,
    });
    prisma.page.findMany.mockResolvedValue([
      { id: 'p1', title: 'A', slug: 'a', content: '' },
      { id: 'p2', title: 'B', slug: 'b', content: '' },
      { id: 'p3', title: 'C', slug: 'c', content: '' },
    ]);
    (prisma as any).__setVectors([
      { id: 'p1', vector: '[1,0]' },
      { id: 'p2', vector: '[0.99,0.141]' },
    ]);
    const service = new GraphRefreshService(prisma, extraction, buildLlm() as any);
    const result = await service.refresh('space-1', ['similar']);
    expect(result.similar.created).toBe(1);
    expect(result.similar.skipped).toBe(1);
    expect(prisma.knowledgeRelation.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ sourcePageId: 'p1', targetPageId: 'p2', relation: 'similar_to', origin: 'auto_similar' })],
      skipDuplicates: true,
    });
  });

  it('updates the score of a retained automatic similarity relation', async () => {
    const prisma = buildPrisma({
      knowledgeRelation: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'rel-similar', sourcePageId: 'p1', targetPageId: 'p2', relation: 'similar_to',
          confidence: 0.91, strength: 0.91,
        }]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    prisma.spaceGraphState.findUnique.mockResolvedValue({
      wikilinkEnabled: false, similarEnabled: true, similarThreshold: 0.9, llmEnabled: false,
    });
    prisma.page.findMany.mockResolvedValue([
      { id: 'p1', title: 'A', slug: 'a', content: '' },
      { id: 'p2', title: 'B', slug: 'b', content: '' },
    ]);
    (prisma as any).__setVectors([
      { id: 'p1', vector: '[1,0]' },
      { id: 'p2', vector: '[0.99,0.141]' },
    ]);

    await new GraphRefreshService(prisma, extraction, buildLlm() as any)
      .refresh('space-1', ['similar']);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const scoreUpdate = prisma.$executeRaw.mock.calls[0][0];
    expect(scoreUpdate.values).toContain('rel-similar');
    expect(scoreUpdate.values).toContain('auto_similar');
    expect(scoreUpdate.values.find((value: unknown) => typeof value === 'number'))
      .toBeCloseTo(extraction.cosineSimilarity([1, 0], [0.99, 0.141]));
    expect(prisma.knowledgeRelation.createMany).not.toHaveBeenCalled();
    expect(prisma.knowledgeRelation.deleteMany).not.toHaveBeenCalled();
  });

  it('reports llm_unavailable when layer 3 runs without a provider', async () => {
    const llm = { generateText: jest.fn().mockRejectedValue(new Error('no key')) };
    const prisma = buildPrisma();
    prisma.spaceGraphState.findUnique.mockResolvedValue({
      wikilinkEnabled: false, similarEnabled: false, similarThreshold: 0.86, llmEnabled: true,
    });
    const service = new GraphRefreshService(prisma, extraction, llm as any);
    const result = await service.refresh('space-1', ['llm']);
    expect(result.llm).toMatchObject({ changeSetId: null, proposed: 0, reason: 'llm_unavailable' });
  });

  it('creates a pending ChangeSet with create_relation items for valid llm proposals', async () => {
    const llm = {
      generateText: jest.fn().mockResolvedValue({ text: JSON.stringify({ relations: [
        { sourcePageId: 'p1', targetPageId: 'p2', relation: 'supports', confidence: 0.7, evidenceQuote: 'q' },
      ] }) }),
    };
    const prisma = buildPrisma();
    prisma.spaceGraphState.findUnique.mockResolvedValue({
      wikilinkEnabled: false, similarEnabled: false, similarThreshold: 0.86, llmEnabled: true,
    });
    prisma.changeSet.create.mockResolvedValue({ id: 'cs-1' });
    const service = new GraphRefreshService(prisma, extraction, llm as any);
    const result = await service.refresh('space-1', ['llm'], 'reviewer-1');
    expect(result.llm).toEqual({ changeSetId: 'cs-1', proposed: 1 });
    expect(prisma.changeSet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        spaceId: 'space-1',
        status: 'pending_review',
        createdByUserId: 'reviewer-1',
        items: {
          create: [expect.objectContaining({
            type: 'create_relation',
            payload: expect.objectContaining({ origin: 'auto_llm' }),
          })],
        },
      }),
    });
  });

  it('deduplicates repeated llm proposals for the same relation triple', async () => {
    const proposal = { sourcePageId: 'p1', targetPageId: 'p2', relation: 'supports', confidence: 0.7 };
    const llm = {
      generateText: jest.fn().mockResolvedValue({ text: JSON.stringify({ relations: [proposal, proposal] }) }),
    };
    const prisma = buildPrisma();
    prisma.spaceGraphState.findUnique.mockResolvedValue({
      wikilinkEnabled: false, similarEnabled: false, similarThreshold: 0.86, llmEnabled: true,
      lastLlmRunAt: null,
    });
    prisma.changeSet.create.mockResolvedValue({ id: 'cs-deduplicated' });
    const service = new GraphRefreshService(prisma, extraction, llm as any);

    const result = await service.refresh('space-1', ['llm'], 'reviewer-1');

    expect(result.llm.proposed).toBe(1);
    expect(prisma.changeSet.create.mock.calls[0][0].data.items.create).toHaveLength(1);
  });

  it('retries invalid llm JSON once with a stricter prompt', async () => {
    const llm = {
      generateText: jest.fn()
        .mockResolvedValueOnce({ text: 'not json' })
        .mockResolvedValueOnce({ text: JSON.stringify({ relations: [
          { sourcePageId: 'p1', targetPageId: 'p2', relation: 'extends', confidence: 0.8 },
        ] }) }),
    };
    const prisma = buildPrisma();
    prisma.spaceGraphState.findUnique.mockResolvedValue({
      wikilinkEnabled: false, similarEnabled: false, similarThreshold: 0.86, llmEnabled: true,
      lastLlmRunAt: null,
    });
    prisma.changeSet.create.mockResolvedValue({ id: 'cs-retry' });
    const service = new GraphRefreshService(prisma, extraction, llm as any);

    const result = await service.refresh('space-1', ['llm'], 'reviewer-1');

    expect(result.llm).toEqual({ changeSetId: 'cs-retry', proposed: 1 });
    expect(llm.generateText).toHaveBeenCalledTimes(2);
    expect(llm.generateText.mock.calls[1][0]).toContain('previous response was invalid');
  });

  it('processes every page when the final llm batch contains one page', async () => {
    const llm = {
      generateText: jest.fn()
        .mockResolvedValueOnce({ text: JSON.stringify({ relations: [
          { sourcePageId: 'p1', targetPageId: 'p2', relation: 'supports' },
        ] }) })
        .mockResolvedValueOnce({ text: JSON.stringify({ relations: [
          { sourcePageId: 'p6', targetPageId: 'p7', relation: 'extends' },
        ] }) }),
    };
    const prisma = buildPrisma();
    prisma.spaceGraphState.findUnique.mockResolvedValue({
      wikilinkEnabled: false, similarEnabled: false, similarThreshold: 0.86, llmEnabled: true,
      lastLlmRunAt: null,
    });
    prisma.page.findMany.mockResolvedValue(Array.from({ length: 7 }, (_, index) => ({
      id: `p${index + 1}`,
      title: `Page ${index + 1}`,
      slug: `page-${index + 1}`,
      content: `Content ${index + 1}`,
      embedding: null,
    })));
    prisma.changeSet.create.mockResolvedValue({ id: 'cs-batches' });
    const service = new GraphRefreshService(prisma, extraction, llm as any);

    const result = await service.refresh('space-1', ['llm'], 'reviewer-1');

    expect(result.llm).toEqual({ changeSetId: 'cs-batches', proposed: 2 });
    expect(llm.generateText).toHaveBeenCalledTimes(2);
    expect(prisma.changeSet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        items: { create: expect.arrayContaining([
          expect.objectContaining({ payload: expect.objectContaining({ sourcePageId: 'p1', targetPageId: 'p2' }) }),
          expect.objectContaining({ payload: expect.objectContaining({ sourcePageId: 'p6', targetPageId: 'p7' }) }),
        ]) },
      }),
    });
  });

  it('rate-limits llm proposals for 24 hours per space', async () => {
    const llm = { generateText: jest.fn() };
    const prisma = buildPrisma();
    prisma.spaceGraphState.findUnique.mockResolvedValue({
      wikilinkEnabled: false, similarEnabled: false, similarThreshold: 0.86, llmEnabled: true,
      lastLlmRunAt: new Date('2026-08-17T00:00:00.000Z'),
    });
    const service = new GraphRefreshService(prisma, extraction, llm as any);
    jest.useFakeTimers().setSystemTime(new Date('2026-08-17T12:00:00.000Z'));

    const result = await service.refresh('space-1', ['llm'], 'reviewer-1');

    expect(result.llm).toMatchObject({ changeSetId: null, proposed: 0, reason: 'rate_limited' });
    expect(llm.generateText).not.toHaveBeenCalled();
  });

  it('keeps the sweep hash stale when an enabled llm layer is deferred', async () => {
    const llm = { generateText: jest.fn() };
    const prisma = buildPrisma();
    prisma.spaceGraphState.findUnique.mockResolvedValue({
      wikilinkEnabled: true, similarEnabled: false, similarThreshold: 0.86, llmEnabled: true,
      lastLlmRunAt: new Date('2026-08-17T00:00:00.000Z'),
    });
    jest.useFakeTimers().setSystemTime(new Date('2026-08-17T12:00:00.000Z'));
    const service = new GraphRefreshService(prisma, extraction, llm as any);

    const result = await service.refresh('space-1');

    expect(result.llm.reason).toBe('rate_limited');
    const finalUpsert = prisma.spaceGraphState.upsert.mock.calls.at(-1)[0];
    expect(finalUpsert.update).not.toHaveProperty('lastContentHash');
  });

  it('uses a deterministic content hash regardless of database row order', async () => {
    const pages = [
      { id: 'p1', title: 'Alpha', slug: 'alpha', content: 'one', embedding: null },
      { id: 'p2', title: 'Beta', slug: 'beta', content: 'two', embedding: null },
    ];
    const first = buildPrisma();
    const second = buildPrisma();
    first.page.findMany.mockResolvedValue(pages);
    second.page.findMany.mockResolvedValue([...pages].reverse());

    await new GraphRefreshService(first, extraction, buildLlm() as any).refresh('space-1');
    await new GraphRefreshService(second, extraction, buildLlm() as any).refresh('space-1');

    const firstHash = first.spaceGraphState.upsert.mock.calls.at(-1)[0].update.lastContentHash;
    const secondHash = second.spaceGraphState.upsert.mock.calls.at(-1)[0].update.lastContentHash;
    expect(firstHash).toEqual(expect.any(String));
    expect(firstHash).toBe(secondHash);
  });

  it('changes the graph snapshot hash when the page version changes', async () => {
    const original = buildPrisma();
    const modified = buildPrisma();
    original.page.findMany.mockResolvedValue([
      { id: 'p1', title: 'Alpha', slug: 'alpha', content: 'same', embedding: [1, 0], updatedAt: new Date('2026-08-18T00:00:00.000Z') },
    ]);
    modified.page.findMany.mockResolvedValue([
      { id: 'p1', title: 'Alpha', slug: 'alpha', content: 'same', embedding: [1, 0], updatedAt: new Date('2026-08-18T00:01:00.000Z') },
    ]);

    await new GraphRefreshService(original, extraction, buildLlm() as any).refresh('space-1');
    await new GraphRefreshService(modified, extraction, buildLlm() as any).refresh('space-1');

    const originalHash = original.spaceGraphState.upsert.mock.calls.at(-1)[0].update.lastContentHash;
    const modifiedHash = modified.spaceGraphState.upsert.mock.calls.at(-1)[0].update.lastContentHash;
    expect(modifiedHash).not.toBe(originalHash);
  });

  it('does not persist a hash from a stale page snapshot', async () => {
    const prisma = buildPrisma();
    prisma.page.findMany
      .mockResolvedValueOnce([
        { id: 'p1', title: 'Alpha', slug: 'alpha', content: 'old', embedding: null, updatedAt: new Date('2026-08-18T00:00:00.000Z') },
        { id: 'p2', title: 'Beta', slug: 'beta', content: 'two', embedding: null, updatedAt: new Date('2026-08-18T00:00:00.000Z') },
      ])
      .mockResolvedValueOnce([
        { id: 'p1', updatedAt: new Date('2026-08-18T00:01:00.000Z') },
        { id: 'p2', updatedAt: new Date('2026-08-18T00:00:00.000Z') },
      ]);
    const service = new GraphRefreshService(prisma, extraction, buildLlm() as any);

    await service.refresh('space-1');

    const finalUpsert = prisma.spaceGraphState.upsert.mock.calls.at(-1)[0];
    expect(finalUpsert.update).not.toHaveProperty('lastContentHash');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('does not persist a hash when a graph input changes without a content change', async () => {
    const prisma = buildPrisma();
    prisma.page.findMany
      .mockResolvedValueOnce([
        { id: 'p1', title: 'Alpha', slug: 'alpha', content: 'same', embedding: [1, 0], updatedAt: new Date('2026-08-18T00:00:00.000Z') },
        { id: 'p2', title: 'Beta', slug: 'beta', content: 'two', embedding: null, updatedAt: new Date('2026-08-18T00:00:00.000Z') },
      ])
      .mockResolvedValueOnce([
        { id: 'p1', updatedAt: new Date('2026-08-18T00:01:00.000Z') },
        { id: 'p2', updatedAt: new Date('2026-08-18T00:00:00.000Z') },
      ]);
    const service = new GraphRefreshService(prisma, extraction, buildLlm() as any);

    await service.refresh('space-1');

    const finalUpsert = prisma.spaceGraphState.upsert.mock.calls.at(-1)[0];
    expect(finalUpsert.update).not.toHaveProperty('lastContentHash');
  });

  it('blocks llm proposals while a previous proposal change set is pending', async () => {
    const prisma = buildPrisma();
    prisma.spaceGraphState.findUnique.mockResolvedValue({
      wikilinkEnabled: false, similarEnabled: false, similarThreshold: 0.86, llmEnabled: true,
    });
    prisma.changeSet.findFirst.mockResolvedValue({ id: 'cs-pending' });
    const service = new GraphRefreshService(prisma, extraction, buildLlm() as any);
    const result = await service.refresh('space-1', ['llm']);
    expect(result.llm).toMatchObject({ changeSetId: null, reason: 'proposal_pending' });
  });

  it('rejects refresh for a missing space', async () => {
    const prisma = buildPrisma();
    prisma.space.findUnique.mockResolvedValue(null);
    const service = new GraphRefreshService(prisma, extraction, buildLlm() as any);
    await expect(service.refresh('missing')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('invalidates the sweep hash when graph settings change', async () => {
    const prisma = buildPrisma();
    const service = new GraphRefreshService(prisma, extraction, buildLlm() as any);

    await service.updateSettings('space-1', {
      wikilinkEnabled: true,
      similarEnabled: true,
      similarThreshold: 0.9,
      llmEnabled: false,
    });

    expect(prisma.spaceGraphState.upsert).toHaveBeenCalledWith({
      where: { spaceId: 'space-1' },
      create: {
        spaceId: 'space-1',
        wikilinkEnabled: true,
        similarEnabled: true,
        similarThreshold: 0.9,
        llmEnabled: false,
      },
      update: {
        wikilinkEnabled: true,
        similarEnabled: true,
        similarThreshold: 0.9,
        llmEnabled: false,
        lastContentHash: null,
      },
    });
  });
});
