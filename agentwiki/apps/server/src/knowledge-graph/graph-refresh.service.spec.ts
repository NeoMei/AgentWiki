import { ForbiddenException } from '@nestjs/common';
import { GraphRefreshService } from './graph-refresh.service';
import { GraphExtractionService } from './graph-extraction.service';

describe('GraphRefreshService', () => {
  const extraction = new GraphExtractionService();
  const now = new Date('2026-08-17T00:00:00.000Z');

  const buildPrisma = (overrides: Record<string, any> = {}) => {
    const prisma = {
      space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1' }) },
      spaceGraphState: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(async (args: any) => ({
          wikilinkEnabled: true,
          similarEnabled: false,
          similarThreshold: 0.86,
          llmEnabled: false,
          ...(args.create ?? args.update ?? {}),
        })),
      },
      page: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', title: 'Alpha', slug: 'alpha', content: 'See [[Beta]].', embedding: null },
          { id: 'p2', title: 'Beta', slug: 'beta', content: 'Back to [[Alpha]].', embedding: null },
        ]),
      },
      knowledgeRelation: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      changeSet: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(prisma)),
      ...overrides,
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

  it('skips similar layer when disabled and honors canonical pairs when enabled', async () => {
    const prisma = buildPrisma();
    prisma.spaceGraphState.findUnique.mockResolvedValue({
      wikilinkEnabled: true, similarEnabled: true, similarThreshold: 0.9, llmEnabled: false,
    });
    prisma.page.findMany.mockResolvedValue([
      { id: 'p1', title: 'A', slug: 'a', content: '', embedding: [1, 0] },
      { id: 'p2', title: 'B', slug: 'b', content: '', embedding: [0.99, 0.141] },
      { id: 'p3', title: 'C', slug: 'c', content: '', embedding: null },
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
    const result = await service.refresh('space-1', ['llm']);
    expect(result.llm).toEqual({ changeSetId: 'cs-1', proposed: 1 });
    expect(prisma.changeSet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ spaceId: 'space-1', status: 'pending_review' }),
    });
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
});
