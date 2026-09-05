import {
  canonicalBytes,
  canonicalTreeRevisionManifestV3,
  contentHash,
  revisionContentHash,
  treeRevisionContentHashV3,
  treeRevisionDeltaV3,
} from '@neomei/agentwiki-sync-protocol';
import { SyncRevisionService } from './sync-revision.service';
import { SyncV3ImmutableRevisionService } from './sync-v3-immutable-revision.service';

const at = (value: string) => new Date(value);

async function nativeV3Fixture() {
  const imageBody = '# Page\n\n![pic](../assets/pic.png)\n';
  const detachedBody = '# Page\n';
  const imageBodyHash = await contentHash(imageBody);
  const detachedBodyHash = await contentHash(detachedBody);
  const imageManifest = canonicalTreeRevisionManifestV3({
    protocolVersion: '3', spaceId: 'space-1', folders: [],
    pages: [{
      pageId: 'page-1', folderId: null, path: 'pages/page.md', title: 'Page',
      body: imageBody, contentHash: imageBodyHash, updatedAt: '2026-09-04T00:00:00.000Z',
      referencedAttachmentIds: ['attachment-1'],
    }],
    attachments: [{
      attachmentId: 'attachment-1', path: 'assets/pic.png', mimeType: 'image/png',
      sizeBytes: '4', width: 1, height: 1, contentHash: 'b'.repeat(64),
      updatedAt: '2026-09-04T00:00:00.000Z',
    }],
  });
  const detachedManifest = canonicalTreeRevisionManifestV3({
    protocolVersion: '3', spaceId: 'space-1', folders: [],
    pages: [{
      pageId: 'page-1', folderId: null, path: 'pages/page.md', title: 'Page',
      body: detachedBody, contentHash: detachedBodyHash, updatedAt: '2026-09-05T00:00:00.000Z',
      referencedAttachmentIds: [],
    }],
    attachments: [],
  });
  const revisions = new Map<string, any>([
    ['rev-1', {
      id: 'rev-1', spaceId: 'space-1', sequence: 1, parentRevisionId: null,
      schemaVersion: 'content-tree@2', recipeVersion: 'space-folders-v1',
      attachmentCount: 0n, createdAt: at('2026-09-03T00:00:00.000Z'),
    }],
    ['rev-2', {
      id: 'rev-2', spaceId: 'space-1', sequence: 2, parentRevisionId: 'rev-1',
      schemaVersion: 'content-tree@3', recipeVersion: 'referenced-images-v1',
      attachmentCount: 1n, createdAt: at('2026-09-04T00:00:00.000Z'),
    }],
    ['rev-3', {
      id: 'rev-3', spaceId: 'space-1', sequence: 3, parentRevisionId: 'rev-2',
      schemaVersion: 'content-tree@3', recipeVersion: 'referenced-images-v1',
      attachmentCount: 0n, createdAt: at('2026-09-05T00:00:00.000Z'),
    }],
  ]);
  const manifests = new Map([['rev-2', imageManifest], ['rev-3', detachedManifest]]);
  for (const revisionId of ['rev-2', 'rev-3']) {
    const revision = revisions.get(revisionId)!;
    const manifest = manifests.get(revisionId)!;
    const hash = await treeRevisionContentHashV3(manifest);
    revision.contentHash = hash;
    revision.revisionContentHash = hash;
    revision.pageCount = BigInt(manifest.pages.length);
    revision.revisionManifestByteLength = BigInt(canonicalBytes(manifest).byteLength);
    revision.revisionBodyBytes = BigInt(manifest.pages.reduce(
      (total, page) => total + Buffer.byteLength(page.body, 'utf8'), 0,
    ));
    revision.revisionAttachmentBytes = BigInt(manifest.attachments.reduce(
      (total, attachment) => total + Number(attachment.sizeBytes), 0,
    ));
  }
  revisions.get('rev-2')!.delta = treeRevisionDeltaV3(null, imageManifest);
  revisions.get('rev-3')!.delta = treeRevisionDeltaV3(imageManifest, detachedManifest);

  const pagesByRevision = new Map<string, any[]>([
    ['rev-2', [{
      revisionId: 'rev-2', pageId: 'page-1', folderId: null, path: 'pages/page.md',
      pathKey: 'pages/page.md', title: 'Page', contentHash: imageBodyHash,
      updatedAt: at('2026-09-04T00:00:00.000Z'),
      content: { contentHash: imageBodyHash, body: imageBody, byteLength: Buffer.byteLength(imageBody, 'utf8') },
    }]],
    ['rev-3', [{
      revisionId: 'rev-3', pageId: 'page-1', folderId: null, path: 'pages/page.md',
      pathKey: 'pages/page.md', title: 'Page', contentHash: detachedBodyHash,
      updatedAt: at('2026-09-05T00:00:00.000Z'),
      content: { contentHash: detachedBodyHash, body: detachedBody, byteLength: Buffer.byteLength(detachedBody, 'utf8') },
    }]],
  ]);
  const attachmentRows = new Map<string, any[]>([
    ['rev-2', [{
      revisionId: 'rev-2', attachmentId: 'attachment-1', attachmentVersionId: 'version-1',
      spaceId: 'space-1', path: 'assets/pic.png', pathKey: 'assets/pic.png', ordinal: 0,
      attachment: { id: 'attachment-1', spaceId: 'space-1' },
      attachmentVersion: {
        id: 'version-1', attachmentId: 'attachment-1', contentHash: 'b'.repeat(64),
        storageKey: `sha256/bb/bb/${'b'.repeat(64)}`, mimeType: 'image/png',
        sizeBytes: 4n, width: 1, height: 1,
        attachment: { id: 'attachment-1', spaceId: 'space-1' },
      },
    }]],
    ['rev-3', []],
  ]);
  const sidecars = new Map<string, any>();
  for (const revisionId of ['rev-2', 'rev-3']) {
    const revision = revisions.get(revisionId)!;
    const manifest = manifests.get(revisionId)!;
    sidecars.set(revisionId, { sidecar: { syncV3Revision: {
      protocolVersion: '3', manifestSchema: 'TreeRevisionContentManifestV3',
      revisionContentHash: revision.revisionContentHash,
      folderCount: String(manifest.folders.length), pageCount: String(manifest.pages.length),
      attachmentCount: String(manifest.attachments.length),
      revisionManifestByteLength: String(revision.revisionManifestByteLength),
      revisionBodyBytes: String(revision.revisionBodyBytes),
      revisionAttachmentBytes: String(revision.revisionAttachmentBytes),
      treeDeltaCount: String(revision.delta.length),
      pageAttachmentIds: manifest.pages.map((page) => ({
        pageId: page.pageId, referencedAttachmentIds: page.referencedAttachmentIds,
      })),
      attachmentUpdatedAt: manifest.attachments.map((attachment) => ({
        attachmentId: attachment.attachmentId, updatedAt: attachment.updatedAt,
      })),
    } } });
  }
  const tx: any = {
    spaceKnowledgeRevision: {
      findFirst: jest.fn(async () => revisions.get('rev-3')),
      findUnique: jest.fn(async ({ where }: any) => revisions.get(where.id) ?? null),
    },
    syncRevisionFolderRow: { findMany: jest.fn().mockResolvedValue([]) },
    syncRevisionPageRow: { findMany: jest.fn(async ({ where }: any) => {
      const rows = pagesByRevision.get(where.revisionId) ?? [];
      const filtered = where.pageId?.gt ? rows.filter((row) => row.pageId > where.pageId.gt) : rows;
      return where.take ? filtered.slice(0, where.take) : filtered;
    }) },
    syncRevisionAttachmentRow: { findMany: jest.fn(async ({ where }: any) => attachmentRows.get(where.revisionId) ?? []) },
    legacyRevisionSidecar: { findUnique: jest.fn(async ({ where }: any) => sidecars.get(where.revisionId) ?? null) },
  };
  const prisma: any = {
    ...tx,
    $transaction: jest.fn(async (callback: (client: any) => unknown) => callback(tx)),
  };
  const service = new SyncRevisionService(prisma, new SyncV3ImmutableRevisionService());
  return { service, prisma, revisions, manifests, pagesByRevision, attachmentRows, sidecars };
}

