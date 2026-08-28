import { canonicalBytes, treeRevisionContentHashV2 } from '@neomei/agentwiki-sync-protocol';
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
  contentHash: 'a'.repeat(64), updatedAt: at('2026-08-29T00:00:02.000Z'),
  content: { body: '# Page\n', byteLength: 7 },
};

function cursorCodec() {
  return {
    encode: jest.fn((payload: object) => Buffer.from(JSON.stringify(payload)).toString('base64url')),
    decode: jest.fn((value: string) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))),
  };
}

function fixture(maxResponseBytes = 4 * 1024 * 1024) {
  const revisions = new Map([
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
    ['rev-2', [child, root]],
  ]);
  const pagesByRevision = new Map<string, any[]>([
    ['rev-1', [{
      ...page, revisionId: 'rev-1', folderId: 'root', path: 'pages/Root/Old.md',
      pathKey: 'pages/root/old.md', updatedAt: at('2026-08-28T00:00:02.000Z'),
    }, {
      ...page, revisionId: 'rev-1', pageId: 'archived', path: 'pages/Root/Archived.md',
      pathKey: 'pages/root/archived.md', updatedAt: at('2026-08-28T00:00:03.000Z'),
    }]],
    ['rev-2', [page]],
  ]);
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
  } as any;
  const cursors = cursorCodec();
  const capabilities = { capabilitiesV2: jest.fn(() => ({ maxResponseBytes })) };
  return {
    service: new SyncV2RevisionService(prisma, cursors as any, capabilities as any),
    cursors,
  };
}

describe('SyncV2RevisionService', () => {
  it('serves the empty immutable v2 revision with the canonical empty hash', async () => {
    const { service } = fixture();

    await expect(service.snapshot('space-1', '0', undefined, 100)).resolves.toEqual({
      protocolVersion: '2', spaceId: 'space-1', revision: '0', sequence: 0,
      revisionContentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      folderCount: '0', pageCount: '0', revisionManifestByteLength: '0',
      revisionBodyBytes: '0', folders: [], pages: [], nextCursor: null,
    });
  });

  it('paginates parent before child before Page and resumes without duplicates or omissions', async () => {
    const { service } = fixture();
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
    const { service } = fixture(620);
    const response = await service.snapshot('space-1', 'rev-2', undefined, 100);

    expect(Buffer.byteLength(JSON.stringify(response), 'utf8')).toBeLessThanOrEqual(620);
    expect(response.nextCursor).not.toBeNull();
    expect(response.folders.length + response.pages.length).toBeGreaterThan(0);
  });

  it('returns Page folderId and metrics from the canonical v2 manifest', async () => {
    const { service } = fixture();
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
    const { service } = fixture();
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
    const { service, cursors } = fixture(620);
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
    const { service } = fixture();

    await expect(service.snapshot('space-1', 'missing-revision', undefined, 100))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
    await expect(service.delta('space-1', 'missing-revision', undefined, 100))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
  });

  it('rejects a snapshot cursor replayed with a different explicit revision', async () => {
    const { service } = fixture();
    const first = await service.snapshot('space-1', 'rev-2', undefined, 1);

    await expect(service.snapshot('space-1', 'rev-1', first.nextCursor!, 1))
      .rejects.toMatchObject({ syncCode: 'CURSOR_INVALID' });
  });
});
