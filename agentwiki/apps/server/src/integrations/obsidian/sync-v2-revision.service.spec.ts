import {
  canonicalBytes,
  canonicalTreeRevisionManifestV2,
  contentHash,
  treeRevisionContentHashV2,
} from '@neomei/agentwiki-sync-protocol';
import { SyncV2RevisionService } from './sync-v2-revision.service';

const at = (value: string) => new Date(value);
const root = {
  revisionId: 'rev-2', folderId: 'root', parentFolderId: null, name: 'Root',
  path: 'pages/Root', pathKey: 'pages/root', sortOrder: 0,
  updatedAt: at('2026-08-29T00:00:00.000Z'),
};
const child = {
  revisionId: 'rev-2', folderId: 'child', parentFolderId: 'root', name: 'Child',
  path: 'pages/Root/Child', pathKey: 'pages/root/child', sortOrder: 0,
  updatedAt: at('2026-08-29T00:00:01.000Z'),
};
const page = {
  revisionId: 'rev-2', pageId: 'page-1', folderId: 'child',
  path: 'pages/Root/Child/Page.md', pathKey: 'pages/root/child/page.md', title: 'Page',
  contentHash: '', updatedAt: at('2026-08-29T00:00:02.000Z'),
  content: { body: '# Page\n', byteLength: 7 },
};

function cursorCodec() {
  return {
    encode: jest.fn((payload: object) => Buffer.from(JSON.stringify(payload)).toString('base64url')),
    decode: jest.fn((value: string) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))),
  };
}

async function fixture(maxResponseBytes = 4 * 1024 * 1024) {
  const bodyHash = await contentHash('# Page\n');
  const hydratedPage = { ...page, contentHash: bodyHash };
  const revisions = new Map<string, any>([
    ['rev-1', {
      id: 'rev-1', spaceId: 'space-1', sequence: 1, schemaVersion: 'content-tree@2',
      createdAt: at('2026-08-28T00:00:00.000Z'),
    }],
    ['rev-2', {
      id: 'rev-2', spaceId: 'space-1', sequence: 2, schemaVersion: 'content-tree@2',
      createdAt: at('2026-08-29T00:00:00.000Z'),
    }],
  ]);
  const foldersByRevision = new Map<string, any[]>([
    ['rev-1', [{ ...root, revisionId: 'rev-1' }, {
      ...child, revisionId: 'rev-1', path: 'pages/Root/Old', pathKey: 'pages/root/old',
      updatedAt: at('2026-08-28T00:00:01.000Z'),
    }]],
    ['rev-2', [{ ...child }, { ...root }]],
  ]);
  const pagesByRevision = new Map<string, any[]>([
    ['rev-1', [{
      ...hydratedPage, content: { ...hydratedPage.content }, revisionId: 'rev-1', folderId: 'root', path: 'pages/Root/Old.md',
      pathKey: 'pages/root/old.md', updatedAt: at('2026-08-28T00:00:02.000Z'),
    }, {
      ...hydratedPage, content: { ...hydratedPage.content }, revisionId: 'rev-1', pageId: 'archived', path: 'pages/Root/Archived.md',
      pathKey: 'pages/root/archived.md', updatedAt: at('2026-08-28T00:00:03.000Z'),
    }]],
    ['rev-2', [{ ...hydratedPage, content: { ...hydratedPage.content } }]],
  ]);
  const manifests = new Map<string, any>();
  for (const revisionId of ['rev-1', 'rev-2']) {
    manifests.set(revisionId, canonicalTreeRevisionManifestV2({
      protocolVersion: '2', spaceId: 'space-1',
      folders: foldersByRevision.get(revisionId)!.map((folder) => ({
        folderId: folder.folderId, parentFolderId: folder.parentFolderId,
        name: folder.name, path: folder.path, sortOrder: folder.sortOrder,
        updatedAt: folder.updatedAt.toISOString(),
      })),
      pages: pagesByRevision.get(revisionId)!.map((item) => ({
        pageId: item.pageId, folderId: item.folderId, path: item.path,
        title: item.title, body: item.content.body, contentHash: item.contentHash,
        updatedAt: item.updatedAt.toISOString(),
      })),
    }));
  }
  for (const [revisionId, revision] of revisions) {
    const manifest = manifests.get(revisionId)!;
    revision.revisionContentHash = await treeRevisionContentHashV2(manifest);
    revision.pageCount = BigInt(manifest.pages.length);
    revision.revisionManifestByteLength = BigInt(canonicalBytes(manifest).byteLength);
    revision.revisionBodyBytes = BigInt(manifest.pages.reduce(
      (sum: number, item: any) => sum + Buffer.byteLength(item.body, 'utf8'), 0,
    ));
  }
  const deltaRows = new Map<string, any[]>([
    ['rev-1', [
      { ordinal: 0, operation: 'upsert_folder', folderId: 'root', pageId: null, previousPath: null, contentHash: null },
      { ordinal: 1, operation: 'upsert_folder', folderId: 'child', pageId: null, previousPath: null, contentHash: null },
      { ordinal: 2, operation: 'upsert_page', folderId: null, pageId: 'archived', previousPath: null, contentHash: bodyHash },
      { ordinal: 3, operation: 'upsert_page', folderId: null, pageId: 'page-1', previousPath: null, contentHash: bodyHash },
    ]],
    ['rev-2', [
      { ordinal: 0, operation: 'archive_page', folderId: null, pageId: 'archived', previousPath: 'pages/Root/Archived.md', contentHash: null },
      { ordinal: 1, operation: 'upsert_folder', folderId: 'child', pageId: null, previousPath: null, contentHash: null },
      { ordinal: 2, operation: 'upsert_page', folderId: null, pageId: 'page-1', previousPath: null, contentHash: bodyHash },
    ]],
  ]);
  const deltaCounts = new Map([...deltaRows].map(([revisionId, rows]) => [revisionId, rows.length]));
  const sidecars = new Map([...revisions].map(([revisionId, revision]) => {
    const manifest = manifests.get(revisionId)!;
    return [revisionId, { sidecar: { spaceFolderMigration: { v2Revision: {
      protocolVersion: '2', manifestSchema: 'TreeRevisionContentManifestV2',
      folderCount: String(manifest.folders.length), pageCount: String(manifest.pages.length),
      revisionContentHash: revision.revisionContentHash,
      revisionManifestByteLength: String(revision.revisionManifestByteLength),
      revisionBodyBytes: String(revision.revisionBodyBytes),
      treeDeltaCount: String(deltaCounts.get(revisionId)),
    } } } }];
  }));
  const prisma = {
    spaceKnowledgeRevision: {
      findFirst: jest.fn(async () => revisions.get('rev-2')),
      findUnique: jest.fn(async ({ where }: any) => revisions.get(where.id) ?? null),
    },
    syncRevisionFolderRow: {
      findMany: jest.fn(async ({ where }: any) => foldersByRevision.get(where.revisionId) ?? []),
    },
    syncRevisionPageRow: {
      findMany: jest.fn(async ({ where }: any) => pagesByRevision.get(where.revisionId) ?? []),
    },
    legacyRevisionSidecar: {
      findUnique: jest.fn(async ({ where }: any) => sidecars.get(where.revisionId) ?? null),
    },
    syncRevisionTreeDeltaRow: {
      findMany: jest.fn(async ({ where }: any) => deltaRows.get(where.revisionId) ?? []),
    },
  } as any;
  const cursors = cursorCodec();
  const capabilities = { capabilitiesV2: jest.fn(() => ({ maxResponseBytes })) };
  return {
    service: new SyncV2RevisionService(prisma, cursors as any, capabilities as any),
    cursors, revisions, foldersByRevision, pagesByRevision, sidecars, deltaCounts, deltaRows,
  };
}

