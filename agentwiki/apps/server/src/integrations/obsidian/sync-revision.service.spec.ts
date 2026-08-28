import { canonicalBytes, revisionContentHash } from '@neomei/agentwiki-sync-protocol';
import { SyncRevisionService } from './sync-revision.service';

describe('SyncRevisionService v1 compatibility over folder-free v2 history', () => {
  it('synthesizes the exact v1 head hash and manifest bytes when the current v2 revision is folder-free', async () => {
    const revision = {
      id: 'rev-v2', spaceId: 'space-1', sequence: 3, schemaVersion: 'content-tree@2',
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
});
