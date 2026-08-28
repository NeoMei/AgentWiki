import { ContentTreeService } from './content-tree.service';
import { ContentTreeConflict, ContentTreeError } from './content-tree.types';

const now = new Date('2026-08-28T00:00:00.000Z');

function makeHarness(options: {
  treeRevision?: bigint;
  ancestors?: Array<{ id: string; path: string; depth: number }>;
  folderCount?: bigint;
  duplicate?: boolean;
} = {}) {
  const tx: any = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn()
      .mockResolvedValueOnce(options.ancestors ?? [])
      .mockResolvedValueOnce([{ count: options.folderCount ?? 0n }]),
    space: { findUnique: jest.fn() },
    folder: {
      findFirst: jest.fn().mockResolvedValue(options.duplicate ? { id: 'duplicate' } : null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({
        id: 'folder-new',
        ...data,
        createdAt: now,
        updatedAt: now,
      })),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 3 } }),
    },
    page: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma: any = {
    $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)),
  };
  const revisionWriter: any = {
    lockContentTreeSpace: jest.fn().mockImplementation(async (transaction: any) => Object.assign(transaction, {
      contentTreeRevision: options.treeRevision ?? 0n,
    })),
    advanceContentTreeRevision: jest.fn().mockImplementation(async (_tx: any, _spaceId: string, expected: bigint) => expected + 1n),
    advance: jest.fn().mockResolvedValue({ revisionId: 'sync-revision-1', sequence: 1 }),
    advanceStructuralPages: jest.fn().mockResolvedValue({ revisionId: 'sync-structural-1', sequence: 2 }),
  };
  const syncPaths: any = {
    allocate: jest.fn(),
  };
  return {
    service: new ContentTreeService(prisma, revisionWriter, syncPaths),
    prisma,
    tx,
    revisionWriter,
    syncPaths,
  };
}