describe('SyncV2RevisionService', () => {
  it('serves the empty immutable v2 revision with the canonical empty hash', async () => {
    const { service } = await fixture();

    await expect(service.snapshot('space-1', '0', undefined, 100)).resolves.toEqual({
      protocolVersion: '2', spaceId: 'space-1', revision: '0', sequence: 0,
      revisionContentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      folderCount: '0', pageCount: '0', revisionManifestByteLength: '0',
      revisionBodyBytes: '0', folders: [], pages: [], nextCursor: null,
    });
  });

  it('paginates parent before child before Page and resumes without duplicates or omissions', async () => {
    const { service } = await fixture();
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await service.snapshot('space-1', 'rev-2', cursor, 1);
      seen.push(...response.folders.map((item) => `folder:${item.folderId}`));
      seen.push(...response.pages.map((item) => `page:${item.pageId}`));
      cursor = response.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toEqual(['folder:root', 'folder:child', 'page:page-1']);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('uses the actual JSON UTF-8 response boundary when the byte cap paginates', async () => {
    const { service } = await fixture(620);
    const response = await service.snapshot('space-1', 'rev-2', undefined, 100);

    expect(Buffer.byteLength(JSON.stringify(response), 'utf8')).toBeLessThanOrEqual(620);
    expect(response.nextCursor).not.toBeNull();
    expect(response.folders.length + response.pages.length).toBeGreaterThan(0);
  });

  it('returns Page folderId and metrics from the canonical v2 manifest', async () => {
    const { service } = await fixture();
    const response = await service.snapshot('space-1', 'rev-2', undefined, 100);
    const manifest = {
      protocolVersion: '2' as const, spaceId: 'space-1',
      folders: response.folders, pages: response.pages,
    };

    expect(response.pages).toEqual([expect.objectContaining({ pageId: 'page-1', folderId: 'child' })]);
    expect(response.folderCount).toBe('2');
    expect(response.pageCount).toBe('1');
    expect(response.revisionContentHash).toBe(await treeRevisionContentHashV2(manifest));
    expect(response.revisionManifestByteLength).toBe(String(canonicalBytes(manifest).byteLength));
  });

  it('orders delta as Page archives, deep Folder archives, parent-first Folder upserts, then Page upserts', async () => {
    const { service } = await fixture();
    const response = await service.delta('space-1', 'rev-1', undefined, 100);

    expect(response.items.map((item) => `${item.operation}:${
      'pageId' in item ? item.pageId : 'folderId' in item ? item.folderId
        : item.operation === 'upsert_page' ? item.page.pageId : item.folder.folderId
    }`)).toEqual([
      'archive_page:archived',
      'upsert_folder:child',
      'upsert_page:page-1',
    ]);
    expect(response.items[1]).toEqual(expect.objectContaining({
      operation: 'upsert_folder', folder: expect.objectContaining({ parentFolderId: 'root' }),
    }));
  });

  it('binds delta cursors to the fixed from/to revisions and rejects cross-route replay', async () => {
    const { service, cursors } = await fixture(620);
    const first = await service.delta('space-1', 'rev-1', undefined, 100);
    expect(first.nextCursor).not.toBeNull();
    const decoded = cursors.decode(first.nextCursor!);
    expect(decoded).toEqual(expect.objectContaining({
      kind: 'delta-v2', spaceId: 'space-1', fromRevision: 'rev-1', revision: 'rev-2',
    }));

    const replay = Buffer.from(JSON.stringify({ ...decoded, spaceId: 'space-2' })).toString('base64url');
    await expect(service.delta('space-1', 'rev-1', replay, 100))
      .rejects.toMatchObject({ syncCode: 'CURSOR_INVALID' });
  });

  it('fails closed for an explicit missing immutable revision', async () => {
    const { service } = await fixture();

    await expect(service.snapshot('space-1', 'missing-revision', undefined, 100))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
    await expect(service.delta('space-1', 'missing-revision', undefined, 100))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
  });

  it.each([
    ['missing Folder row', (state: any) => state.foldersByRevision.set('rev-2', [child])],
    ['missing Page row', (state: any) => state.pagesByRevision.set('rev-2', [])],
    ['modified Page body', (state: any) => { state.pagesByRevision.get('rev-2')[0].content.body = '# Changed\n'; }],
    ['modified Page content hash', (state: any) => { state.pagesByRevision.get('rev-2')[0].contentHash = 'f'.repeat(64); }],
    ['modified Folder path key', (state: any) => { state.foldersByRevision.get('rev-2')[0].pathKey = 'pages/tampered'; }],
    ['modified Page path key', (state: any) => { state.pagesByRevision.get('rev-2')[0].pathKey = 'pages/tampered.md'; }],
    ['modified content byte length', (state: any) => { state.pagesByRevision.get('rev-2')[0].content.byteLength = 999; }],
    ['modified revision hash', (state: any) => { state.revisions.get('rev-2').revisionContentHash = 'f'.repeat(64); }],
    ['modified revision page count', (state: any) => { state.revisions.get('rev-2').pageCount = 2n; }],
    ['modified revision manifest bytes', (state: any) => { state.revisions.get('rev-2').revisionManifestByteLength += 1n; }],
    ['modified revision body bytes', (state: any) => { state.revisions.get('rev-2').revisionBodyBytes += 1n; }],
    ['missing v2 sidecar', (state: any) => state.sidecars.delete('rev-2')],
    ['modified sidecar version', (state: any) => {
      state.sidecars.get('rev-2').sidecar.spaceFolderMigration.v2Revision.protocolVersion = '1';
    }],
    ['modified sidecar folder count', (state: any) => {
      state.sidecars.get('rev-2').sidecar.spaceFolderMigration.v2Revision.folderCount = '99';
    }],
    ['modified sidecar hash', (state: any) => {
      state.sidecars.get('rev-2').sidecar.spaceFolderMigration.v2Revision.revisionContentHash = 'f'.repeat(64);
    }],
    ['modified sidecar delta count', (state: any) => {
      state.sidecars.get('rev-2').sidecar.spaceFolderMigration.v2Revision.treeDeltaCount = '99';
    }],
  ])('fails closed when immutable v2 storage has %s', async (_label, mutate) => {
    const state = await fixture();
    mutate(state);

    await expect(state.service.snapshot('space-1', 'rev-2', undefined, 100))
      .rejects.toMatchObject({
        syncCode: 'REVISION_GONE',
        response: { protocolVersion: '2', error: expect.objectContaining({
          code: 'REVISION_GONE', message: 'Revision is not available',
        }) },
      });
  });

  it('rejects a snapshot cursor replayed with a different explicit revision', async () => {
    const { service } = await fixture();
    const first = await service.snapshot('space-1', 'rev-2', undefined, 1);

    await expect(service.snapshot('space-1', 'rev-1', first.nextCursor!, 1))
      .rejects.toMatchObject({ syncCode: 'CURSOR_INVALID' });
  });
});