async function replaceV3Revision(
  state: Awaited<ReturnType<typeof nativeV3Fixture>>,
  revisionId: string,
  manifest: ReturnType<typeof canonicalTreeRevisionManifestV3>,
  parentManifest: ReturnType<typeof canonicalTreeRevisionManifestV3> | null,
) {
  const revision = state.revisions.get(revisionId);
  const hash = await treeRevisionContentHashV3(manifest);
  revision.contentHash = hash;
  revision.revisionContentHash = hash;
  revision.pageCount = BigInt(manifest.pages.length);
  revision.attachmentCount = BigInt(manifest.attachments.length);
  revision.revisionManifestByteLength = BigInt(canonicalBytes(manifest).byteLength);
  revision.revisionBodyBytes = BigInt(manifest.pages.reduce(
    (total, page) => total + Buffer.byteLength(page.body, 'utf8'), 0,
  ));
  revision.revisionAttachmentBytes = BigInt(manifest.attachments.reduce(
    (total, attachment) => total + Number(attachment.sizeBytes), 0,
  ));
  revision.delta = treeRevisionDeltaV3(parentManifest, manifest);
  state.manifests.set(revisionId, manifest);
  state.sidecars.set(revisionId, { sidecar: { syncV3Revision: {
    protocolVersion: '3', manifestSchema: 'TreeRevisionContentManifestV3',
    revisionContentHash: hash, folderCount: String(manifest.folders.length),
    pageCount: String(manifest.pages.length), attachmentCount: String(manifest.attachments.length),
    revisionManifestByteLength: String(revision.revisionManifestByteLength),
    revisionBodyBytes: String(revision.revisionBodyBytes),
    revisionAttachmentBytes: String(revision.revisionAttachmentBytes),
    treeDeltaCount: String(revision.delta.length),
    pageAttachmentIds: manifest.pages.map((page) => ({
      pageId: page.pageId, referencedAttachmentIds: page.referencedAttachmentIds,
    })),
    attachmentUpdatedAt: manifest.attachments.map((attachment) => ({
      attachmentId: attachment.attachmentId, updatedAt: attachment.updatedAt,
    })),
  } } });
}