describe('ContentTreeService create/read core', () => {
  it('creates a root Folder and advances tree and sync revisions in one transaction', async () => {
    const { service, tx, revisionWriter } = makeHarness();

    const result = await service.createFolder({
      spaceId: 'space-1',
      parentId: null,
      name: ' 项目 ',
      expectedTreeRevision: 0n,
      actor: { userId: 'user-1' },
    });

    expect(tx.folder.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      spaceId: 'space-1', parentId: null, name: '项目', path: 'pages/项目', sortOrder: 4,
      createdByUserId: 'user-1', lastModifiedByUserId: 'user-1',
    }) });
    expect(revisionWriter.advanceContentTreeRevision).toHaveBeenCalledWith(tx, 'space-1', 0n);
    expect(revisionWriter.advance).toHaveBeenCalledWith(
      tx, 'space-1', [], expect.objectContaining({ origin: 'web_editor', createdByUserId: 'user-1' }),
    );
    expect(result.treeRevision).toBe(1n);
    expect(result.folder.path).toBe('pages/项目');
  });

  it('creates a nested Folder from its bounded ancestor chain', async () => {
    const { service, tx } = makeHarness({
      ancestors: [
        { id: 'parent', path: 'pages/项目', depth: 1 },
        { id: 'root', path: 'pages', depth: 2 },
      ],
    });

    const result = await service.createFolder({
      spaceId: 'space-1', parentId: 'parent', name: '周报', expectedTreeRevision: 0n,
      actor: { agentId: 'agent-1' },
    });

    expect(tx.folder.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      parentId: 'parent', path: 'pages/项目/周报', createdByAgentId: 'agent-1',
    }) });
    expect(result.folder.path).toBe('pages/项目/周报');
  });

  it.each([
    ['duplicate portable sibling', makeHarness({ duplicate: true }), 'FOLDER_NAME_CONFLICT'],
    ['cross-Space or missing parent', makeHarness({ ancestors: [] }), 'FOLDER_NOT_FOUND'],
    ['depth 33', makeHarness({ ancestors: Array.from({ length: 32 }, (_, index) => ({ id: `${index}`, path: 'pages/x', depth: index + 1 })) }), 'FOLDER_DEPTH_LIMIT'],
    ['10,001st active Folder', makeHarness({ folderCount: 10_000n }), 'FOLDER_COUNT_LIMIT'],
  ])('rejects %s before writing', async (_label, harness, code) => {
    const input = {
      spaceId: 'space-1', parentId: code === 'FOLDER_NOT_FOUND' || code === 'FOLDER_DEPTH_LIMIT' ? 'parent' : null,
      name: '项目', expectedTreeRevision: 0n, actor: { userId: 'user-1' },
    };
    await expect(harness.service.createFolder(input)).rejects.toEqual(expect.objectContaining({ code }));
    expect(harness.tx.folder.create).not.toHaveBeenCalled();
  });

  it('rejects a path over 1024 UTF-8 bytes before writing', async () => {
    const parentPath = `pages/${Array.from({ length: 15 }, () => 'a'.repeat(60)).join('/')}`;
    const { service, tx } = makeHarness({ ancestors: [{ id: 'parent', path: parentPath, depth: 15 }] });

    await expect(service.createFolder({
      spaceId: 'space-1', parentId: 'parent', name: 'b'.repeat(120), expectedTreeRevision: 0n,
      actor: { userId: 'user-1' },
    })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_PATH_TOO_LONG' }));
    expect(tx.folder.create).not.toHaveBeenCalled();
  });

  it('fails stale tree revisions before hierarchy reads or writes', async () => {
    const { service, tx } = makeHarness({ treeRevision: 4n });
    await expect(service.createFolder({
      spaceId: 'space-1', parentId: null, name: '项目', expectedTreeRevision: 3n,
      actor: { userId: 'user-1' },
    })).rejects.toBeInstanceOf(ContentTreeConflict);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.folder.create).not.toHaveBeenCalled();
  });

  it('maps a missing/deleted locked Space to the ContentTree not-found contract', async () => {
    const { service, tx, revisionWriter } = makeHarness();
    revisionWriter.lockContentTreeSpace.mockResolvedValue(null);
    await expect(service.createFolder({
      spaceId: 'missing-space', parentId: null, name: '项目', expectedTreeRevision: 0n,
      actor: { userId: 'user-1' },
    })).rejects.toEqual(expect.objectContaining({ code: 'SPACE_NOT_FOUND' }));
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.folder.create).not.toHaveBeenCalled();
  });

  it('lists only direct children with Folder-first deterministic cursor pagination and hasChildren', async () => {
    const { service, prisma, tx } = makeHarness();
    tx.space.findUnique.mockResolvedValue({ contentTreeRevision: 9n });
    tx.folder.findMany
      .mockResolvedValueOnce([
        { id: 'f1', name: 'A', path: 'pages/A', sortOrder: 0, createdAt: now, updatedAt: now, _count: { children: 1, pages: 0 } },
        { id: 'f2', name: 'B', path: 'pages/B', sortOrder: 1, createdAt: now, updatedAt: now, _count: { children: 0, pages: 0 } },
      ])
      .mockResolvedValueOnce([]);
    tx.page.findMany
      .mockResolvedValueOnce([{ id: 'p1', folderId: null, title: 'P', syncPath: 'pages/P.md', sortOrder: 0, createdAt: now, updatedAt: now }])
      .mockResolvedValueOnce([{ id: 'p1', folderId: null, title: 'P', syncPath: 'pages/P.md', sortOrder: 0, createdAt: now, updatedAt: now }]);

    const first = await service.listChildren({ spaceId: 'space-1', parentFolderId: null, take: 2 });
    expect(first.data.map((item) => item.kind)).toEqual(['folder', 'folder']);
    expect(first.data[0]).toEqual(expect.objectContaining({ id: 'f1', hasChildren: true }));
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await service.listChildren({
      spaceId: 'space-1', parentFolderId: null, take: 2, cursor: first.nextCursor!,
    });
    expect(second.data).toEqual([expect.objectContaining({ kind: 'page', id: 'p1' })]);
    expect(second.nextCursor).toBeNull();
    expect(tx.folder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ spaceId: 'space-1', parentId: null, deletedAt: null }),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('binds a cursor to its Space and parent location', async () => {
    const { service, tx } = makeHarness();
    tx.space.findUnique.mockResolvedValue({ contentTreeRevision: 0n });
    tx.folder.findMany.mockResolvedValue([
      { id: 'f1', name: 'A', path: 'pages/A', sortOrder: 0, createdAt: now, updatedAt: now, _count: { children: 0, pages: 0 } },
      { id: 'f2', name: 'B', path: 'pages/B', sortOrder: 1, createdAt: now, updatedAt: now, _count: { children: 0, pages: 0 } },
    ]);
    tx.page.findMany.mockResolvedValue([]);
    const page = await service.listChildren({ spaceId: 'space-1', parentFolderId: null, take: 1 });

    await expect(service.listChildren({
      spaceId: 'space-2', parentFolderId: null, take: 1, cursor: page.nextCursor!,
    })).rejects.toEqual(expect.objectContaining({ code: 'CONTENT_TREE_CURSOR_INVALID' }));
    await expect(service.listChildren({
      spaceId: 'space-1', parentFolderId: 'another-parent', take: 1, cursor: page.nextCursor!,
    })).rejects.toEqual(expect.objectContaining({ code: 'CONTENT_TREE_CURSOR_INVALID' }));
  });

  it('rejects take outside 1..200', async () => {
    const { service } = makeHarness();
    await expect(service.listChildren({ spaceId: 'space-1', take: 0 })).rejects.toBeInstanceOf(ContentTreeError);
    await expect(service.listChildren({ spaceId: 'space-1', take: 201 })).rejects.toBeInstanceOf(ContentTreeError);
  });

  it('lists active Folders through a bounded, query-bound stable cursor', async () => {
    const { service, prisma, tx } = makeHarness();
    tx.space.findUnique.mockResolvedValue({ contentTreeRevision: 7n });
    tx.folder.findMany
      .mockResolvedValueOnce([
        { id: 'folder-a', parentId: null, name: '项目 A', nameKey: '项目 a', path: 'pages/项目 A', pathKey: 'pages/项目 a', createdAt: now, updatedAt: now },
        { id: 'folder-b', parentId: null, name: '项目 B', nameKey: '项目 b', path: 'pages/项目 B', pathKey: 'pages/项目 b', createdAt: now, updatedAt: now },
      ])
      .mockResolvedValueOnce([
        { id: 'folder-b', parentId: null, name: '项目 B', nameKey: '项目 b', path: 'pages/项目 B', pathKey: 'pages/项目 b', createdAt: now, updatedAt: now },
      ]);

    const first = await service.listFolders({ spaceId: 'space-1', query: ' 项目 ', take: 1 });
    const second = await service.listFolders({
      spaceId: 'space-1', query: '项目', take: 1, cursor: first.nextCursor!,
    });

    expect(first).toEqual({
      spaceId: 'space-1', treeRevision: 7n,
      data: [expect.objectContaining({ id: 'folder-a', name: '项目 A', path: 'pages/项目 A' })],
      nextCursor: expect.any(String),
    });
    expect(second.data).toEqual([expect.objectContaining({ id: 'folder-b' })]);
    expect(second.nextCursor).toBeNull();
    expect(tx.folder.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        spaceId: 'space-1', deletedAt: null,
        OR: [{ nameKey: { contains: '项目' } }, { pathKey: { contains: '项目' } }],
      },
      orderBy: [{ pathKey: 'asc' }, { id: 'asc' }],
      take: 2,
    }));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('rejects a Folder-list cursor reused with another query or Space before reading rows', async () => {
    const { service, tx } = makeHarness();
    tx.space.findUnique.mockResolvedValue({ contentTreeRevision: 0n });
    tx.folder.findMany.mockResolvedValue([
      { id: 'folder-a', parentId: null, name: 'A', nameKey: 'a', path: 'pages/A', pathKey: 'pages/a', createdAt: now, updatedAt: now },
      { id: 'folder-b', parentId: null, name: 'B', nameKey: 'b', path: 'pages/B', pathKey: 'pages/b', createdAt: now, updatedAt: now },
    ]);
    const first = await service.listFolders({ spaceId: 'space-1', query: 'a', take: 1 });
    tx.folder.findMany.mockClear();

    await expect(service.listFolders({
      spaceId: 'space-1', query: 'b', take: 1, cursor: first.nextCursor!,
    })).rejects.toEqual(expect.objectContaining({ code: 'CONTENT_TREE_CURSOR_INVALID' }));
    await expect(service.listFolders({
      spaceId: 'space-2', query: 'a', take: 1, cursor: first.nextCursor!,
    })).rejects.toEqual(expect.objectContaining({ code: 'CONTENT_TREE_CURSOR_INVALID' }));
    expect(tx.folder.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['deleted', null],
    ['foreign', null],
  ])('rejects a %s supplied parent without disclosing its location', async (_label, parent) => {
    const { service, tx } = makeHarness();
    tx.space.findUnique.mockResolvedValue({ contentTreeRevision: 0n });
    tx.folder.findFirst.mockResolvedValue(parent);
    await expect(service.listChildren({
      spaceId: 'space-1', parentFolderId: 'unavailable-parent', take: 10,
    })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_NOT_FOUND' }));
    expect(tx.folder.findMany).not.toHaveBeenCalled();
    expect(tx.page.findMany).not.toHaveBeenCalled();
  });

  it('treats a supplied empty-string parent as an exact Folder ID, not as root', async () => {
    const { service, tx } = makeHarness();
    tx.space.findUnique.mockResolvedValue({ contentTreeRevision: 0n });
    tx.folder.findFirst.mockResolvedValue(null);

    await expect(service.listChildren({
      spaceId: 'space-1', parentFolderId: '', take: 10,
    })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_NOT_FOUND' }));
    expect(tx.folder.findFirst).toHaveBeenCalledWith({
      where: { id: '', spaceId: 'space-1', deletedAt: null },
      select: { id: true },
    });
    expect(tx.folder.findMany).not.toHaveBeenCalled();
    expect(tx.page.findMany).not.toHaveBeenCalled();
  });

  it('reads revision, parent, Folder children, and Page children from one read-only repeatable-read transaction', async () => {
    const { service, prisma, tx } = makeHarness();
    tx.space.findUnique.mockResolvedValue({ contentTreeRevision: 12n });
    tx.folder.findFirst.mockResolvedValue({ id: 'parent' });
    tx.folder.findMany.mockResolvedValue([]);
    tx.page.findMany.mockResolvedValue([]);

    await expect(service.listChildren({
      spaceId: 'space-1', parentFolderId: 'parent', take: 10,
    })).resolves.toEqual(expect.objectContaining({ treeRevision: 12n, data: [] }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(tx.$executeRaw).toHaveBeenCalledWith(expect.anything());
  });
});

describe('ContentTreeService Page placement and concurrency', () => {
  it('owns the Page mutation lock and decimal tree-revision comparison', async () => {
    const { service, tx, revisionWriter } = makeHarness({ treeRevision: 7n });

    await expect(service.lockPageMutationSpace(tx, 'space-1', 7n)).resolves.toBe(tx);
    await expect(service.lockPageMutationSpace(tx, 'space-1', 6n))
      .rejects.toEqual(expect.objectContaining({ code: 'CONTENT_TREE_CONFLICT' }));
    expect(revisionWriter.lockContentTreeSpace).toHaveBeenCalledWith(tx, 'space-1');
  });

  it('prepares an existing Page rename through Folder placement and records the old path alias', async () => {
    const { service, tx, syncPaths } = makeHarness();
    tx.folder.findFirst.mockResolvedValue({ id: 'folder-1', path: 'pages/项目' });
    tx.$executeRaw.mockResolvedValue(1);
    syncPaths.allocate.mockResolvedValue({
      path: 'pages/项目/新标题.md', pathKey: 'pages/项目/新标题.md',
    });

    const placement = await service.preparePageMutation(tx, {
      spaceId: 'space-1', pageId: 'page-1', title: '新标题', folderId: 'folder-1',
      current: {
        title: '旧标题', folderId: null, syncPath: 'pages/旧标题.md',
        syncPathKey: 'pages/旧标题.md', sortOrder: 0,
        createdAt: now, updatedAt: now, knowledgeKey: 'knowledge-1', content: '# old',
      },
    });

    expect(syncPaths.allocate).toHaveBeenCalledWith(tx, expect.objectContaining({
      spaceId: 'space-1', directory: 'pages/项目', title: '新标题', excludePageId: 'page-1',
    }));
    expect(tx.$executeRaw.mock.calls.some(([query]: any[]) =>
      Array.isArray(query?.strings) && query.strings.join(' ').includes('INSERT INTO "PagePathAlias"')))
      .toBe(true);
    expect(placement).toEqual({
      folderId: 'folder-1', syncPath: 'pages/项目/新标题.md',
      syncPathKey: 'pages/项目/新标题.md',
    });
  });

  it('maps an exact external path only to root or one active same-Space Folder and records an alias', async () => {
    const { service, tx, syncPaths } = makeHarness();
    tx.folder.findMany.mockResolvedValue([
      { id: 'folder-1', path: 'pages/项目', pathKey: 'pages/项目' },
    ]);
    tx.page.findFirst.mockResolvedValue(null);
    tx.$executeRaw.mockResolvedValue(1);

    const placement = await (service as any).prepareExactPageMutation(tx, {
      spaceId: 'space-1', pageId: 'page-1', title: '新标题',
      syncPath: 'pages/项目/新标题.md',
      current: {
        title: '旧标题', folderId: null, syncPath: 'pages/旧标题.md',
        syncPathKey: 'pages/旧标题.md', sortOrder: 0,
        createdAt: now, updatedAt: now, knowledgeKey: 'knowledge-1', content: '# old',
      },
    });

    expect(placement).toEqual({
      folderId: 'folder-1', syncPath: 'pages/项目/新标题.md',
      syncPathKey: 'pages/项目/新标题.md',
    });
    expect(tx.folder.findMany).toHaveBeenCalledWith({
      where: { spaceId: 'space-1', deletedAt: null, pathKey: 'pages/项目' },
      select: { id: true, path: true, pathKey: true }, take: 2,
    });
    expect(syncPaths.allocate).not.toHaveBeenCalled();
    expect(tx.$executeRaw.mock.calls.some(([query]: any[]) =>
      Array.isArray(query?.strings) && query.strings.join(' ').includes('INSERT INTO "PagePathAlias"')))
      .toBe(true);
  });

  it('fails closed for an unmapped, ambiguous, or conflicting exact external path', async () => {
    const { service, tx } = makeHarness();
    const input = {
      spaceId: 'space-1', pageId: 'page-1', title: 'Weekly', syncPath: 'pages/team/Weekly.md',
    };

    tx.folder.findMany.mockResolvedValue([]);
    await expect((service as any).prepareExactPageMutation(tx, input))
      .rejects.toEqual(expect.objectContaining({ code: 'FOLDER_NOT_FOUND' }));

    tx.folder.findMany.mockResolvedValue([
      { id: 'folder-1', path: 'pages/team', pathKey: 'pages/team' },
      { id: 'folder-2', path: 'pages/team', pathKey: 'pages/team' },
    ]);
    await expect((service as any).prepareExactPageMutation(tx, input))
      .rejects.toEqual(expect.objectContaining({ code: 'FOLDER_NOT_FOUND' }));

    tx.folder.findMany.mockResolvedValue([
      { id: 'folder-1', path: 'pages/team', pathKey: 'pages/team' },
    ]);
    tx.page.findFirst.mockResolvedValue({ id: 'page-2' });
    await expect((service as any).prepareExactPageMutation(tx, input))
      .rejects.toEqual(expect.objectContaining({ code: 'CONTENT_TREE_CONFLICT' }));
  });

  it('advances contentTreeRevision only for structural Page changes while always advancing Sync', async () => {
    const { service, tx, revisionWriter } = makeHarness();
    const change = {
      operation: 'upsert' as const, pageId: 'knowledge-1', folderId: null,
      path: 'pages/P.md', title: 'P', body: '# P',
    };

    await service.advancePageMutation(tx, {
      spaceId: 'space-1', expectedTreeRevision: 0n, structural: false,
      changes: [change], actor: { userId: 'user-1' },
    });
    expect(revisionWriter.advanceContentTreeRevision).not.toHaveBeenCalled();
    expect(revisionWriter.advance).toHaveBeenCalledTimes(1);
    expect(revisionWriter.advanceStructuralPages).not.toHaveBeenCalled();

    await service.advancePageMutation(tx, {
      spaceId: 'space-1', expectedTreeRevision: 0n, structural: true,
      changes: [change], actor: { userId: 'user-1' },
    });
    expect(revisionWriter.advanceContentTreeRevision).toHaveBeenCalledWith(tx, 'space-1', 0n);
    expect(revisionWriter.advanceStructuralPages).toHaveBeenCalledWith(
      tx, 'space-1', [change], expect.objectContaining({ origin: 'web_editor' }),
    );
  });

  it('binds a structural Page mutation to an existing same-transaction Sync revision', async () => {
    const { service, tx, revisionWriter } = makeHarness();
    const result = await service.advancePageMutation(tx, {
      spaceId: 'space-1', expectedTreeRevision: 0n, structural: true,
      changes: [], actor: { userId: 'user-1' },
      existingSyncRevisionId: 'submission-revision-1',
    } as any);

    expect(revisionWriter.advanceContentTreeRevision).toHaveBeenCalledWith(tx, 'space-1', 0n);
    expect(revisionWriter.advanceStructuralPages).not.toHaveBeenCalled();
    expect(revisionWriter.advance).not.toHaveBeenCalled();
    expect(result).toEqual({ treeRevision: 1n, syncRevisionId: 'submission-revision-1' });
  });

  it('maps a legacy Page parent only through one exact migrated Folder path', async () => {
    const { service, tx } = makeHarness();
    tx.page.findFirst.mockResolvedValue({ syncPathKey: 'pages/项目.md' });
    tx.folder.findMany.mockResolvedValue([{ id: 'folder-1' }]);

    await expect(service.mapLegacyPageParent(tx, 'space-1', 'legacy-page'))
      .resolves.toBe('folder-1');
    expect(tx.folder.findMany).toHaveBeenCalledWith({
      where: { spaceId: 'space-1', deletedAt: null, pathKey: 'pages/项目' },
      select: { id: true }, take: 2,
    });

    tx.folder.findMany.mockResolvedValue([{ id: 'folder-1' }, { id: 'folder-2' }]);
    await expect(service.mapLegacyPageParent(tx, 'space-1', 'legacy-page'))
      .rejects.toEqual(expect.objectContaining({ code: 'PAGE_PARENT_DEPRECATED' }));
  });

  it('prepares initial Page placement inside the caller-owned locked transaction', async () => {
    const { service, prisma, tx, syncPaths, revisionWriter } = makeHarness();
    tx.page.findUnique.mockResolvedValue(null);
    tx.folder.findFirst.mockResolvedValue({ id: 'folder-1', path: 'pages/项目' });
    syncPaths.allocate.mockResolvedValue({ path: 'pages/项目/周报.md', pathKey: 'pages/项目/周报.md' });

    const result = await service.placePage(tx, {
      spaceId: 'space-1', pageId: 'page-new', title: '周报', folderId: 'folder-1',
    });

    expect(syncPaths.allocate).toHaveBeenCalledWith(expect.anything(), {
      spaceId: 'space-1', directory: 'pages/项目', title: '周报',
    });
    expect(result).toEqual({
      folderId: 'folder-1', syncPath: 'pages/项目/周报.md', syncPathKey: 'pages/项目/周报.md',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.page.update).not.toHaveBeenCalled();
    expect(revisionWriter.advanceContentTreeRevision).not.toHaveBeenCalled();
    expect(revisionWriter.advance).not.toHaveBeenCalled();
  });

  it('does not disclose a cross-Space target Folder', async () => {
    const { service, tx } = makeHarness();
    tx.page.findUnique.mockResolvedValue(null);
    tx.folder.findFirst.mockResolvedValue(null);
    await expect(service.placePage(tx, {
      spaceId: 'space-1', pageId: 'page-new', title: 'Page', folderId: 'other-space-folder',
    })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_NOT_FOUND' }));
    expect(tx.page.update).not.toHaveBeenCalled();
  });

  it('rejects an existing visible Page so initial placement cannot become an alias-free move', async () => {
    const { service, tx } = makeHarness();
    tx.page.findUnique.mockResolvedValue({ id: 'page-1', deletedAt: null, syncPath: 'pages/P.md' });
    await expect(service.placePage(tx, {
      spaceId: 'space-1', pageId: 'page-1', title: 'P', folderId: null,
    })).rejects.toEqual(expect.objectContaining({ code: 'CONTENT_TREE_CONFLICT' }));
    expect(tx.page.update).not.toHaveBeenCalled();
  });

  it('composes initial placement, Page create, and both revision advances in one caller transaction', async () => {
    const { service, prisma, tx, syncPaths, revisionWriter } = makeHarness();
    tx.page.findUnique.mockResolvedValue(null);
    tx.folder.findFirst.mockResolvedValue({ id: 'folder-1', path: 'pages/项目' });
    tx.page.create.mockResolvedValue({ id: 'page-new' });
    syncPaths.allocate.mockResolvedValue({ path: 'pages/项目/P.md', pathKey: 'pages/项目/p.md' });

    await prisma.$transaction(async (callerTx: any) => {
      const lockedTx = await revisionWriter.lockContentTreeSpace(callerTx, 'space-1');
      const placement = await service.placePage(lockedTx, {
        spaceId: 'space-1', pageId: 'page-new', title: 'P', folderId: 'folder-1',
      });
      await callerTx.page.create({ data: { id: 'page-new', ...placement } });
      await revisionWriter.advanceContentTreeRevision(lockedTx, 'space-1', 0n);
      await revisionWriter.advance(lockedTx, 'space-1', [], { origin: 'web_editor' });
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.page.create).toHaveBeenCalledWith({ data: {
      id: 'page-new', folderId: 'folder-1', syncPath: 'pages/项目/P.md', syncPathKey: 'pages/项目/p.md',
    } });
    expect(revisionWriter.advanceContentTreeRevision).toHaveBeenCalledWith(tx, 'space-1', 0n);
    expect(revisionWriter.advance).toHaveBeenCalledWith(tx, 'space-1', [], { origin: 'web_editor' });
  });

  it('serializes concurrent same-name creates so one succeeds and the stale peer conflicts', async () => {
    let currentRevision = 0n;
    const folders: Array<{ id: string; nameKey: string }> = [];
    let transactionTail = Promise.resolve();
    const tx: any = {
      $queryRaw: jest.fn().mockImplementation(async (query: any) =>
        String(query).includes('COUNT') ? [{ count: BigInt(folders.length) }] : []),
      folder: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => folders.find((folder) => folder.nameKey === where.nameKey) ?? null),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const folder = { id: `folder-${folders.length + 1}`, ...data, createdAt: now, updatedAt: now };
          folders.push(folder);
          return folder;
        }),
      },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: (transaction: any) => Promise<any>) => {
        const result = transactionTail.then(() => callback(tx));
        transactionTail = result.then(() => undefined, () => undefined);
        return result;
      }),
    };
    const revisionWriter: any = {
      lockContentTreeSpace: jest.fn().mockImplementation(async (transaction: any) => Object.assign(transaction, { contentTreeRevision: currentRevision })),
      advanceContentTreeRevision: jest.fn().mockImplementation(async (_tx: any, _spaceId: string, expected: bigint) => {
        if (expected !== currentRevision) throw new ContentTreeConflict(expected, currentRevision);
        currentRevision += 1n;
        return currentRevision;
      }),
      advance: jest.fn().mockResolvedValue({ revisionId: 'rev', sequence: 1 }),
    };
    const service = new ContentTreeService(prisma, revisionWriter, { allocate: jest.fn() } as any);
    const input = {
      spaceId: 'space-1', parentId: null, name: '项目', expectedTreeRevision: 0n,
      actor: { userId: 'user-1' },
    };

    const results = await Promise.allSettled([service.createFolder(input), service.createFolder(input)]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(folders).toHaveLength(1);
    expect(currentRevision).toBe(1n);
    const rejection = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(ContentTreeConflict);
  });
});

describe('ContentTreeService lifecycle mutations', () => {
  const changedAt = new Date('2026-08-28T01:00:00.000Z');
  const root = {
    kind: 'folder', id: 'folder-root', parentId: null, folderId: null,
    name: '项目', title: null, path: 'pages/项目', pathKey: 'pages/项目',
    sortOrder: 0, createdAt: now, updatedAt: now, depth: 0,
    knowledgeKey: null, content: null,
  };
  const child = {
    kind: 'folder', id: 'folder-child', parentId: 'folder-root', folderId: null,
    name: '周报', title: null, path: 'pages/项目/周报', pathKey: 'pages/项目/周报',
    sortOrder: 0, createdAt: now, updatedAt: now, depth: 1,
    knowledgeKey: null, content: null,
  };
  const page = {
    kind: 'page', id: 'page-1', parentId: null, folderId: 'folder-child',
    name: null, title: '进度', path: 'pages/项目/周报/进度.md', pathKey: 'pages/项目/周报/进度.md',
    sortOrder: 0, createdAt: now, updatedAt: now, depth: 2,
    knowledgeKey: 'knowledge-page-1', content: '# 进度',
  };

  function lifecycleHarness(affected = [root, child, page]) {
    const folderById = new Map<string, any>([
      ['folder-root', root], ['folder-child', child],
      ['folder-target', { ...root, id: 'folder-target', name: '目标', path: 'pages/目标', pathKey: 'pages/目标' }],
    ]);
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue(affected),
      $executeRaw: jest.fn().mockResolvedValue(affected.length),
      folder: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(
          where.id ? folderById.get(where.id) ?? null : null,
        )),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: affected.filter((row) => row.kind === 'folder').length }),
      },
      page: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(
          where.id === 'page-1'
            ? { ...page, syncPath: page.path, syncPathKey: page.pathKey }
            : null,
        )),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: affected.filter((row) => row.kind === 'page').length }),
      },
      pagePathAlias: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contentDeletionBatch: {
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'batch-1', ...data })),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)),
    };
    const revisionWriter: any = {
      lockContentTreeSpace: jest.fn().mockImplementation(async (transaction: any) => Object.assign(transaction, {
        contentTreeRevision: 0n,
      })),
      advanceContentTreeRevision: jest.fn().mockResolvedValue(1n),
      advance: jest.fn().mockResolvedValue({ revisionId: 'sync-1' }),
      advanceStructuralPages: jest.fn().mockResolvedValue({ revisionId: 'sync-1' }),
    };
    const syncPaths: any = { allocate: jest.fn() };
    return {
      service: new ContentTreeService(prisma, revisionWriter, syncPaths),
      prisma, tx, revisionWriter, syncPaths, folderById,
    };
  }

  it('renames a complete Folder subtree, records Page aliases first, and advances each revision once', async () => {
    const { service, tx, revisionWriter } = lifecycleHarness();

    const result = await (service as any).renameFolder({
      spaceId: 'space-1', folderId: 'folder-root', name: '新项目',
      expectedTreeRevision: 0n, expectedUpdatedAt: now,
      actor: { userId: 'user-1' },
      now: changedAt,
    });

    const rawSql = tx.$executeRaw.mock.calls.map(([query]: any[]) =>
      Array.isArray(query?.strings) ? query.strings.join(' ') : '');
    const aliasUpsert = rawSql.findIndex((sql: string) => sql.includes('INSERT INTO "PagePathAlias"'));
    const pageUpdate = rawSql.findIndex((sql: string) => sql.includes('UPDATE "Page"'));
    expect(aliasUpsert).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(tx.$executeRaw.mock.calls[aliasUpsert][0].values)).toContain(page.path);
    expect(pageUpdate).toBeGreaterThan(aliasUpsert);
    expect(revisionWriter.advanceContentTreeRevision).toHaveBeenCalledTimes(1);
    expect(revisionWriter.advanceStructuralPages).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      treeRevision: 1n,
      folder: expect.objectContaining({ id: 'folder-root', path: 'pages/新项目' }),
    }));
  });

  it('refreshes a reused Page alias with one upsert before any structural path write', async () => {
    const { service, tx } = lifecycleHarness();

    await (service as any).renameFolder({
      spaceId: 'space-1', folderId: 'folder-root', name: '新项目',
      expectedTreeRevision: 0n, expectedUpdatedAt: now,
      actor: { userId: 'user-1' },
    });

    const rawSql = tx.$executeRaw.mock.calls.map(([query]: any[]) =>
      Array.isArray(query?.strings) ? query.strings.join(' ') : '');
    const aliasUpsert = rawSql.findIndex((sql: string) => sql.includes('INSERT INTO "PagePathAlias"'));
    const pageUpdate = rawSql.findIndex((sql: string) => sql.includes('UPDATE "Page"'));
    expect(aliasUpsert).toBeGreaterThanOrEqual(0);
    expect(pageUpdate).toBeGreaterThan(aliasUpsert);
  });

  it('persists the target timestamp when a normalized rename keeps the same path', async () => {
    const { service, tx, revisionWriter } = lifecycleHarness([root]);

    await (service as any).renameFolder({
      spaceId: 'space-1', folderId: 'folder-root', name: root.name,
      expectedTreeRevision: 0n, expectedUpdatedAt: now,
      actor: { userId: 'user-1' },
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(revisionWriter.advanceContentTreeRevision).toHaveBeenCalledTimes(1);
    expect(revisionWriter.advanceStructuralPages).toHaveBeenCalledTimes(1);
  });

  it('rejects stale Folder updatedAt before aliases or structural writes', async () => {
    const { service, tx } = lifecycleHarness([{ ...root, updatedAt: changedAt }]);

    await expect((service as any).renameFolder({
      spaceId: 'space-1', folderId: 'folder-root', name: '新项目',
      expectedTreeRevision: 0n, expectedUpdatedAt: now,
      actor: { userId: 'user-1' },
    })).rejects.toBeInstanceOf(ContentTreeConflict);
    expect(tx.pagePathAlias.createMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects moving a Folder into itself or its descendant', async () => {
    const { service, tx } = lifecycleHarness();

    await expect((service as any).moveNode({
      spaceId: 'space-1', kind: 'folder', nodeId: 'folder-root',
      targetFolderId: 'folder-child', expectedTreeRevision: 0n,
      expectedUpdatedAt: now, actor: { userId: 'user-1' },
    })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_CYCLE' }));
    expect(tx.pagePathAlias.createMany).not.toHaveBeenCalled();
  });

  it('rejects a move to depth 33 before aliases or structural writes', async () => {
    const { service, tx } = lifecycleHarness([root]);
    tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([root])
      .mockResolvedValueOnce([root])
      .mockResolvedValueOnce(Array.from({ length: 32 }, (_, depth) => ({ depth })));

    await expect((service as any).moveNode({
      spaceId: 'space-1', kind: 'folder', nodeId: 'folder-root',
      targetFolderId: 'folder-target', expectedTreeRevision: 0n,
      expectedUpdatedAt: now, actor: { userId: 'user-1' },
    })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_DEPTH_LIMIT' }));
    expect(tx.pagePathAlias.createMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('validates every rewritten descendant path before writing', async () => {
    const { service, tx, folderById } = lifecycleHarness();
    const longPortableTarget = `pages/${Array.from({ length: 4 }, () => 'a'.repeat(250)).join('/')}`;
    folderById.set('folder-target', {
      ...folderById.get('folder-target'),
      path: longPortableTarget,
      pathKey: longPortableTarget,
    });

    await expect((service as any).moveNode({
      spaceId: 'space-1', kind: 'folder', nodeId: 'folder-root',
      targetFolderId: 'folder-target', expectedTreeRevision: 0n,
      expectedUpdatedAt: now, actor: { userId: 'user-1' },
    })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_PATH_TOO_LONG' }));
    expect(tx.pagePathAlias.createMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not disclose a cross-Space move target', async () => {
    const { service, tx, folderById } = lifecycleHarness();
    folderById.delete('folder-target');

    await expect((service as any).moveNode({
      spaceId: 'space-1', kind: 'folder', nodeId: 'folder-root',
      targetFolderId: 'folder-target', expectedTreeRevision: 0n,
      expectedUpdatedAt: now, actor: { userId: 'user-1' },
    })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_NOT_FOUND' }));
    expect(tx.pagePathAlias.createMany).not.toHaveBeenCalled();
  });

  it('moves a Page with deterministic allocation, old-path aliasing, and direct-sibling ordering', async () => {
    const { service, tx, syncPaths, revisionWriter } = lifecycleHarness([page]);
    syncPaths.allocate.mockResolvedValue({
      path: 'pages/目标/进度 (2).md', pathKey: 'pages/目标/进度 (2).md',
    });

    const result = await (service as any).moveNode({
      spaceId: 'space-1', kind: 'page', nodeId: 'page-1',
      targetFolderId: 'folder-target', expectedTreeRevision: 0n,
      expectedUpdatedAt: now, actor: { agentId: 'agent-1' },
    });

    expect(syncPaths.allocate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      spaceId: 'space-1', directory: 'pages/目标', title: '进度', excludePageId: 'page-1',
    }), expect.any(Set));
    const aliasPayload = tx.$executeRaw.mock.calls
      .map(([query]: any[]) => query)
      .find((query: any) => Array.isArray(query?.strings)
        && query.strings.join(' ').includes('INSERT INTO "PagePathAlias"'));
    expect(JSON.stringify(aliasPayload?.values)).toContain(page.path);
    expect(revisionWriter.advanceContentTreeRevision).toHaveBeenCalledTimes(1);
    expect(revisionWriter.advanceStructuralPages).toHaveBeenCalledTimes(1);
    expect(result.node).toEqual(expect.objectContaining({
      id: 'page-1', folderId: 'folder-target', path: 'pages/目标/进度 (2).md',
    }));
  });

  it('rejects an invalid or ambiguous restore strategy object before opening a transaction', async () => {
    const { service, prisma } = lifecycleHarness();
    const invalid = [
      {},
      { kind: 'original', name: 'unexpected' },
      { kind: 'root', name: 'unexpected' },
      { kind: 'rename-root' },
      { kind: 'rename-root', name: 'Renamed', extra: true },
      { kind: 'unknown' },
    ];

    for (const strategy of invalid) {
      await expect((service as any).restoreDeletionBatch({
        spaceId: 'space-1', deletionBatchId: 'batch-1', strategy,
        expectedTreeRevision: 0n, actor: { userId: 'user-1' },
      })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_RESTORE_CONFLICT' }));
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects restore when active plus restoring Folders would exceed the Space cap', async () => {
    const deletedAt = new Date('2026-08-28T02:00:00.000Z');
    const deletedRoot = { ...root, deletedAt, deletionBatchId: 'batch-1' };
    const deletedChild = { ...child, deletedAt, deletionBatchId: 'batch-1' };
    const { service, tx, revisionWriter } = lifecycleHarness([deletedRoot, deletedChild]);
    tx.folder.count = jest.fn().mockResolvedValue(10_000);
    tx.folder.findMany.mockImplementation(({ where }: any) => Promise.resolve(
      where.deletionBatchId ? [deletedRoot, deletedChild] : [],
    ));
    tx.page.findMany.mockResolvedValue([]);
    tx.contentDeletionBatch.findFirst.mockResolvedValue({
      id: 'batch-1', rootFolderId: root.id, folderCount: 2, pageCount: 0,
      impactHash: 'ceed93e2f001cc6f668bd6ca31e104548fa1e406a5514ecda3af3a757242dbee',
      createdAt: deletedAt,
      folders: [{ id: root.id }, { id: child.id }], pages: [],
    });
    tx.contentDeletionBatch.updateMany.mockResolvedValue({ count: 1 });

    await expect((service as any).restoreDeletionBatch({
      spaceId: 'space-1', deletionBatchId: 'batch-1',
      strategy: { kind: 'original' }, expectedTreeRevision: 0n,
      actor: { userId: 'user-1' },
    })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_COUNT_LIMIT' }));
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(revisionWriter.advanceContentTreeRevision).not.toHaveBeenCalled();
    expect(revisionWriter.advance).not.toHaveBeenCalled();
    expect(revisionWriter.advanceStructuralPages).not.toHaveBeenCalled();
  });

  it('rejects uniformly shifted deletion timestamps before any restore write', async () => {
    const batchCreatedAt = new Date('2026-08-28T02:00:00.000Z');
    const shiftedDeletedAt = new Date('2026-08-28T03:00:00.000Z');
    const deletedRoot = {
      ...root,
      nameKey: '项目',
      deletedAt: shiftedDeletedAt,
      deletionBatchId: 'batch-1',
    };
    const deletedChild = {
      ...child,
      nameKey: '周报',
      deletedAt: shiftedDeletedAt,
      deletionBatchId: 'batch-1',
    };
    const { service, tx, revisionWriter } = lifecycleHarness([deletedRoot, deletedChild]);
    tx.folder.count = jest.fn().mockResolvedValue(0);
    tx.folder.findMany.mockImplementation(({ where }: any) => Promise.resolve(
      where.deletionBatchId ? [deletedRoot, deletedChild] : [],
    ));
    tx.page.findMany.mockResolvedValue([]);
    tx.contentDeletionBatch.findFirst.mockResolvedValue({
      id: 'batch-1', rootFolderId: root.id, folderCount: 2, pageCount: 0,
      impactHash: 'ceed93e2f001cc6f668bd6ca31e104548fa1e406a5514ecda3af3a757242dbee',
      createdAt: batchCreatedAt,
      folders: [{ id: root.id }, { id: child.id }], pages: [],
    });
    tx.contentDeletionBatch.updateMany.mockResolvedValue({ count: 1 });

    await expect((service as any).restoreDeletionBatch({
      spaceId: 'space-1', deletionBatchId: 'batch-1',
      strategy: { kind: 'original' }, expectedTreeRevision: 0n,
      actor: { userId: 'user-1' },
    })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_RESTORE_CONFLICT' }));
    expect(tx.contentDeletionBatch.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ createdAt: true }),
    }));
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.contentDeletionBatch.updateMany).not.toHaveBeenCalled();
    expect(revisionWriter.advanceContentTreeRevision).not.toHaveBeenCalled();
    expect(revisionWriter.advanceStructuralPages).not.toHaveBeenCalled();
  });
});
