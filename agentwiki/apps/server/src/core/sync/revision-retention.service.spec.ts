import {
  isAttachmentBlobReferenced,
  RevisionRetentionService,
} from './revision-retention.service';

describe('RevisionRetentionService', () => {
  it('fails closed when the reference query does not return one boolean decision', async () => {
    await expect(isAttachmentBlobReferenced(
      { $queryRaw: jest.fn().mockResolvedValue([]) } as any,
      `sha256/aa/aa/${'a'.repeat(64)}`,
      new Date('2026-09-05T00:00:00.000Z'),
      24 * 60 * 60 * 1000,
    )).rejects.toThrow('ATTACHMENT_BLOB_REFERENCE_QUERY_INVALID');
  });

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

  it('expires v3 Revision evidence without archiving its live SpaceAttachment', async () => {
    const old = new Date('2026-06-01T00:00:00.000Z');
    jest.useFakeTimers({ now: new Date('2026-09-05T00:00:00.000Z') });
    const deletion = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
    const retentionTx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      spaceKnowledgeRevision: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'revision-old', spaceId: 'space-1', sequence: 1, parentRevisionId: null,
            schemaVersion: 'content-tree@3', recipeVersion: 'referenced-images-v1',
            contentHash: 'a'.repeat(64), revisionContentHash: 'b'.repeat(64),
            pageCount: 0n, revisionBodyBytes: 0n, revisionManifestByteLength: 0n,
            migrationBatchId: null, createdAt: old, supersededAt: old,
          },
          {
            id: 'revision-current', spaceId: 'space-1', sequence: 2,
            parentRevisionId: 'revision-old', schemaVersion: 'content-tree@3',
            recipeVersion: 'referenced-images-v1', contentHash: 'c'.repeat(64),
            revisionContentHash: 'd'.repeat(64), pageCount: 0n,
            revisionBodyBytes: 0n, revisionManifestByteLength: 0n,
            migrationBatchId: null, createdAt: old, supersededAt: null,
          },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      spaceRevisionChainCheckpoint: { findUnique: jest.fn().mockResolvedValue(null) },
      syncRevisionFolderRow: { findMany: jest.fn().mockResolvedValue([]), ...deletion },
      syncRevisionPageRow: { findMany: jest.fn().mockResolvedValue([]), ...deletion },
      syncRevisionTreeDeltaRow: { findMany: jest.fn().mockResolvedValue([]), ...deletion },
      syncRevisionDeltaRow: { ...deletion },
      legacyRevisionPageExtra: { ...deletion },
      legacyRevisionSidecar: { findMany: jest.fn().mockResolvedValue([]), ...deletion },
      syncRevisionAttachmentRow: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      spaceAttachment: {
        updateMany: jest.fn(), deleteMany: jest.fn(),
      },
    } as any;
    const gcTx = { $executeRaw: jest.fn().mockResolvedValue(0) };
    const prisma = {
      $transaction: jest.fn()
        .mockImplementationOnce(async (callback: (tx: typeof retentionTx) => unknown) => callback(retentionTx))
        .mockImplementationOnce(async (callback: (tx: typeof gcTx) => unknown) => callback(gcTx)),
    } as any;

    try {
      await expect(new RevisionRetentionService(prisma).cleanSpace('space-1')).resolves.toBe(1);
    } finally {
      jest.useRealTimers();
    }

    expect(retentionTx.syncRevisionAttachmentRow.deleteMany).toHaveBeenCalledWith({
      where: { revisionId: { in: ['revision-old'] } },
    });
    expect(retentionTx.spaceAttachment.updateMany).not.toHaveBeenCalled();
    expect(retentionTx.spaceAttachment.deleteMany).not.toHaveBeenCalled();
  });
});
