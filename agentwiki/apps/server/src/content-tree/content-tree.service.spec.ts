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
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
  };
  const prisma: any = {
    $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)),
    space: { findUnique: jest.fn() },
    folder: { findMany: jest.fn() },
    page: { findMany: jest.fn() },
  };
  const revisionWriter: any = {
    lockSpace: jest.fn().mockImplementation(async (transaction: any) => Object.assign(transaction, {
      contentTreeRevision: options.treeRevision ?? 0n,
    })),
    advanceContentTreeRevision: jest.fn().mockImplementation(async (_tx: any, _spaceId: string, expected: bigint) => expected + 1n),
    advance: jest.fn().mockResolvedValue({ revisionId: 'sync-revision-1', sequence: 1 }),
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

  it('lists only direct children with Folder-first deterministic cursor pagination and hasChildren', async () => {
    const { service, prisma } = makeHarness();
    prisma.space.findUnique.mockResolvedValue({ contentTreeRevision: 9n });
    prisma.folder.findMany
      .mockResolvedValueOnce([
        { id: 'f1', name: 'A', path: 'pages/A', sortOrder: 0, createdAt: now, updatedAt: now, _count: { children: 1, pages: 0 } },
        { id: 'f2', name: 'B', path: 'pages/B', sortOrder: 1, createdAt: now, updatedAt: now, _count: { children: 0, pages: 0 } },
      ])
      .mockResolvedValueOnce([]);
    prisma.page.findMany
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
    expect(prisma.folder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ spaceId: 'space-1', parentId: null, deletedAt: null }),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }));
  });

  it('binds a cursor to its Space and parent location', async () => {
    const { service, prisma } = makeHarness();
    prisma.space.findUnique.mockResolvedValue({ contentTreeRevision: 0n });
    prisma.folder.findMany.mockResolvedValue([
      { id: 'f1', name: 'A', path: 'pages/A', sortOrder: 0, createdAt: now, updatedAt: now, _count: { children: 0, pages: 0 } },
      { id: 'f2', name: 'B', path: 'pages/B', sortOrder: 1, createdAt: now, updatedAt: now, _count: { children: 0, pages: 0 } },
    ]);
    prisma.page.findMany.mockResolvedValue([]);
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
});

describe('ContentTreeService Page placement and concurrency', () => {
  it('places a Page in a same-Space Folder and advances both revisions', async () => {
    const { service, tx, syncPaths, revisionWriter } = makeHarness();
    tx.folder.findFirst.mockResolvedValue({ id: 'folder-1', path: 'pages/项目' });
    tx.page.findFirst.mockResolvedValue({
      id: 'page-1', title: '周报', content: 'body', syncPath: 'pages/周报.md', updatedAt: now,
    });
    syncPaths.allocate.mockResolvedValue({ path: 'pages/项目/周报.md', pathKey: 'pages/项目/周报.md' });
    tx.page.update.mockResolvedValue({ id: 'page-1', folderId: 'folder-1', syncPath: 'pages/项目/周报.md', updatedAt: now });

    const result = await service.placePage({
      spaceId: 'space-1', pageId: 'page-1', folderId: 'folder-1', expectedTreeRevision: 0n,
      expectedUpdatedAt: now, actor: { userId: 'user-1' },
    });

    expect(syncPaths.allocate).toHaveBeenCalledWith(expect.anything(), {
      spaceId: 'space-1', directory: 'pages/项目', title: '周报', excludePageId: 'page-1',
    });
    expect(tx.page.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'page-1' },
      data: expect.objectContaining({ folderId: 'folder-1', syncPath: 'pages/项目/周报.md' }),
    }));
    expect(revisionWriter.advance).toHaveBeenCalledWith(tx, 'space-1', [expect.objectContaining({
      operation: 'upsert', pageId: 'page-1', path: 'pages/项目/周报.md', body: 'body',
    })], expect.anything());
    expect(result.treeRevision).toBe(1n);
  });

  it('does not disclose a cross-Space target Folder', async () => {
    const { service, tx } = makeHarness();
    tx.folder.findFirst.mockResolvedValue(null);
    await expect(service.placePage({
      spaceId: 'space-1', pageId: 'page-1', folderId: 'other-space-folder', expectedTreeRevision: 0n,
      expectedUpdatedAt: now, actor: { userId: 'user-1' },
    })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_NOT_FOUND' }));
    expect(tx.page.update).not.toHaveBeenCalled();
  });

  it('rejects stale Page versions before placement', async () => {
    const { service, tx } = makeHarness();
    tx.page.findFirst.mockResolvedValue({
      id: 'page-1', title: 'P', content: '', syncPath: 'pages/P.md', updatedAt: new Date(now.getTime() + 1),
    });
    await expect(service.placePage({
      spaceId: 'space-1', pageId: 'page-1', folderId: null, expectedTreeRevision: 0n,
      expectedUpdatedAt: now, actor: { userId: 'user-1' },
    })).rejects.toBeInstanceOf(ContentTreeConflict);
    expect(tx.page.update).not.toHaveBeenCalled();
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
      lockSpace: jest.fn().mockImplementation(async (transaction: any) => Object.assign(transaction, { contentTreeRevision: currentRevision })),
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
