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
