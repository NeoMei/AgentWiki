import { canonicalBytes, revisionContentHash } from '@neomei/agentwiki-sync-protocol';
import { SyncRevisionService } from './sync-revision.service';

describe('SyncRevisionService v1 compatibility over folder-free v2 history', () => {
  it('synthesizes the exact v1 head hash and manifest bytes when the current v2 revision is folder-free', async () => {
    const revision = {
      id: 'rev-v2', spaceId: 'space-1', sequence: 3, schemaVersion: 'content-tree@2',
      recipeVersion: 'space-folders-v1',
      revisionContentHash: 'f'.repeat(64), pageCount: 1n,
      revisionManifestByteLength: 999n, revisionBodyBytes: 7n,
      createdAt: new Date('2026-08-29T00:00:00.000Z'),
    };
    const rows = [{
      pageId: 'page-1', folderId: null, path: 'pages/Page.md', title: 'Page',
      contentHash: 'a'.repeat(64),
    }];
    const prisma: any = {
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue(revision) },
      syncRevisionPageRow: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const service = new SyncRevisionService(prisma);
    const manifest = {
      protocolVersion: '1' as const, spaceId: 'space-1',
      pages: rows.map(({ pageId, path, title, contentHash }) => ({ pageId, path, title, contentHash })),
    };

    await expect(service.head('space-1')).resolves.toEqual(expect.objectContaining({
      revision: 'rev-v2', revisionContentHash: await revisionContentHash(manifest),
      revisionManifestByteLength: BigInt(canonicalBytes(manifest).byteLength),
      revisionBodyBytes: 7n, pageCount: 1n,
    }));
  });

  it('recomputes an attachment-free v1 projection hash for a native v3 revision', async () => {
    const revision = {
      id: 'rev-v3', spaceId: 'space-1', sequence: 4, schemaVersion: 'content-tree@3',
      recipeVersion: 'referenced-images-v1', revisionContentHash: 'f'.repeat(64),
      contentHash: 'f'.repeat(64), pageCount: 1n, attachmentCount: 0n,
      revisionManifestByteLength: 999n, revisionBodyBytes: 7n,
      createdAt: new Date('2026-09-04T00:00:00.000Z'),
    };
    const rows = [{ pageId: 'page-1', path: 'pages/Page.md', title: 'Page', contentHash: 'a'.repeat(64) }];
    const service = new SyncRevisionService({
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue(revision) },
      syncRevisionPageRow: { findMany: jest.fn().mockResolvedValue(rows) },
    } as any);

    const head = await service.head('space-1');

    expect(head.revisionContentHash).not.toBe(revision.revisionContentHash);
    expect(head.revisionContentHash).toBe(await revisionContentHash({
      protocolVersion: '1', spaceId: 'space-1', pages: rows,
    }));
  });

  it('blocks v1 reads when the fixed native v3 target contains attachments', async () => {
    const revision = {
      id: 'rev-v3', spaceId: 'space-1', sequence: 4, schemaVersion: 'content-tree@3',
      recipeVersion: 'referenced-images-v1', attachmentCount: 1n,
      createdAt: new Date('2026-09-04T00:00:00.000Z'),
    };
    const service = new SyncRevisionService({
      spaceKnowledgeRevision: {
        findFirst: jest.fn().mockResolvedValue(revision),
        findUnique: jest.fn().mockResolvedValue(revision),
      },
      syncRevisionPageRow: { findMany: jest.fn() },
    } as any);

    await expect(service.head('space-1'))
      .rejects.toMatchObject({ syncCode: 'SYNC_PROTOCOL_UPGRADE_REQUIRED' });
    await expect(service.snapshotPage('space-1', 'rev-v3', 100))
      .rejects.toMatchObject({ syncCode: 'SYNC_PROTOCOL_UPGRADE_REQUIRED' });
    await expect(service.deltaPage('space-1', '0', 100))
      .rejects.toMatchObject({ syncCode: 'SYNC_PROTOCOL_UPGRADE_REQUIRED' });
  });

  it('fails closed instead of returning a future authority hash through v1', async () => {
    const revision = {
      id: 'rev-future', spaceId: 'space-1', sequence: 5, schemaVersion: 'content-tree@4',
      recipeVersion: 'future-recipe', attachmentCount: 0n,
      createdAt: new Date('2026-09-04T00:00:00.000Z'),
    };
    const service = new SyncRevisionService({
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue(revision) },
    } as any);

    await expect(service.head('space-1'))
      .rejects.toMatchObject({ syncCode: 'SYNC_PROTOCOL_UPGRADE_REQUIRED' });
  });
});
