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
  path: 'pages/Root/Café', pathKey: 'pages/root/café', sortOrder: 0,
  updatedAt: at('2026-08-29T00:00:01.000Z'),
};
const page = {
  revisionId: 'rev-2', pageId: 'page-1', folderId: 'child',
  path: 'pages/Root/Café/Page.md', pathKey: 'pages/root/café/page.md', title: 'Page',
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
      recipeVersion: 'space-folders-v1', parentRevisionId: null, origin: 'migration',
      migrationBatchId: 'space-folders-v1:space-1',
      createdAt: at('2026-08-28T00:00:00.000Z'),
    }],
    ['rev-2', {
      id: 'rev-2', spaceId: 'space-1', sequence: 2, schemaVersion: 'content-tree@2',
      recipeVersion: 'space-folders-v1', parentRevisionId: 'rev-1', origin: 'change_set',
      migrationBatchId: null,
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
      findMany: jest.fn(async ({ where }: any) => [...revisions.values()]
        .filter((revision) => revision.spaceId === where.spaceId && revision.sequence < where.sequence.lt)
        .sort((left, right) => right.sequence - left.sequence)),
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

function replaceWithInitialV2Delta(state: Awaited<ReturnType<typeof fixture>>, revisionId = 'rev-2') {
  const bodyHash = state.pagesByRevision.get(revisionId)![0].contentHash;
  state.deltaRows.set(revisionId, [
    { ordinal: 0, operation: 'upsert_folder', folderId: 'root', pageId: null, previousPath: null, contentHash: null },
    { ordinal: 1, operation: 'upsert_folder', folderId: 'child', pageId: null, previousPath: null, contentHash: null },
    { ordinal: 2, operation: 'upsert_page', folderId: null, pageId: 'page-1', previousPath: null, contentHash: bodyHash },
  ]);
  state.sidecars.get(revisionId)!.sidecar.spaceFolderMigration.v2Revision.treeDeltaCount = '3';
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
    ['downgraded schema marker', (state: any) => { state.revisions.get('rev-2').schemaVersion = 'knowledge-bundle@1'; }],
    ['modified recipe marker', (state: any) => { state.revisions.get('rev-2').recipeVersion = 'none'; }],
    ['missing sidecar plus downgraded schema', (state: any) => {
      state.revisions.get('rev-2').schemaVersion = 'knowledge-bundle@1';
      state.sidecars.delete('rev-2');
    }],
    ['non-canonical Folder path bytes', (state: any) => {
      const folder = state.foldersByRevision.get('rev-2')[0];
      folder.path = 'pages/Root/Cafe\u0301';
      folder.pathKey = 'pages/root/café';
    }],
    ['non-canonical Page path bytes', (state: any) => {
      const page = state.pagesByRevision.get('rev-2')[0];
      page.path = 'pages/Root/Cafe\u0301/Page.md';
      page.pathKey = 'pages/root/café/page.md';
    }],
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

  it.each([
    ['tampered archive previousPath', (state: any) => {
      state.deltaRows.get('rev-2')[0].previousPath = 'pages/Root/Wrong.md';
    }],
    ['tampered archive target', (state: any) => {
      state.deltaRows.get('rev-2')[0].pageId = 'other-archived';
    }],
    ['unchanged Folder upsert replacing the changed Folder', (state: any) => {
      state.deltaRows.get('rev-2')[1].folderId = 'root';
    }],
    ['same-count reordered Page upserts', (state: any) => {
      const rows = state.deltaRows.get('rev-1');
      [rows[2].pageId, rows[3].pageId] = [rows[3].pageId, rows[2].pageId];
    }],
    ['missing expected row with matching sidecar count', (state: any) => {
      state.deltaRows.get('rev-2').pop();
      state.sidecars.get('rev-2').sidecar.spaceFolderMigration.v2Revision.treeDeltaCount = '2';
    }],
    ['extra valid-looking row with matching sidecar count', (state: any) => {
      state.deltaRows.get('rev-2').push({
        ordinal: 3, operation: 'upsert_page', folderId: null, pageId: 'page-1',
        previousPath: null, contentHash: state.pagesByRevision.get('rev-2')[0].contentHash,
      });
      state.sidecars.get('rev-2').sidecar.spaceFolderMigration.v2Revision.treeDeltaCount = '4';
    }],
  ])('rejects a stored tree delta with %s', async (_label, mutate) => {
    const state = await fixture();
    mutate(state);

    const revisionId = _label.includes('reordered') ? 'rev-1' : 'rev-2';
    await expect(state.service.snapshot('space-1', revisionId, undefined, 100))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
  });

  it('propagates a parent recipe-only v2 marker even when the parent schema marker was removed', async () => {
    const state = await fixture();
    const current = state.revisions.get('rev-2');
    current.schemaVersion = 'knowledge-bundle@1';
    current.recipeVersion = 'none';
    current.migrationBatchId = null;
    state.sidecars.delete('rev-2');
    state.foldersByRevision.set('rev-2', []);
    state.pagesByRevision.get('rev-2')![0].folderId = null;
    state.deltaRows.set('rev-2', []);
    const parent = state.revisions.get('rev-1');
    parent.schemaVersion = 'knowledge-bundle@1';
    parent.migrationBatchId = null;
    state.sidecars.delete('rev-1');
    state.foldersByRevision.set('rev-1', []);
    state.pagesByRevision.set('rev-1', []);
    state.deltaRows.set('rev-1', []);

    await expect(state.service.snapshot('space-1', 'rev-2', undefined, 100))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
  });

  it.each([
    ['missing parent row', (state: Awaited<ReturnType<typeof fixture>>) => {
      state.revisions.delete('rev-1');
      replaceWithInitialV2Delta(state);
    }],
    ['null parent on a non-initial sequence', (state: Awaited<ReturnType<typeof fixture>>) => {
      state.revisions.get('rev-2').parentRevisionId = null;
      replaceWithInitialV2Delta(state);
    }],
    ['self parent', (state: Awaited<ReturnType<typeof fixture>>) => {
      state.revisions.get('rev-2').parentRevisionId = 'rev-2';
      state.deltaRows.set('rev-2', []);
      state.sidecars.get('rev-2')!.sidecar.spaceFolderMigration.v2Revision.treeDeltaCount = '0';
    }],
    ['wrong older predecessor', (state: Awaited<ReturnType<typeof fixture>>) => {
      state.revisions.set('rev-old', {
        id: 'rev-old', spaceId: 'space-1', sequence: 0, schemaVersion: 'knowledge-bundle@1',
        recipeVersion: 'none', parentRevisionId: null, origin: 'change_set', migrationBatchId: null,
        createdAt: at('2026-08-27T00:00:00.000Z'),
      });
      state.revisions.get('rev-2').parentRevisionId = 'rev-old';
      replaceWithInitialV2Delta(state);
    }],
    ['same-sequence predecessor', (state: Awaited<ReturnType<typeof fixture>>) => {
      state.revisions.set('rev-peer', {
        id: 'rev-peer', spaceId: 'space-1', sequence: 2, schemaVersion: 'knowledge-bundle@1',
        recipeVersion: 'none', parentRevisionId: null, origin: 'change_set', migrationBatchId: null,
        createdAt: at('2026-08-29T00:00:00.000Z'),
      });
      state.revisions.get('rev-2').parentRevisionId = 'rev-peer';
      replaceWithInitialV2Delta(state);
    }],
    ['future predecessor', (state: Awaited<ReturnType<typeof fixture>>) => {
      state.revisions.set('rev-future', {
        id: 'rev-future', spaceId: 'space-1', sequence: 3, schemaVersion: 'knowledge-bundle@1',
        recipeVersion: 'none', parentRevisionId: null, origin: 'change_set', migrationBatchId: null,
        createdAt: at('2026-08-30T00:00:00.000Z'),
      });
      state.revisions.get('rev-2').parentRevisionId = 'rev-future';
      replaceWithInitialV2Delta(state);
    }],
    ['cross-Space predecessor', (state: Awaited<ReturnType<typeof fixture>>) => {
      state.revisions.get('rev-1').spaceId = 'space-2';
    }],
  ])('rejects an invalid immutable revision chain with %s', async (_label, mutate) => {
    const state = await fixture();
    mutate(state);

    await expect(state.service.snapshot('space-1', 'rev-2', undefined, 100))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
  });

  it('accepts a first v2 revision whose exact predecessor is a marker-free legacy revision', async () => {
    const state = await fixture();
    const parent = state.revisions.get('rev-1');
    parent.schemaVersion = 'knowledge-bundle@1';
    parent.recipeVersion = 'none';
    parent.migrationBatchId = null;
    state.sidecars.delete('rev-1');
    state.foldersByRevision.set('rev-1', []);
    state.pagesByRevision.set('rev-1', []);
    state.deltaRows.set('rev-1', []);
    replaceWithInitialV2Delta(state);

    await expect(state.service.snapshot('space-1', 'rev-2', undefined, 100))
      .resolves.toEqual(expect.objectContaining({ revision: 'rev-2', folderCount: '2', pageCount: '1' }));
  });

  it('accepts an initial v2 revision with a null parent', async () => {
    const state = await fixture();

    await expect(state.service.snapshot('space-1', 'rev-1', undefined, 100))
      .resolves.toEqual(expect.objectContaining({ revision: 'rev-1', sequence: 1 }));
    const chainQuery = (state.service as any).prisma.spaceKnowledgeRevision.findMany.mock.calls[0][0];
    expect(chainQuery.select).toEqual(expect.objectContaining({
      id: true, spaceId: true, sequence: true, parentRevisionId: true,
    }));
    expect(chainQuery.select).not.toHaveProperty('snapshot');
    expect(chainQuery.select).not.toHaveProperty('delta');
  });

  it('rejects a child whose v2 parent has a same-count corrupted stored delta', async () => {
    const state = await fixture();
    state.deltaRows.get('rev-1')![0].folderId = 'wrong-root';

    await expect(state.service.snapshot('space-1', 'rev-2', undefined, 100))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
  });

  it('rejects a child whose v2 parent has an invalid parent chain', async () => {
    const state = await fixture();
    state.revisions.get('rev-1').parentRevisionId = 'rev-2';

    await expect(state.service.snapshot('space-1', 'rev-2', undefined, 100))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
  });

  it('rejects a deep marker-free chain with a missing ancestor link', async () => {
    const state = await fixture();
    for (const revisionId of ['rev-1', 'rev-2']) {
      const revision = state.revisions.get(revisionId);
      revision.schemaVersion = 'knowledge-bundle@1';
      revision.recipeVersion = 'none';
      revision.migrationBatchId = null;
      state.sidecars.delete(revisionId);
      state.foldersByRevision.set(revisionId, []);
      state.pagesByRevision.set(revisionId, []);
      state.deltaRows.set(revisionId, []);
    }
    state.revisions.get('rev-2').parentRevisionId = 'missing-deep-parent';
    state.revisions.set('rev-3', {
      id: 'rev-3', spaceId: 'space-1', sequence: 3, parentRevisionId: 'rev-2',
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', migrationBatchId: null,
      createdAt: at('2026-08-30T00:00:00.000Z'),
    });
    state.revisions.set('rev-4', {
      id: 'rev-4', spaceId: 'space-1', sequence: 4, parentRevisionId: 'rev-3',
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', migrationBatchId: null,
      createdAt: at('2026-08-31T00:00:00.000Z'),
    });

    await expect(state.service.snapshot('space-1', 'rev-4', undefined, 100))
      .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
  });

  it('rejects a snapshot cursor replayed with a different explicit revision', async () => {
    const { service } = await fixture();
    const first = await service.snapshot('space-1', 'rev-2', undefined, 1);

    await expect(service.snapshot('space-1', 'rev-1', first.nextCursor!, 1))
      .rejects.toMatchObject({ syncCode: 'CURSOR_INVALID' });
  });
});
