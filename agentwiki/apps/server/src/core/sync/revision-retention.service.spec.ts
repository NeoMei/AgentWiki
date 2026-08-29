import { RevisionRetentionService } from './revision-retention.service';

describe('RevisionRetentionService', () => {
  it('retries content GC in an independent transaction even when no revision is pruned', async () => {
    const retentionTx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      spaceKnowledgeRevision: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const gcTx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    const prisma = {
      $transaction: jest.fn()
        .mockImplementationOnce(async (callback: (tx: typeof retentionTx) => unknown) => callback(retentionTx))
        .mockImplementationOnce(async (callback: (tx: typeof gcTx) => unknown) => callback(gcTx)),
    } as any;

    await expect(new RevisionRetentionService(prisma).cleanSpace('space-1')).resolves.toBe(0);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(gcTx.$executeRaw).toHaveBeenCalledTimes(2);
    const gcSql = gcTx.$executeRaw.mock.calls
      .map(([query]) => Array.isArray(query) ? query.join('?') : String(query))
      .join('\n');
    expect(gcSql).toContain('PushSessionChange');
    expect(gcSql).toContain('s."contentHash" = c."contentHash"');
    expect(gcSql).not.toContain('s."operation"');
  });
});