describe('SyncRevisionService legacy projection validation', () => {
  it('synthesizes the exact v1 head hash and manifest bytes for a folder-free v2 revision', async () => {
    const revision = {
      id: 'rev-v2', spaceId: 'space-1', sequence: 3, schemaVersion: 'content-tree@2',
      recipeVersion: 'space-folders-v1', attachmentCount: 0n,
      revisionContentHash: 'f'.repeat(64), pageCount: 1n,
      revisionManifestByteLength: 999n, revisionBodyBytes: 7n,
      createdAt: at('2026-08-29T00:00:00.000Z'),
    };
    const rows = [{ pageId: 'page-1', path: 'pages/Page.md', title: 'Page', contentHash: 'a'.repeat(64) }];
    const tx: any = {
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue(revision) },
      syncRevisionPageRow: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const prisma: any = { ...tx, $transaction: jest.fn((callback: (client: any) => unknown) => callback(tx)) };
    const service = new SyncRevisionService(prisma, new SyncV3ImmutableRevisionService());
    const manifest = { protocolVersion: '1' as const, spaceId: 'space-1', pages: rows };

    await expect(service.head('space-1')).resolves.toEqual(expect.objectContaining({
      revision: 'rev-v2', revisionContentHash: await revisionContentHash(manifest),
      revisionManifestByteLength: BigInt(canonicalBytes(manifest).byteLength),
      revisionBodyBytes: 7n, pageCount: 1n,
    }));
  });

  it('keeps the v1 hash domain for a valid attachment-free native v3 head', async () => {
    const state = await nativeV3Fixture();
    const head = await state.service.head('space-1');
    const rows = state.pagesByRevision.get('rev-3')!.map(({ pageId, path, title, contentHash }) => ({
      pageId, path, title, contentHash,
    }));

    expect(head.revisionContentHash).not.toBe(state.revisions.get('rev-3').revisionContentHash);
    expect(head.revisionContentHash).toBe(await revisionContentHash({
      protocolVersion: '1', spaceId: 'space-1', pages: rows,
    }));
    expect(state.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead', maxWait: 10_000, timeout: 30_000,
    });
  });

  it.each([
    ['sidecar', (state: Awaited<ReturnType<typeof nativeV3Fixture>>) => {
      state.sidecars.get('rev-3').sidecar.syncV3Revision.unexpected = true;
    }],
    ['stored canonical delta', (state: Awaited<ReturnType<typeof nativeV3Fixture>>) => {
      state.revisions.get('rev-3').delta = [];
    }],
    ['revision hash metadata', (state: Awaited<ReturnType<typeof nativeV3Fixture>>) => {
      state.revisions.get('rev-3').revisionContentHash = 'f'.repeat(64);
    }],
    ['Page attachment evidence', (state: Awaited<ReturnType<typeof nativeV3Fixture>>) => {
      state.sidecars.get('rev-3').sidecar.syncV3Revision.pageAttachmentIds = [];
    }],
    ['Page content', (state: Awaited<ReturnType<typeof nativeV3Fixture>>) => {
      state.pagesByRevision.get('rev-3')![0].content.body = '# Corrupt\n';
    }],
    ['Page content hash', (state: Awaited<ReturnType<typeof nativeV3Fixture>>) => {
      state.pagesByRevision.get('rev-3')![0].contentHash = 'f'.repeat(64);
    }],
  ])('fails closed with REVISION_GONE when an attachment-free v3 head has corrupt %s', async (_label, mutate) => {
    const state = await nativeV3Fixture();
    mutate(state);

    await expect(state.service.head('space-1')).rejects.toMatchObject({
      syncCode: 'REVISION_GONE', retryable: false,
    });
  });

  it('verifies a fixed native v3 snapshot in the same transaction that reads its rows', async () => {
    const state = await nativeV3Fixture();
    state.sidecars.get('rev-3').sidecar.syncV3Revision.pageAttachmentIds = [];

    await expect(state.service.snapshotPage('space-1', 'rev-3', 100))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE', retryable: false });
    expect(state.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects an attachment-bearing v3 Delta source even when the current target is detached', async () => {
    const state = await nativeV3Fixture();

    await expect(state.service.deltaPage('space-1', 'rev-2', 100))
      .rejects.toMatchObject({ syncCode: 'SYNC_PROTOCOL_UPGRADE_REQUIRED' });
  });

  it('fails closed when a native v3 Delta source has corrupt authority', async () => {
    const state = await nativeV3Fixture();
    const sourceRow = state.pagesByRevision.get('rev-2')![0];
    const sourceManifest = canonicalTreeRevisionManifestV3({
      protocolVersion: '3', spaceId: 'space-1', folders: [],
      pages: [{
        pageId: sourceRow.pageId, folderId: null, path: sourceRow.path, title: sourceRow.title,
        body: sourceRow.content.body, contentHash: sourceRow.contentHash,
        updatedAt: sourceRow.updatedAt.toISOString(), referencedAttachmentIds: [],
      }],
      attachments: [],
    });
    state.attachmentRows.set('rev-2', []);
    await replaceV3Revision(state, 'rev-2', sourceManifest, null);
    await replaceV3Revision(state, 'rev-3', state.manifests.get('rev-3')!, sourceManifest);
    state.revisions.get('rev-2').delta = [];

    await expect(state.service.deltaPage('space-1', 'rev-2', 100))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE', retryable: false });
  });

  it('validates native v3 endpoints before equal and empty Delta shortcuts and preserves pagination', async () => {
    const equal = await nativeV3Fixture();
    equal.sidecars.get('rev-3').sidecar.syncV3Revision.unexpected = true;
    await expect(equal.service.deltaPage('space-1', 'rev-3', 1))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });

    const empty = await nativeV3Fixture();
    empty.revisions.get('rev-3').delta = [];
    await expect(empty.service.deltaPage('space-1', '0', 1))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });

    const valid = await nativeV3Fixture();
    const secondBody = '# Second\n';
    const secondHash = await contentHash(secondBody);
    valid.pagesByRevision.get('rev-3')!.push({
      revisionId: 'rev-3', pageId: 'page-2', folderId: null, path: 'pages/second.md',
      pathKey: 'pages/second.md', title: 'Second', contentHash: secondHash,
      updatedAt: at('2026-09-05T00:00:01.000Z'),
      content: { contentHash: secondHash, body: secondBody, byteLength: Buffer.byteLength(secondBody, 'utf8') },
    });
    const currentManifest = canonicalTreeRevisionManifestV3({
      ...valid.manifests.get('rev-3')!,
      pages: [...valid.manifests.get('rev-3')!.pages, {
        pageId: 'page-2', folderId: null, path: 'pages/second.md', title: 'Second',
        body: secondBody, contentHash: secondHash, updatedAt: '2026-09-05T00:00:01.000Z',
        referencedAttachmentIds: [],
      }],
    });
    await replaceV3Revision(valid, 'rev-3', currentManifest, valid.manifests.get('rev-2')!);
    const first = await valid.service.deltaPage('space-1', '0', 1);
    expect(first.items.map((item) => item.pageId)).toEqual(['page-1']);
    expect(first.nextPageId).toBe('page-1');
    const second = await valid.service.deltaPage('space-1', '0', 1, first.nextPageId);
    expect(second.items.map((item) => item.pageId)).toEqual(['page-2']);
    expect(second.nextPageId).toBeUndefined();
  });
});
