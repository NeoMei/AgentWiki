import { BadRequestException } from '@nestjs/common';
import { pathKey, scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { ReviewService } from './review.service';
import {
  safeMarkdownBasename,
  syncPathDirectory,
} from '../core/sync/readable-sync-path.service';

function makeReviewContentTree(revisionWriter: any, syncPaths: any) {
  return {
    lockPageMutationSpace: jest.fn(async (tx: any, spaceId: string) => Object.assign(
      await revisionWriter.lockSpace?.(tx, spaceId) ?? tx,
      { contentTreeRevision: 0n },
    )),
    placePage: jest.fn(async (tx: any, input: any) => {
      const allocated = await syncPaths.allocate(tx, {
        spaceId: input.spaceId, directory: 'pages', title: input.title,
      });
      return { folderId: input.folderId, syncPath: allocated.path, syncPathKey: allocated.pathKey };
    }),
    preparePageMutation: jest.fn(async (tx: any, input: any) => {
      const changed = input.folderId !== input.current.folderId
        || safeMarkdownBasename(input.title) !== safeMarkdownBasename(input.current.title);
      if (!changed) {
        return {
          folderId: input.folderId,
          syncPath: input.current.syncPath,
          syncPathKey: input.current.syncPathKey,
        };
      }
      const allocated = await syncPaths.allocate(tx, {
        spaceId: input.spaceId,
        directory: syncPathDirectory(input.current.syncPath),
        title: input.title,
        excludePageId: input.pageId,
      });
      return { folderId: input.folderId, syncPath: allocated.path, syncPathKey: allocated.pathKey };
    }),
    prepareExactPageMutation: jest.fn(async (_tx: any, input: any) => ({
      folderId: input.folderId ?? null,
      syncPath: input.syncPath,
      syncPathKey: pathKey(input.syncPath),
    })),
    advancePageMutation: jest.fn(async (tx: any, input: any) => {
      if (!input.existingSyncRevisionId) {
        await revisionWriter.advance(tx, input.spaceId, input.changes, {
          origin: input.actor.agentId ? 'change_set' : 'web_editor',
          createdByUserId: input.actor.userId ?? null,
          ...input.revisionOrigin,
        });
      }
      return {
        treeRevision: input.expectedTreeRevision,
        syncRevisionId: input.existingSyncRevisionId ?? 'sync-1',
      };
    }),
    mapLegacyPageParent: jest.fn().mockRejectedValue({ businessCode: 'PAGE_PARENT_DEPRECATED' }),
    lockFolderMutationSpace: jest.fn(async (tx: any) => Object.assign(tx, {
      contentTreeRevision: 0n,
    })),
    createFolder: jest.fn(),
    renameFolder: jest.fn(),
    moveNode: jest.fn(),
    deleteFolder: jest.fn(),
    restoreDeletionBatch: jest.fn(),
  };
}

describe('ReviewService queue presentation', () => {
  const prisma = { changeSet: { count: jest.fn(), findMany: jest.fn() } } as any;
  const service = new ReviewService(prisma, {} as any, {} as any, {} as any, { enqueue: jest.fn() } as any);

  beforeEach(() => jest.clearAllMocks());

  it('counts only pending review sets in accessible spaces', async () => {
    prisma.changeSet.count.mockResolvedValue(2);
    await expect(service.countPending(['space-1', 'space-2'])).resolves.toEqual({ pending: 2 });
    expect(prisma.changeSet.count).toHaveBeenCalledWith({
      where: { spaceId: { in: ['space-1', 'space-2'] }, status: 'pending_review' },
    });
  });

  it('orders pending and approved work before historical states, newest first within status', async () => {
    prisma.changeSet.findMany.mockResolvedValue([
      { id: 'published', status: 'published', createdAt: new Date('2026-08-19T10:00:00Z') },
      { id: 'pending-old', status: 'pending_review', createdAt: new Date('2026-08-19T09:00:00Z') },
      { id: 'pending-new', status: 'pending_review', createdAt: new Date('2026-08-19T11:00:00Z') },
    ]);
    await expect(service.list(['space-1'])).resolves.toMatchObject([
      { id: 'pending-new' }, { id: 'pending-old' }, { id: 'published' },
    ]);
  });
});

describe('ReviewService approval boundaries', () => {
  const prisma = {
    changeItem: { count: jest.fn(), updateMany: jest.fn() },
    changeSet: { updateMany: jest.fn(), findUnique: jest.fn() },
    approval: { create: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const search = { indexPage: jest.fn().mockResolvedValue({ lexicalIndexed: true, semanticIndexed: false }) } as any;
  const graphMaintenance = { enqueue: jest.fn() } as any;
  const syncPaths = { allocate: jest.fn() } as any;
  const revisionWriter = {
    advance: jest.fn(),
    lockSpace: jest.fn(),
    finalizeExistingTreeV2Locked: jest.fn().mockResolvedValue({ revisionId: 'submission-revision-1' }),
  } as any;
  revisionWriter.advanceLocked = revisionWriter.advance;
  const contentTree = {
    lockPageMutationSpace: jest.fn(),
    placePage: jest.fn(),
    preparePageMutation: jest.fn(),
    prepareExactPageMutation: jest.fn(),
    advancePageMutation: jest.fn(),
    mapLegacyPageParent: jest.fn(),
  } as any;
  const service = new (ReviewService as any)(
    prisma,
    search,
    revisionWriter,
    syncPaths,
    graphMaintenance,
    contentTree,
  ) as ReviewService;

  beforeEach(() => {
    jest.clearAllMocks();
    syncPaths.allocate.mockResolvedValue({
      path: 'pages/Generated.md',
      pathKey: pathKey('pages/Generated.md'),
    });
    revisionWriter.lockSpace.mockImplementation(async (tx: unknown) => tx);
    contentTree.lockPageMutationSpace.mockImplementation(async (tx: any, spaceId: string) =>
      Object.assign(await revisionWriter.lockSpace(tx, spaceId), { contentTreeRevision: 0n }));
    contentTree.placePage.mockImplementation(async (tx: any, input: any) => {
      const allocated = await syncPaths.allocate(tx, {
        spaceId: input.spaceId, directory: 'pages', title: input.title,
      });
      return { folderId: input.folderId, syncPath: allocated.path, syncPathKey: allocated.pathKey };
    });
    contentTree.preparePageMutation.mockImplementation(async (tx: any, input: any) => {
      const allocated = await syncPaths.allocate(tx, {
        spaceId: input.spaceId,
        directory: input.current.syncPath.slice(0, input.current.syncPath.lastIndexOf('/')),
        title: input.title,
        excludePageId: input.pageId,
      });
      return { folderId: input.folderId, syncPath: allocated.path, syncPathKey: allocated.pathKey };
    });
    contentTree.prepareExactPageMutation.mockImplementation(async (_tx: any, input: any) => ({
      folderId: input.folderId ?? null,
      syncPath: input.syncPath,
      syncPathKey: pathKey(input.syncPath),
    }));
    contentTree.advancePageMutation.mockImplementation(async (tx: any, input: any) => {
      if (!input.existingSyncRevisionId) {
        await revisionWriter.advance(tx, input.spaceId, input.changes, {
          origin: input.actor.agentId ? 'change_set' : 'web_editor',
          createdByUserId: input.actor.userId ?? null,
          ...input.revisionOrigin,
        });
      }
      return {
        treeRevision: input.expectedTreeRevision + (input.structural ? 1n : 0n),
        syncRevisionId: input.existingSyncRevisionId ?? 'sync-1',
      };
    });
    contentTree.mapLegacyPageParent.mockResolvedValue('folder-mapped');
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    prisma.changeSet.updateMany.mockResolvedValue({ count: 1 });
  });

  it('refuses approval while any item is still pending', async () => {
    prisma.changeItem.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    await expect(service.approve('cs-1', 'user-1')).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.changeSet.updateMany).not.toHaveBeenCalled();
  });

  it('refuses approval when every item was rejected', async () => {
    prisma.changeItem.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    await expect(service.approve('cs-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns CHANGESET_INVALID_STATE with 409 for a stale publish request', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-stale-publish', status: 'published', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [], approvals: [], space: {}, run: null,
    });

    await expect(service.publish('cs-stale-publish')).rejects.toMatchObject({
      businessCode: 'CHANGESET_INVALID_STATE',
      statusCode: 409,
    });
  });

  it.each(['draft', 'pending_review'])('keeps APPROVAL_REQUIRED with 403 for an unapproved %s publish request', async (status) => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: `cs-${status}`, status, spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [], approvals: [], space: {}, run: null,
    });

    await expect(service.publish(`cs-${status}`)).rejects.toMatchObject({
      businessCode: 'APPROVAL_REQUIRED',
      statusCode: 403,
    });
  });

  it('returns CHANGESET_INVALID_STATE with 409 for a stale revert request', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-stale-revert', status: 'reverted', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [], approvals: [], space: {}, run: null,
    });

    await expect(service.revert('cs-stale-revert', '0')).rejects.toMatchObject({
      businessCode: 'CHANGESET_INVALID_STATE',
      statusCode: 409,
    });
  });

  it('rejects a structural Page publication that omits the caller tree revision', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-missing-tree-cas', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'create', type: 'create_page', status: 'accepted',
        payload: { title: 'No CAS', content: '# No CAS' },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        create: jest.fn().mockResolvedValue({ id: 'page-1' }),
        findUnique: jest.fn().mockResolvedValue({ title: 'No CAS', content: '# No CAS', deletedAt: null }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-missing-tree-cas')).rejects.toMatchObject({
      businessCode: 'CONTENT_TREE_CONFLICT',
    });
    expect(tx.page.create).not.toHaveBeenCalled();
  });

  it('publishes only explicitly accepted items', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [
        { id: 'accepted', type: 'create_page', status: 'accepted', payload: { title: 'A', content: 'ok', expectedTreeRevision: '0' } },
        { id: 'pending', type: 'create_page', status: 'pending', payload: { title: 'B', content: 'no' } },
        { id: 'rejected', type: 'create_page', status: 'rejected', payload: { title: 'C', content: 'no' } },
      ], approvals: [], space: {}, run: null,
    });
    const tx = {
      page: { create: jest.fn().mockResolvedValue({ id: 'page-1' }), findUnique: jest.fn().mockResolvedValue({ title: 'A', content: 'ok', deletedAt: null }), findMany: jest.fn().mockResolvedValue([]) },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await service.publish('cs-1');
    expect(tx.page.create).toHaveBeenCalledTimes(1);
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'accepted' } }));
  });

  it('publishes a Folder-placed Page through the ContentTree lock, placement, and structural revision boundary', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-folder', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'create-folder-page', type: 'create_page', status: 'accepted',
        payload: {
          title: '周报', content: '# 周报', folderId: 'folder-1', expectedTreeRevision: '4',
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const created = {
      id: 'page-1', knowledgeKey: 'knowledge-1', title: '周报', content: '# 周报',
      folderId: 'folder-1', syncPath: 'pages/项目/周报.md', deletedAt: null,
    };
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
        findMany: jest.fn().mockResolvedValue([created]),
      },
      pageSearchDocument: { deleteMany: jest.fn() },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    contentTree.placePage.mockResolvedValueOnce({
      folderId: 'folder-1', syncPath: 'pages/项目/周报.md', syncPathKey: 'pages/项目/周报.md',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-folder');

    expect(contentTree.lockPageMutationSpace).toHaveBeenCalledWith(tx, 'space-1', 4n);
    expect(contentTree.placePage).toHaveBeenCalledWith(tx, expect.objectContaining({
      title: '周报', folderId: 'folder-1', pageId: expect.any(String),
    }));
    expect(tx.page.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      parentId: null, folderId: 'folder-1', syncPath: 'pages/项目/周报.md',
    }) });
    expect(contentTree.advancePageMutation).toHaveBeenCalledWith(tx, expect.objectContaining({
      expectedTreeRevision: 4n,
      structural: true,
      changes: [expect.objectContaining({ folderId: 'folder-1', path: 'pages/项目/周报.md' })],
    }));
  });

  it('publishes an explicit legacy root parent at the Folder root without an unsafe mapping lookup', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-legacy-root', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'create-legacy-root', type: 'create_page', status: 'accepted',
        payload: { title: 'Root', content: '# Root', parentId: null, expectedTreeRevision: '4' },
      }],
      approvals: [], space: {}, run: null,
    });
    const created = {
      id: 'page-1', knowledgeKey: 'knowledge-1', title: 'Root', content: '# Root',
      folderId: null, syncPath: 'pages/Root.md', deletedAt: null,
    };
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
        findMany: jest.fn().mockResolvedValue([created]),
      },
      pageSearchDocument: { deleteMany: jest.fn() },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    contentTree.placePage.mockResolvedValueOnce({
      folderId: null, syncPath: 'pages/Root.md', syncPathKey: 'pages/root.md',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const previous = process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
    process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = 'true';
    try {
      await service.publish('cs-legacy-root');
      expect(contentTree.mapLegacyPageParent).not.toHaveBeenCalled();
      expect(contentTree.placePage).toHaveBeenCalledWith(tx, expect.objectContaining({
        folderId: null,
      }));
    } finally {
      if (previous === undefined) delete process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
      else process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = previous;
    }
  });

  it('binds a structural submission publication to its one prebuilt Sync revision', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-submission', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'create-submission-page', type: 'create_page', status: 'accepted',
        payload: { title: 'Imported', content: '# Imported', folderId: 'folder-1', expectedTreeRevision: '6' },
      }],
      approvals: [], space: {}, run: null,
    });
    const created = {
      id: 'page-1', knowledgeKey: 'knowledge-1', title: 'Imported', content: '# Imported',
      folderId: 'folder-1', syncPath: 'pages/项目/Imported.md', deletedAt: null,
    };
    const submission = {
      id: 'submission-1', bundle: { pages: [], memories: [], relations: [] },
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'recipe-1', contentHash: 'hash-1',
    };
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
        findMany: jest.fn().mockResolvedValue([created]),
      },
      pageSearchDocument: { deleteMany: jest.fn() },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      knowledgeSubmission: {
        findUnique: jest.fn().mockResolvedValue(submission),
        update: jest.fn(),
      },
    };
    contentTree.placePage.mockResolvedValueOnce({
      folderId: 'folder-1', syncPath: 'pages/项目/Imported.md',
      syncPathKey: 'pages/项目/imported.md',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const originalCreateKnowledgeRevision = (service as any).createKnowledgeRevision;
    (service as any).createKnowledgeRevision = jest.fn().mockResolvedValue({ id: 'submission-revision-1' });
    try {
      await service.publish('cs-submission');
      expect(contentTree.advancePageMutation).toHaveBeenCalledWith(tx, expect.objectContaining({
        expectedTreeRevision: 6n,
        structural: true,
        existingSyncRevisionId: 'submission-revision-1',
      }));
      expect(revisionWriter.advance).not.toHaveBeenCalled();
      expect(tx.knowledgeSubmission.update).toHaveBeenCalledWith({
        where: { id: 'submission-1' },
        data: { status: 'published', appliedRevisionId: 'submission-revision-1' },
      });
    } finally {
      (service as any).createKnowledgeRevision = originalCreateKnowledgeRevision;
    }
  });

  it('finalizes a submission revision even when a memory-only publication has zero Page IDs', async () => {
    const updatedAt = new Date('2026-08-29T01:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-memory-submission', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'memory-item', type: 'upsert_space_memory', status: 'accepted',
        payload: {
          knowledgeKey: 'memory-1', key: 'decision', value: 'Keep it', contentHash: 'a'.repeat(64),
          expectedUpdatedAt: updatedAt.toISOString(),
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const submission = {
      id: 'submission-memory', bundle: { pages: [], memories: [], relations: [] },
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'recipe-1', contentHash: 'hash-1',
    };
    const memory = {
      id: 'memory-1', spaceId: 'space-1', updatedAt,
      type: 'decision', content: 'Old', contentHash: 'b'.repeat(64),
      visibility: 'space', status: 'active', archivedAt: null, deletedAt: null,
    };
    const tx = {
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn(), updateMany: jest.fn() },
      agentMemory: {
        findUnique: jest.fn().mockResolvedValue(memory),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      knowledgeSubmission: {
        findUnique: jest.fn().mockResolvedValue(submission),
        update: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const originalCreateKnowledgeRevision = (service as any).createKnowledgeRevision;
    (service as any).createKnowledgeRevision = jest.fn().mockResolvedValue({ id: 'submission-revision-memory' });
    try {
      await service.publish('cs-memory-submission');
      expect(revisionWriter.finalizeExistingTreeV2Locked).toHaveBeenCalledWith(
        tx, 'space-1', 'submission-revision-memory',
      );
      expect(contentTree.advancePageMutation).not.toHaveBeenCalled();
    } finally {
      (service as any).createKnowledgeRevision = originalCreateKnowledgeRevision;
    }
  });

  it('does not bind a submission when the shared revision finalizer rejects its retained chain', async () => {
    const updatedAt = new Date('2026-08-29T01:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-invalid-chain', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'memory-item', type: 'upsert_space_memory', status: 'accepted',
        payload: {
          knowledgeKey: 'memory-1', key: 'decision', value: 'Keep it', contentHash: 'a'.repeat(64),
          expectedUpdatedAt: updatedAt.toISOString(),
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn(), updateMany: jest.fn() },
      agentMemory: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'memory-1', spaceId: 'space-1', updatedAt,
          type: 'decision', content: 'Old', contentHash: 'b'.repeat(64),
          visibility: 'space', status: 'active', archivedAt: null, deletedAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      knowledgeSubmission: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'submission-invalid-chain', bundle: { pages: [], memories: [], relations: [] },
          schemaVersion: 'knowledge-bundle@1', recipeVersion: 'recipe-1', contentHash: 'hash-1',
        }),
        update: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const originalCreateKnowledgeRevision = (service as any).createKnowledgeRevision;
    (service as any).createKnowledgeRevision = jest.fn().mockResolvedValue({ id: 'submission-revision-invalid' });
    revisionWriter.finalizeExistingTreeV2Locked.mockRejectedValueOnce(
      Object.assign(new Error('Revision is not available'), { code: 'CONTENT_TREE_REVISION_GONE' }),
    );
    try {
      await expect(service.publish('cs-invalid-chain')).rejects.toMatchObject({
        code: 'CONTENT_TREE_REVISION_GONE',
      });
      expect(tx.knowledgeSubmission.update).not.toHaveBeenCalled();
    } finally {
      (service as any).createKnowledgeRevision = originalCreateKnowledgeRevision;
    }
  });

  it('restores an archived page with the same source identity instead of creating a duplicate', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-restore', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'restore', type: 'create_page', status: 'accepted',
        payload: { sourceId: 'source-1', sourcePath: 'docs/a.md', sourceVersionId: 'version-2', title: 'Restored', content: 'new', expectedTreeRevision: '0' },
      }],
      approvals: [], space: {}, run: null,
    });
    const archivedAt = new Date('2026-08-18T08:00:00Z');
    const archived = {
      id: 'page-existing', spaceId: 'space-1', knowledgeKey: 'knowledge-existing', authorId: 'user-old',
      title: 'Archived', slug: 'archived', content: 'old', format: 'markdown', parentId: null,
      folderId: 'folder-old', deletionBatchId: null,
      sourceChangeSetId: 'cs-old', createdByAgentId: null, lastChangeSetId: 'cs-old',
      lastModifiedByUserId: 'user-old', lastModifiedByAgentId: null, lastModifiedAt: archivedAt,
      sourceId: 'source-1', sourceVersionId: 'version-1', sourcePath: 'docs/a.md',
      syncPath: 'docs/a.md', syncPathKey: 'docs/a.md', deletedAt: archivedAt, updatedAt: archivedAt,
    };
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(archived),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ title: 'Restored', content: 'new', deletedAt: null }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-restore');

    expect(tx.page.create).not.toHaveBeenCalled();
    expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pageId: archived.id, title: 'Archived', content: 'old' }),
    }));
    expect(tx.page.updateMany).toHaveBeenCalledWith({
      where: { id: archived.id, spaceId: 'space-1', deletedAt: archivedAt, updatedAt: archivedAt },
      data: expect.objectContaining({
        title: 'Restored', content: 'new', deletedAt: null,
        sourceId: 'source-1', sourceVersionId: 'version-2', sourcePath: 'docs/a.md',
        sourceChangeSetId: 'cs-old', lastChangeSetId: 'cs-restore',
      }),
    });
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'restore' },
      data: expect.objectContaining({ payload: expect.objectContaining({
        before: expect.objectContaining({
          restoredFromArchive: true, title: 'Archived', slug: 'archived', content: 'old',
          folderId: 'folder-old', deletionBatchId: null,
          sourceChangeSetId: 'cs-old', lastModifiedAt: archivedAt.toISOString(),
        }),
      }) }),
    }));
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'restore' },
      data: expect.objectContaining({
        type: 'update_page', status: 'published', publishedResourceId: archived.id,
      }),
    }));
  });

  it('rejects create_page resurrection of a Folder-deletion-batch Page before Page or alias writes', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-batch-restore', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'restore-batch', type: 'create_page', status: 'accepted',
        payload: {
          sourceId: 'source-1', sourcePath: 'docs/batch.md', sourceVersionId: 'version-2',
          title: 'Forbidden restore', content: 'new', expectedTreeRevision: '0',
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const archivedAt = new Date('2026-08-18T08:00:00Z');
    const archived = {
      id: 'page-batch', spaceId: 'space-1', knowledgeKey: 'knowledge-batch', authorId: 'user-old',
      title: 'Batch archived', slug: 'batch-archived', content: 'old', format: 'markdown',
      parentId: null, folderId: 'folder-deleted', deletionBatchId: 'batch-1',
      sourceChangeSetId: 'cs-old', createdByAgentId: null, lastChangeSetId: 'cs-delete',
      lastModifiedByUserId: 'user-old', lastModifiedByAgentId: null, lastModifiedAt: archivedAt,
      sourceId: 'source-1', sourceVersionId: 'version-1', sourcePath: 'docs/batch.md',
      syncPath: 'pages/Deleted/Batch archived.md',
      syncPathKey: pathKey('pages/Deleted/Batch archived.md'),
      deletedAt: archivedAt, updatedAt: archivedAt,
    };
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(archived),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          ...archived,
          title: 'Forbidden restore',
          deletedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-batch-restore')).rejects.toMatchObject({
      code: 'FOLDER_RESTORE_CONFLICT',
    });

    expect(contentTree.preparePageMutation).not.toHaveBeenCalled();
    expect(tx.pageVersion.create).not.toHaveBeenCalled();
    expect(tx.page.updateMany).not.toHaveBeenCalled();
    expect(tx.changeItem.update).not.toHaveBeenCalled();
  });

  it('allocates a readable path when restoring an archived source page with a non-portable source path', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-readable-restore', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'restore-readable', type: 'create_page', status: 'accepted',
        payload: {
          sourceId: 'source-1', sourcePath: '/legacy-source.md', sourceVersionId: 'version-2',
          title: 'Readable restored', content: 'new', expectedTreeRevision: '0',
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const archivedAt = new Date('2026-08-18T08:00:00Z');
    const archived = {
      id: 'page-existing', spaceId: 'space-1', knowledgeKey: 'knowledge-existing', authorId: 'user-old',
      title: 'Archived', slug: 'archived', content: 'old', format: 'markdown', parentId: null,
      sourceChangeSetId: 'cs-old', createdByAgentId: null, lastChangeSetId: 'cs-old',
      lastModifiedByUserId: 'user-old', lastModifiedByAgentId: null, lastModifiedAt: archivedAt,
      sourceId: 'source-1', sourceVersionId: 'version-1', sourcePath: '/legacy-source.md',
      syncPath: 'guides/Archived.md', syncPathKey: pathKey('guides/Archived.md'),
      deletedAt: archivedAt, updatedAt: archivedAt,
    };
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(archived),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ title: 'Readable restored', content: 'new', deletedAt: null }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    syncPaths.allocate.mockResolvedValueOnce({
      path: 'guides/Readable restored.md',
      pathKey: pathKey('guides/Readable restored.md'),
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-readable-restore');

    expect(tx.page.create).not.toHaveBeenCalled();
    expect(syncPaths.allocate).toHaveBeenCalledWith(tx, {
      spaceId: 'space-1',
      directory: 'guides',
      title: 'Readable restored',
      excludePageId: archived.id,
    });
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        syncPath: 'guides/Readable restored.md',
        syncPathKey: pathKey('guides/Readable restored.md'),
      }),
    }));
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'restore-readable' },
      data: expect.objectContaining({ payload: expect.objectContaining({
        before: expect.objectContaining({
          restoredFromArchive: true,
          syncPath: 'guides/Archived.md',
          syncPathKey: pathKey('guides/Archived.md'),
        }),
      }) }),
    }));
  });

  it('loses a concurrent archive-restoration race instead of overwriting the winner', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-restore-race', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'restore-race', type: 'create_page', status: 'accepted',
        payload: { sourceId: 'source-1', sourcePath: 'docs/a.md', sourceVersionId: 'version-2', title: 'Racing restore', content: 'new', expectedTreeRevision: '0' },
      }],
      approvals: [], space: {}, run: null,
    });
    const archivedAt = new Date('2026-08-18T08:00:00Z');
    const archived = {
      id: 'page-existing', knowledgeKey: 'knowledge-existing', authorId: 'user-old',
      title: 'Archived', slug: 'archived', content: 'old', format: 'markdown', parentId: null,
      sourceChangeSetId: 'cs-old', createdByAgentId: null, lastChangeSetId: 'cs-old',
      lastModifiedByUserId: 'user-old', lastModifiedByAgentId: null, lastModifiedAt: archivedAt,
      sourceId: 'source-1', sourceVersionId: 'version-1', sourcePath: 'docs/a.md',
      syncPath: 'docs/a.md', syncPathKey: 'docs/a.md', deletedAt: archivedAt, updatedAt: archivedAt,
    };
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(archived),
        update: jest.fn().mockResolvedValue({ id: archived.id }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pageVersion: { create: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-restore-race')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
  });

  it('returns a stable conflict when the source identity already belongs to an active page', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-duplicate', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'duplicate', type: 'create_page', status: 'accepted',
        payload: { sourceId: 'source-1', sourcePath: 'docs/a.md', title: 'Duplicate', content: 'new', expectedTreeRevision: '0' },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: { findFirst: jest.fn().mockResolvedValue({ id: 'page-active', deletedAt: null }), create: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-duplicate')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(tx.page.create).not.toHaveBeenCalled();
  });

  it('translates a create race unique violation into a stable change-set conflict', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-race', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'race', type: 'create_page', status: 'accepted',
        payload: { sourceId: 'source-1', sourcePath: 'docs/a.md', title: 'Racing', content: 'new', expectedTreeRevision: '0' },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
      },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-race')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
  });

  it('preserves zero strength and confidence when publishing a relation', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-relation', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'relation', type: 'create_relation', status: 'accepted',
        payload: { sourcePageId: 'page-1', targetPageId: 'page-2', relation: 'supports', strength: 0, confidence: 0 },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      page: { findMany: jest.fn().mockResolvedValue([{ id: 'page-1', spaceId: 'space-1' }, { id: 'page-2', spaceId: 'space-1' }]) },
      knowledgeRelation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'relation-1' }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-relation');

    expect(tx.knowledgeRelation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ strength: 0, confidence: 0 }),
    }));
    expect(graphMaintenance.enqueue).toHaveBeenCalledWith('space-1');
  });

  it('preserves auto_llm origin when an approved graph proposal is published', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-auto-graph', status: 'approved', spaceId: 'space-1', createdByUserId: 'owner-1', createdByAgentId: null,
      items: [{
        id: 'relation', type: 'create_relation', status: 'accepted',
        payload: {
          sourcePageId: 'page-1', targetPageId: 'page-2', relation: 'extends', origin: 'auto_llm',
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      page: { findMany: jest.fn().mockResolvedValue([{ id: 'page-1', spaceId: 'space-1' }, { id: 'page-2', spaceId: 'space-1' }]) },
      knowledgeRelation: { createMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-auto-graph');

    expect(tx.knowledgeRelation.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ origin: 'auto_llm' }),
      skipDuplicates: true,
    }));
  });

  it('skips an auto_llm relation when a human-owned triple already exists', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-auto-conflict', status: 'approved', spaceId: 'space-1', createdByUserId: 'owner-1', createdByAgentId: null,
      items: [{
        id: 'relation', type: 'create_relation', status: 'accepted',
        payload: {
          sourcePageId: 'page-1', targetPageId: 'page-2', relation: 'extends', origin: 'auto_llm',
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      page: { findMany: jest.fn().mockResolvedValue([{ id: 'page-1', spaceId: 'space-1' }, { id: 'page-2', spaceId: 'space-1' }]) },
      knowledgeRelation: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-auto-conflict')).resolves.toMatchObject({ id: 'cs-auto-conflict' });

    expect(tx.knowledgeRelation.create).not.toHaveBeenCalled();
    expect(tx.changeItem.update).toHaveBeenCalledWith({
      where: { id: 'relation' },
      data: { status: 'rejected' },
    });
  });

  it('atomically skips an auto_llm relation created by a concurrent writer', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-auto-race', status: 'approved', spaceId: 'space-1', createdByUserId: 'owner-1', createdByAgentId: null,
      items: [{
        id: 'relation', type: 'create_relation', status: 'accepted',
        payload: {
          sourcePageId: 'page-1', targetPageId: 'page-2', relation: 'extends', origin: 'auto_llm',
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      page: { findMany: jest.fn().mockResolvedValue([{ id: 'page-1', spaceId: 'space-1' }, { id: 'page-2', spaceId: 'space-1' }]) },
      knowledgeRelation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-auto-race')).resolves.toMatchObject({ id: 'cs-auto-race' });

    expect(tx.knowledgeRelation.create).not.toHaveBeenCalled();
    expect(tx.changeItem.update).toHaveBeenCalledWith({
      where: { id: 'relation' },
      data: { status: 'rejected' },
    });
  });

  it('lets a compiled relation take ownership of an automatic triple', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-compiled-takeover', status: 'approved', spaceId: 'space-1', createdByUserId: 'owner-1', createdByAgentId: null,
      items: [{
        id: 'relation', type: 'create_relation', status: 'accepted',
        payload: { sourcePageId: 'page-1', targetPageId: 'page-2', relation: 'extends' },
      }],
      approvals: [], space: {}, run: null,
    });
    const automatic = { id: 'auto-1', origin: 'auto_llm' };
    const tx = {
      spaceGraphState: { upsert: jest.fn().mockResolvedValue({ id: 'state-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      page: { findMany: jest.fn().mockResolvedValue([{ id: 'page-1', spaceId: 'space-1' }, { id: 'page-2', spaceId: 'space-1' }]) },
      knowledgeRelation: {
        findUnique: jest.fn().mockResolvedValue(automatic),
        update: jest.fn().mockResolvedValue({ ...automatic, origin: 'compiled' }),
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-compiled-takeover')).resolves.toMatchObject({ id: 'cs-compiled-takeover' });

    expect(tx.knowledgeRelation.update).toHaveBeenCalledWith({
      where: { id: 'auto-1' },
      data: expect.objectContaining({ origin: 'compiled', sourceChangeSetId: 'cs-compiled-takeover' }),
    });
    expect(tx.knowledgeRelation.create).not.toHaveBeenCalled();
  });

  it('loses a concurrent approval race without creating a duplicate approval', async () => {
    prisma.changeItem.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prisma.changeSet.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approve('cs-1', 'user-1')).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.approval.create).not.toHaveBeenCalled();
  });

  it('rejects a parent change that would create a multi-level page cycle', async () => {
    const tx = {
      page: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ spaceId: 'space-1', parentId: 'page-1' }),
      },
    } as any;
    await expect((service as any).assertValidParent(tx, 'space-1', 'page-2', 'page-1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['create_page', {}],
    ['update_page', { before: { title: 'Before' } }],
    ['archive_page', { before: { deletedAt: null } }],
  ])('rejects reverting a %s item when its page was changed later', async (type, payload) => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-old', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'item-1', type, status: 'published', publishedResourceId: 'page-1', payload }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-old', '0')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(tx.page.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'page-1',
        spaceId: 'space-1',
        lastChangeSetId: 'cs-old',
        updatedAt: { lte: publishedAt },
      }),
    }));
    expect(tx.page.updateMany).not.toHaveBeenCalled();
    expect(tx.pageVersion.create).not.toHaveBeenCalled();
    expect(tx.changeItem.update).not.toHaveBeenCalled();
  });

  it('reverts an unchanged created page owned by the published change set', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [
        { id: 'published', type: 'create_page', status: 'published', publishedResourceId: 'page-1', payload: {} },
        { id: 'rejected', type: 'create_page', status: 'rejected', publishedResourceId: null, payload: {} },
      ], approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'page-1', title: 'A', content: '', authorId: 'user-1', slug: 'a', format: 'markdown',
          parentId: null, syncPath: 'pages/A.md', syncPathKey: 'pages/a.md',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ deletedAt: new Date(), title: 'A', content: '' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await service.revert('cs-1', '0');
    expect(tx.page.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'page-1',
        spaceId: 'space-1',
        sourceChangeSetId: 'cs-1',
        lastChangeSetId: 'cs-1',
        deletedAt: null,
        updatedAt: { lte: publishedAt },
      },
    }));
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
    expect(graphMaintenance.enqueue).toHaveBeenCalledWith('space-1');
  });

  it('reverts a restored page to its complete prior archived state', async () => {
    const publishedAt = new Date('2026-08-19T12:00:00Z');
    const archivedAt = new Date('2026-08-18T08:00:00Z');
    const priorModifiedAt = new Date('2026-08-18T07:00:00Z');
    const before = {
      restoredFromArchive: true,
      title: 'Archived title', slug: 'archived-title', content: 'Archived body', format: 'markdown', parentId: 'parent-old',
      folderId: 'folder-old',
      deletedAt: archivedAt.toISOString(), sourceChangeSetId: 'cs-old', createdByAgentId: 'agent-old',
      deletionBatchId: 'deletion-batch-old',
      lastChangeSetId: 'cs-old', lastModifiedByUserId: null, lastModifiedByAgentId: 'agent-old',
      lastModifiedAt: priorModifiedAt.toISOString(), sourceId: 'source-1', sourceVersionId: 'version-1',
      sourcePath: 'docs/a.md', syncPath: 'pages/Archived title.md',
      syncPathKey: pathKey('pages/Archived title.md'),
    };
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-restore', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'restore', type: 'update_page', status: 'published', publishedResourceId: 'page-1', payload: { before } }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'page-1', title: 'Restored title', content: 'Restored body', authorId: 'user-1',
          slug: 'restored-title', format: 'markdown', parentId: null,
          syncPath: 'pages/Restored title.md', syncPathKey: pathKey('pages/Restored title.md'),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ deletedAt: archivedAt, title: 'Archived title', content: 'Archived body' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.revert('cs-restore', '0');

    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'page-1', lastChangeSetId: 'cs-restore', deletedAt: null }),
      data: expect.objectContaining({
        title: 'Archived title', content: 'Archived body', parentId: null,
        folderId: 'folder-old', deletedAt: archivedAt,
        deletionBatchId: 'deletion-batch-old',
        sourceChangeSetId: 'cs-old', lastChangeSetId: 'cs-old', lastModifiedAt: priorModifiedAt,
        syncPath: 'pages/Archived title.md', syncPathKey: pathKey('pages/Archived title.md'),
      }),
    }));
    expect(tx.page.updateMany.mock.calls[0][0].where).not.toHaveProperty('sourceChangeSetId');
    expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ syncPath: 'pages/Restored title.md' }),
    }));
  });

  it.each([
    ['update_page', { before: {
      title: 'Before', slug: 'before', content: 'Before body', format: 'markdown',
      folderId: null, syncPath: 'pages/Before.md', syncPathKey: pathKey('pages/Before.md'),
    } }, null],
    ['archive_page', { before: { deletedAt: null } }, { not: null }],
  ])('reverts an unchanged %s item owned by the published change set', async (type, payload, deletedAt) => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'item-1', type, status: 'published', publishedResourceId: 'page-1', payload }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'page-1', title: 'Current', content: 'Current body', authorId: 'user-1', slug: 'current', format: 'markdown',
          parentId: null, syncPath: 'pages/Current.md', syncPathKey: 'pages/current.md',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn() },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-1', '0')).resolves.toMatchObject({ id: 'cs-1' });
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'page-1',
        spaceId: 'space-1',
        lastChangeSetId: 'cs-1',
        deletedAt,
        updatedAt: { lte: publishedAt },
      },
    }));
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['create_relation', {}],
    ['archive_relation', {
      before: {
        id: 'relation-1', relation: 'supports', sourcePageId: 'page-1', targetPageId: 'page-2',
        strength: 1, confidence: 1, origin: 'compiled', sourceChangeSetId: 'cs-source',
        createdByAgentId: null, evidenceId: null, lastModifiedByUserId: null,
        lastModifiedAt: new Date('2026-07-26T08:00:00.000Z'),
      },
    }],
  ])('rejects reverting a %s item when its relation was changed later', async (type, payload) => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-old', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'item-1', type, status: 'published', publishedResourceId: 'relation-1', payload }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      knowledgeRelation: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'relation-1' }),
      },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-old', '0')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    if (type === 'create_relation') {
      expect(tx.knowledgeRelation.deleteMany).toHaveBeenCalledWith({
        where: {
          id: 'relation-1',
          sourceChangeSetId: 'cs-old',
          lastModifiedAt: { lte: publishedAt },
        },
      });
    } else {
      expect(tx.knowledgeRelation.createMany).toHaveBeenCalledWith({
        data: { ...(payload as any).before, id: 'relation-1' },
        skipDuplicates: true,
      });
    }
    expect(tx.changeItem.update).not.toHaveBeenCalled();
  });

  it('reverts an unchanged created relation owned by the published change set', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'item-1', type: 'create_relation', status: 'published', publishedResourceId: 'relation-1', payload: {} }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      knowledgeRelation: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      evidence: { updateMany: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-1', '0')).resolves.toMatchObject({ id: 'cs-1' });
    expect(tx.knowledgeRelation.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'relation-1',
        sourceChangeSetId: 'cs-1',
        lastModifiedAt: { lte: publishedAt },
      },
    });
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
  });

  it('publishes a relation update with prior state and change-set ownership for rollback', async () => {
    const beforeModifiedAt = new Date('2026-07-26T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-update-relation', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'item-1', type: 'update_relation', status: 'accepted',
        payload: {
          relationId: 'relation-1', sourceKnowledgeKey: 'page-key-1',
          targetKnowledgeKey: 'page-key-2', relation: 'contradicts',
          expectedLastModifiedAt: beforeModifiedAt.toISOString(),
        },
      }],
      approvals: [], space: {}, run: null,
    });
    const existing = {
      id: 'relation-1', knowledgeKey: 'relation-key-1', relation: 'supports',
      sourcePageId: 'page-1', targetPageId: 'page-2', strength: 1, confidence: 1,
      origin: 'compiled', sourceChangeSetId: 'cs-before', createdByAgentId: 'agent-before',
      evidenceId: null, lastModifiedByUserId: null, lastModifiedAt: beforeModifiedAt,
      createdAt: new Date('2026-07-25T08:00:00.000Z'),
      sourcePage: { spaceId: 'space-1' }, targetPage: { spaceId: 'space-1' },
    };
    const tx = {
      page: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: 'page-1' })
          .mockResolvedValueOnce({ id: 'page-2' }),
      },
      knowledgeRelation: {
        findUnique: jest.fn().mockResolvedValue(existing),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-update-relation');

    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        payload: expect.objectContaining({
          before: expect.objectContaining({ relation: 'supports', sourceChangeSetId: 'cs-before' }),
        }),
      }),
    }));
    expect(tx.knowledgeRelation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'relation-1', lastModifiedAt: beforeModifiedAt },
      data: expect.objectContaining({
        relation: 'contradicts', sourceChangeSetId: 'cs-update-relation',
        createdByAgentId: 'agent-before', lastModifiedByUserId: 'user-1',
      }),
    }));
  });

  it('reverts an unchanged relation update to its prior state', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    const before = {
      id: 'relation-1', knowledgeKey: 'relation-key-1', relation: 'supports',
      sourcePageId: 'page-1', targetPageId: 'page-2', strength: 1, confidence: 1,
      origin: 'compiled', sourceChangeSetId: 'cs-before', createdByAgentId: 'agent-before',
      evidenceId: null, lastModifiedByUserId: null,
      lastModifiedAt: new Date('2026-07-26T08:00:00.000Z'),
    };
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-update-relation', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'item-1', type: 'update_relation', status: 'published',
        publishedResourceId: 'relation-1', payload: { before },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      knowledgeRelation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-update-relation', '0')).resolves.toMatchObject({ id: 'cs-update-relation' });
    const { id: _id, ...restored } = before;
    expect(tx.knowledgeRelation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'relation-1', sourceChangeSetId: 'cs-update-relation',
        lastModifiedAt: { lte: publishedAt },
      },
      data: restored,
    });
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
  });

  it('reverts created, updated, and archived shared memories without overwriting later changes', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    const before = {
      type: 'preference', content: 'before', importance: 0.5, tags: [], entities: null,
      contentHash: 'before-hash', visibility: 'space', embedding: [], embeddingModel: null,
      status: 'active', sourceEvidenceId: null, sourceMemoryIds: [], expiresAt: null,
      lastAccessedAt: null, agentId: 'agent-1', spaceId: 'space-1', archivedAt: null,
      deletedAt: null,
    };
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-memory', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: null, createdByAgentId: 'agent-1',
      items: [
        {
          id: 'create', type: 'upsert_space_memory', status: 'published',
          publishedResourceId: 'memory-created', payload: { before: null },
        },
        {
          id: 'update', type: 'upsert_space_memory', status: 'published',
          publishedResourceId: 'memory-updated', payload: { before, publishedUpdatedAt: publishedAt.toISOString() },
        },
        {
          id: 'archive', type: 'archive_space_memory', status: 'published',
          publishedResourceId: 'memory-archived', payload: { before },
        },
      ],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      agentMemory: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-memory', '0')).resolves.toMatchObject({ id: 'cs-memory' });
    expect(tx.agentMemory.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'memory-created', spaceId: 'space-1', updatedAt: { lte: publishedAt } },
      data: expect.objectContaining({ status: 'archived', deletedAt: expect.any(Date) }),
    });
    expect(tx.agentMemory.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'memory-updated', spaceId: 'space-1', updatedAt: { lte: publishedAt } },
      data: before,
    });
    expect(tx.agentMemory.updateMany).toHaveBeenNthCalledWith(3, {
      where: { id: 'memory-archived', spaceId: 'space-1', updatedAt: { lte: publishedAt } },
      data: before,
    });
    expect(tx.changeItem.update).toHaveBeenCalledTimes(3);
  });

  it('publishes an existing shared-memory update with optimistic locking and rollback state', async () => {
    const updatedAt = new Date('2026-07-26T08:00:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-memory-update', status: 'approved', spaceId: 'space-1',
      createdByUserId: null, createdByAgentId: 'agent-1',
      items: [{
        id: 'memory-item', type: 'upsert_space_memory', status: 'accepted',
        payload: {
          knowledgeKey: 'memory-1', key: 'preference', value: 'after',
          contentHash: 'after-hash', expectedUpdatedAt: updatedAt.toISOString(),
        },
      }],
      approvals: [], space: {}, run: null,
    });
    (prisma as any).agent = { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) };
    const existing = {
      id: 'memory-1', type: 'preference', content: 'before', importance: 0.5,
      tags: [], entities: null, contentHash: 'before-hash', visibility: 'space',
      embedding: [], embeddingModel: null, status: 'active', sourceEvidenceId: null,
      sourceMemoryIds: [], expiresAt: null, lastAccessedAt: null, agentId: 'agent-1',
      spaceId: 'space-1', createdAt: new Date('2026-07-25T08:00:00.000Z'),
      updatedAt, archivedAt: null, deletedAt: null,
    };
    const tx = {
      agentMemory: {
        findUnique: jest.fn().mockResolvedValue(existing),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-memory-update');

    expect(tx.agentMemory.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'memory-1', spaceId: 'space-1', updatedAt },
      data: expect.objectContaining({ content: 'after', contentHash: 'after-hash' }),
    }));
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'memory-item' },
      data: expect.objectContaining({
        payload: expect.objectContaining({
          before: expect.objectContaining({ content: 'before', contentHash: 'before-hash' }),
        }),
      }),
    }));
  });

  it('restores an unchanged relation archived by the published change set', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    const before = {
      id: 'relation-1', relation: 'supports', sourcePageId: 'page-1', targetPageId: 'page-2',
      strength: 1, confidence: 1, origin: 'compiled', sourceChangeSetId: 'cs-source',
      createdByAgentId: null, evidenceId: 'evidence-1', lastModifiedByUserId: null,
      lastModifiedAt: new Date('2026-07-26T08:00:00.000Z'),
    };
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'item-1', type: 'archive_relation', status: 'published',
        publishedResourceId: 'relation-1', payload: { before },
      }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      knowledgeRelation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      evidence: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-1', '0')).resolves.toMatchObject({ id: 'cs-1' });
    expect(tx.knowledgeRelation.createMany).toHaveBeenCalledWith({
      data: { ...before, id: 'relation-1' },
      skipDuplicates: true,
    });
    expect(tx.evidence.updateMany).toHaveBeenCalledWith({
      where: { id: 'evidence-1', targetRelationId: null },
      data: { targetRelationId: 'relation-1' },
    });
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
  });

  it('rejects restoring an archived relation when its evidence was rebound later', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    const before = {
      id: 'relation-1', relation: 'supports', sourcePageId: 'page-1', targetPageId: 'page-2',
      strength: 1, confidence: 1, origin: 'compiled', sourceChangeSetId: 'cs-source',
      createdByAgentId: null, evidenceId: 'evidence-1', lastModifiedByUserId: null,
      lastModifiedAt: new Date('2026-07-26T08:00:00.000Z'),
    };
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-old', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'item-1', type: 'archive_relation', status: 'published',
        publishedResourceId: 'relation-1', payload: { before },
      }],
      approvals: [], space: {}, run: null,
    });
    const evidenceState = { targetRelationId: 'relation-2' as string | null };
    const tx = {
      knowledgeRelation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      evidence: {
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          if (where.id !== 'evidence-1') return { count: 0 };
          if (where.targetRelationId !== undefined && where.targetRelationId !== evidenceState.targetRelationId) {
            return { count: 0 };
          }
          evidenceState.targetRelationId = data.targetRelationId;
          return { count: 1 };
        }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.revert('cs-old', '0')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(evidenceState.targetRelationId).toBe('relation-2');
    expect(tx.changeItem.update).not.toHaveBeenCalled();
  });

  it('rolls back earlier item mutations when a later item conflicts in the same transaction', async () => {
    const publishedAt = new Date('2026-07-27T08:00:00.000Z');
    const unchangedAt = new Date('2026-07-27T07:59:00.000Z');
    let state = {
      changeSet: { id: 'cs-old', status: 'published' },
      pages: {
        'page-1': {
          id: 'page-1', spaceId: 'space-1', sourceChangeSetId: 'cs-old',
          lastChangeSetId: 'cs-old', deletedAt: null as Date | null, updatedAt: unchangedAt,
        },
        'page-2': {
          id: 'page-2', spaceId: 'space-1', sourceChangeSetId: 'cs-old',
          lastChangeSetId: 'cs-new', deletedAt: null as Date | null, updatedAt: unchangedAt,
        },
      },
      items: {
        'item-1': { status: 'published' },
        'item-2': { status: 'published' },
      },
    };
    const initialState = structuredClone(state);
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-old', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [
        { id: 'item-1', type: 'create_page', status: 'published', publishedResourceId: 'page-1', payload: {} },
        { id: 'item-2', type: 'create_page', status: 'published', publishedResourceId: 'page-2', payload: {} },
      ],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      changeSet: {
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          if (state.changeSet.id !== where.id || state.changeSet.status !== where.status) return { count: 0 };
          state.changeSet.status = data.status;
          return { count: 1 };
        }),
      },
      page: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          const page = state.pages[where.id as keyof typeof state.pages];
          const matches = page
            && page.spaceId === where.spaceId
            && page.sourceChangeSetId === where.sourceChangeSetId
            && page.lastChangeSetId === where.lastChangeSetId
            && page.deletedAt === where.deletedAt
            && page.updatedAt <= where.updatedAt.lte;
          if (!matches) return null;
          return {
            ...page,
            title: 'Current',
            content: 'Current body',
            authorId: 'user-1',
            slug: 'current',
            format: 'markdown',
            parentId: null,
            syncPath: 'pages/Current.md',
            syncPathKey: 'pages/current.md',
          };
        }),
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          const page = state.pages[where.id as keyof typeof state.pages];
          const matches = page
            && page.spaceId === where.spaceId
            && page.sourceChangeSetId === where.sourceChangeSetId
            && page.lastChangeSetId === where.lastChangeSetId
            && page.deletedAt === where.deletedAt
            && page.updatedAt <= where.updatedAt.lte;
          if (!matches) return { count: 0 };
          page.deletedAt = data.deletedAt;
          return { count: 1 };
        }),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      changeItem: {
        update: jest.fn().mockImplementation(async ({ where, data }: any) => {
          state.items[where.id as keyof typeof state.items].status = data.status;
        }),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => {
      const snapshot = structuredClone(state);
      try {
        return await callback(tx);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    });

    await expect(service.revert('cs-old', '0')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(tx.page.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.changeItem.update).toHaveBeenCalledTimes(1);
    expect(state).toEqual(initialState);
  });

  it('publishes an Agent page update with prior state captured for rollback', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-update', status: 'approved', spaceId: 'space-1', createdByUserId: null, createdByAgentId: 'agent-1',
      items: [{ id: 'update', type: 'update_page', status: 'accepted', payload: { pageId: 'page-1', expectedTreeRevision: '0', changes: { title: 'After', content: 'New' } } }],
      approvals: [], space: {}, run: null,
    });
    (prisma as any).agent = { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) };
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'page-1', spaceId: 'space-1', title: 'Before', slug: 'before', content: 'Old',
          parentId: null, format: 'markdown', sourceChangeSetId: null, createdByAgentId: null,
          authorId: 'owner-1', updatedAt: new Date('2026-08-19T10:00:00Z'),
          syncPath: 'pages/Before.md', syncPathKey: pathKey('pages/Before.md'),
        }),
        findUnique: jest.fn().mockResolvedValue({ title: 'After', content: 'New', deletedAt: null }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      pageVersion: { create: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await service.publish('cs-update');
    expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'Before', content: 'Old' }) }));
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ before: expect.objectContaining({ title: 'Before' }) }) }) }));
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'After', sourceChangeSetId: 'cs-update', createdByAgentId: 'agent-1' }) }));
  });

  it('rejects a page update that loses the publication compare-and-set race', async () => {
    const updatedAt = new Date('2026-08-19T10:00:00Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-page-race', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'update', type: 'update_page', status: 'accepted', payload: { pageId: 'page-1', expectedUpdatedAt: updatedAt.toISOString(), expectedTreeRevision: '0', changes: { title: 'After' } } }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'page-1', spaceId: 'space-1', title: 'Before', slug: 'before', content: 'Old',
          parentId: null, format: 'markdown', sourceChangeSetId: null, createdByAgentId: null,
          authorId: 'user-1', updatedAt,
          syncPath: 'pages/Before.md', syncPathKey: pathKey('pages/Before.md'),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pageVersion: { create: jest.fn() },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-page-race')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'page-1', spaceId: 'space-1', deletedAt: null, updatedAt },
    }));
  });

  it('rejects a relation update that loses the publication compare-and-set race', async () => {
    const modifiedAt = new Date('2026-08-19T10:00:00Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-relation-race', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'relation-update', type: 'update_relation', status: 'accepted', payload: {
        relationId: 'relation-1', sourceKnowledgeKey: 'source-key', targetKnowledgeKey: 'target-key',
        relation: 'supports', expectedLastModifiedAt: modifiedAt.toISOString(),
      } }],
      approvals: [], space: {}, run: null,
    });
    const tx = {
      page: { findFirst: jest.fn().mockResolvedValueOnce({ id: 'page-1' }).mockResolvedValueOnce({ id: 'page-2' }) },
      knowledgeRelation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'relation-1', relation: 'related', sourcePageId: 'page-1', targetPageId: 'page-2',
          lastModifiedAt: modifiedAt, sourcePage: { spaceId: 'space-1' }, targetPage: { spaceId: 'space-1' },
          createdAt: new Date('2026-08-18T10:00:00Z'),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      changeItem: { update: jest.fn() },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(service.publish('cs-relation-race')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(tx.knowledgeRelation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'relation-1', lastModifiedAt: modifiedAt },
    }));
  });
});

describe('one-shot review-publish and agent auto-publish', () => {
  const prisma = {
    changeItem: { count: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    changeSet: { updateMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    approval: { create: jest.fn() },
    space: { findUnique: jest.fn() },
    agent: { findUnique: jest.fn() },
    agentCredential: { findFirst: jest.fn() },
    agentGrant: { findUnique: jest.fn() },
    page: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
    evidence: { updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  } as any;
  const search = { indexPage: jest.fn().mockResolvedValue({ lexicalIndexed: true }) } as any;
  const syncPaths = { allocate: jest.fn() } as any;
  const graphMaintenance = { enqueue: jest.fn() } as any;
  const revisionWriter = { advance: jest.fn(), lockSpace: jest.fn() } as any;
  revisionWriter.advanceLocked = revisionWriter.advance;
  const contentTree = makeReviewContentTree(revisionWriter, syncPaths) as any;
  const service = new ReviewService(
    prisma,
    search,
    revisionWriter,
    syncPaths,
    graphMaintenance,
    contentTree,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    syncPaths.allocate.mockResolvedValue({
      path: 'pages/Generated.md',
      pathKey: pathKey('pages/Generated.md'),
    });
    prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
    prisma.changeSet.updateMany.mockResolvedValue({ count: 1 });
  });

  it('reviewPublish accepts pending items, approves and publishes in one call', async () => {
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
      items: [{ id: 'i1', type: 'create_page', status: 'accepted', payload: { title: 'A', content: 'x', expectedTreeRevision: '0' } }],
      approvals: [], space: {}, run: null,
    });
    prisma.page.create.mockResolvedValue({ id: 'page-1' });
    await service.reviewPublish('cs-1', 'reviewer-1');
    expect(prisma.changeItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { changeSetId: 'cs-1', status: 'pending' },
      data: { status: 'accepted' },
    }));
    expect(prisma.approval.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ changeSetId: 'cs-1', reviewerId: 'reviewer-1', decision: 'approved' }),
    }));
    expect(prisma.page.create).toHaveBeenCalled();
  });

  it('reviewPublish refuses a change set not pending review', async () => {
    prisma.changeSet.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reviewPublish('cs-1', 'reviewer-1')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('reviewPublish refuses to approve and publish when no item is accepted', async () => {
    prisma.changeItem.count.mockResolvedValue(0);

    await expect(service.reviewPublish('cs-empty', 'reviewer-1')).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.changeItem.count).toHaveBeenCalledWith({
      where: { changeSetId: 'cs-empty', status: 'accepted' },
    });
    expect(prisma.approval.create).not.toHaveBeenCalled();
  });

  it('uses one canonical Folder scope union for proposal and publish checks', () => {
    expect((service as any).requiredScopesForItems([{ type: 'create_folder' }]))
      .toEqual(['folders:write']);
    expect((service as any).requiredScopesForItems([{ type: 'rename_folder' }]))
      .toEqual(['folders:write']);
    expect((service as any).requiredScopesForItems([{ type: 'move_folder' }]))
      .toEqual(['folders:write']);
    expect((service as any).requiredScopesForItems([{ type: 'delete_folder' }]))
      .toEqual(['folders:write', 'folders:delete']);
    expect((service as any).requiredScopesForItems([{ type: 'restore_folder' }]))
      .toEqual(['folders:write', 'folders:delete']);
  });

  it('publishes an approved Folder create through the already locked ContentTree transaction', async () => {
    const approved = {
      id: 'cs-folder', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'folder-item', type: 'create_folder', status: 'accepted',
        payload: { name: 'Docs', parentId: null, expectedTreeRevision: '0' },
      }],
      approvals: [], space: {}, run: null,
    };
    prisma.changeSet.findUnique
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce({ ...approved, status: 'published' });
    contentTree.createFolder.mockResolvedValue({
      folder: { id: 'folder-1' }, treeRevision: 1n, syncRevisionId: 'revision-1',
    });

    await expect(service.publish('cs-folder')).resolves.toMatchObject({ status: 'published' });

    expect(contentTree.lockFolderMutationSpace).toHaveBeenCalledWith(
      prisma, 'space-1', 0n,
    );
    expect(contentTree.createFolder).toHaveBeenCalledWith({
      spaceId: 'space-1', name: 'Docs', parentId: null, expectedTreeRevision: 0n,
      actor: { userId: 'user-1' },
    }, expect.objectContaining({ contentTreeRevision: 0n }));
    expect(prisma.changeItem.update).toHaveBeenCalledWith({
      where: { id: 'folder-item' },
      data: { status: 'published', publishedResourceId: 'folder-1' },
    });
  });

  it('demotes auto-publish before mutation when the persisted Folder scope is lost', async () => {
    const approved = {
      id: 'cs-folder-race', status: 'approved', spaceId: 'space-1',
      createdByUserId: null, createdByAgentId: 'agent-1',
      items: [{
        id: 'folder-item', type: 'delete_folder', status: 'accepted',
        payload: {
          folderId: 'folder-1', expectedTreeRevision: '0',
          expectedUpdatedAt: '2026-08-29T00:00:00.000Z',
          expectedImpactHash: 'a'.repeat(64), folderCount: 1, pageCount: 0,
        },
      }],
      approvals: [], space: {}, run: null,
    };
    prisma.changeSet.findUnique
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce({ ...approved, status: 'pending_review' });
    prisma.space.findUnique.mockResolvedValue({
      approvalPolicy: 'scoped-auto-publish', deletedAt: null,
    });
    prisma.agent.findUnique.mockResolvedValue({
      status: 'active', revokedAt: null, approvalMode: 'scoped-auto-publish', memoryEnabled: true,
      owner: { deletedAt: null, lockedAt: null },
    });
    prisma.agentCredential.findFirst.mockResolvedValue({
      authorizationId: 'grant-1', revokedAt: null, expiresAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-1', role: 'publisher', folderScopes: ['folders:read', 'folders:write'],
    });
    prisma.$queryRaw.mockResolvedValue([{ id: 'locked' }]);

    await expect(service.publish('cs-folder-race', {
      ownerId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1',
    })).resolves.toMatchObject({ status: 'pending_review' });

    expect(prisma.changeSet.updateMany).toHaveBeenCalledWith({
      where: { id: 'cs-folder-race', status: 'approved' },
      data: { status: 'pending_review', reviewedAt: null },
    });
    expect(contentTree.deleteFolder).not.toHaveBeenCalled();
    expect(contentTree.lockFolderMutationSpace).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked Credential', {
      credential: { authorizationId: 'grant-1', revokedAt: new Date(), expiresAt: null },
      grant: { id: 'grant-1', role: 'editor' },
    }],
    ['downgraded Grant', {
      credential: { authorizationId: 'grant-1', revokedAt: null, expiresAt: null },
      grant: { id: 'grant-1', role: 'reader' },
    }],
  ])('rejects an Agent proposal when its %s changed before the ChangeSet write', async (_case, state) => {
    prisma.space.findUnique.mockResolvedValue({ approvalPolicy: 'always-review', deletedAt: null });
    prisma.agent.findUnique.mockResolvedValue({
      status: 'active', revokedAt: null, approvalMode: 'always-review', memoryEnabled: true,
      owner: { deletedAt: null, lockedAt: null },
    });
    prisma.agentCredential.findFirst.mockResolvedValue(state.credential);
    prisma.agentGrant.findUnique.mockResolvedValue(state.grant);
    prisma.$queryRaw.mockResolvedValue([{ id: 'credential-1' }]);

    await expect(service.propose(
      {
        userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1',
        authorizationId: 'grant-1', agentRole: 'editor',
        scopes: scopesForAgentAccessRole('editor'),
      },
      'space-1', 'Stale proposal', { type: 'create_page', payload: { title: 'A', content: 'x' } },
    )).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });

    expect(prisma.changeSet.create).not.toHaveBeenCalled();
  });

  it('propose auto-publishes when space, agent and credential all allow it', async () => {
    prisma.space.findUnique.mockResolvedValue({ approvalPolicy: 'scoped-auto-publish', deletedAt: null });
    prisma.agent.findUnique.mockImplementation(async ({ select }: any) => select?.ownerId
      ? { ownerId: 'owner-1' }
      : {
        status: 'active', revokedAt: null, approvalMode: 'scoped-auto-publish', memoryEnabled: true,
        owner: { deletedAt: null, lockedAt: null },
    });
    prisma.agentCredential.findFirst.mockResolvedValue({
      authorizationId: 'grant-1', revokedAt: null, expiresAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-1', role: 'publisher',
    });
    prisma.$queryRaw.mockResolvedValue([{ id: 'credential-1' }]);
    prisma.changeSet.create.mockResolvedValue({ id: 'cs-auto', status: 'approved' });
    const autoChangeSet = {
      id: 'cs-auto', status: 'approved', spaceId: 'space-1', createdByUserId: null, createdByAgentId: 'agent-1',
      items: [{ id: 'i1', type: 'create_page', status: 'accepted', payload: { title: 'A', content: 'x', expectedTreeRevision: '0' } }],
      approvals: [], space: {}, run: null,
    };
    prisma.changeSet.findUnique
      .mockResolvedValueOnce(autoChangeSet)
      .mockResolvedValueOnce({ ...autoChangeSet, status: 'published' });
    prisma.page.create.mockResolvedValue({ id: 'page-1' });
    const result = await service.propose(
      {
        userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1', agentRole: 'publisher',
        scopes: scopesForAgentAccessRole('publisher'),
      },
      'space-1', 'Auto', { type: 'create_page', payload: { title: 'A', content: 'x', expectedTreeRevision: '0' } },
    );
    expect(prisma.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'approved' }),
    }));
    expect(prisma.agent.findUnique).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      select: { ownerId: true },
    });
    expect(result.autoPublished).toBe(true);
  });

  it.each([
    ['Credential revoked', (state: any) => { state.credential.revokedAt = new Date(); }],
    ['Credential expired', (state: any) => { state.credential.expiresAt = new Date(Date.now() - 1_000); }],
    ['Credential rebound to another authorization', (state: any) => { state.credential.authorizationId = 'grant-other'; }],
    ['Agent paused', (state: any) => { state.agent.status = 'paused'; }],
    ['Agent revoked', (state: any) => { state.agent.revokedAt = new Date(); }],
    ['Agent auto-publish disabled', (state: any) => { state.agent.approvalMode = 'always-review'; }],
    ['Agent owner locked', (state: any) => { state.agent.owner.lockedAt = new Date(); }],
    ['Agent owner deleted', (state: any) => { state.agent.owner.deletedAt = new Date(); }],
    ['Grant removed', (state: any) => { state.grant = null; }],
    ['Grant role downgraded', (state: any) => { state.grant.role = 'editor'; }],
    ['Space deleted', (state: any) => { state.space.deletedAt = new Date(); }],
    ['Space policy downgraded', (state: any) => { state.space.approvalPolicy = 'always-review'; }],
  ])('revalidates %s inside the final publish transaction and falls back to pending review', async (_gate, mutate) => {
    const state: any = {
      credential: {
        id: 'credential-1', agentId: 'agent-1', authorizationId: 'grant-1',
        expiresAt: null, revokedAt: null,
      },
      agent: {
        id: 'agent-1', status: 'active', revokedAt: null, approvalMode: 'scoped-auto-publish', memoryEnabled: true,
        owner: { id: 'owner-1', lockedAt: null, deletedAt: null },
      },
      grant: { id: 'grant-1', role: 'publisher' },
      space: { approvalPolicy: 'scoped-auto-publish', deletedAt: null },
      changeSetStatus: 'approved',
      itemStatus: 'accepted',
      mutateBeforeTransaction: true,
    };
    prisma.space.findUnique.mockImplementation(async () => state.space);
    prisma.agent.findUnique.mockImplementation(async ({ select }: any) => (
      select?.ownerId ? { ownerId: 'owner-1' } : state.agent
    ));
    prisma.agentCredential.findFirst.mockImplementation(async () => state.credential);
    prisma.agentGrant.findUnique.mockImplementation(async () => state.grant);
    prisma.$queryRaw.mockImplementation(async () => (
      state.credential && state.grant && state.agent && state.space ? [{ id: 'credential-1' }] : []
    ));
    prisma.changeSet.create.mockImplementation(async ({ data }: any) => {
      state.changeSetStatus = data.status;
      state.itemStatus = data.items.create.status;
      return { id: 'cs-race', status: state.changeSetStatus };
    });
    prisma.changeSet.findUnique.mockImplementation(async () => ({
      id: 'cs-race', status: state.changeSetStatus, spaceId: 'space-1',
      createdByUserId: null, createdByAgentId: 'agent-1',
      items: [{ id: 'i1', type: 'create_page', status: state.itemStatus, payload: { title: 'A', content: 'x', expectedTreeRevision: '0' } }],
      approvals: [], space: {}, run: null,
    }));
    prisma.changeSet.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (where.status && where.status !== state.changeSetStatus) return { count: 0 };
      state.changeSetStatus = data.status;
      return { count: 1 };
    });
    prisma.changeItem.updateMany.mockImplementation(async ({ data }: any) => {
      state.itemStatus = data.status;
      return { count: 1 };
    });
    let transactionCalls = 0;
    prisma.$transaction.mockImplementation(async (callback: any) => {
      transactionCalls += 1;
      if (transactionCalls === 2 && state.mutateBeforeTransaction) {
        state.mutateBeforeTransaction = false;
        mutate(state);
      }
      return callback(prisma);
    });
    prisma.page.create.mockResolvedValue({ id: 'page-1' });
    prisma.page.findMany.mockResolvedValue([]);

    const result = await service.propose(
      {
        userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1', agentRole: 'publisher',
        scopes: scopesForAgentAccessRole('publisher'),
      },
      'space-1', 'Race', { type: 'create_page', payload: { title: 'A', content: 'x', expectedTreeRevision: '0' } },
    );

    expect(result).toMatchObject({ status: 'pending_review', autoPublished: false });
    expect(prisma.changeSet.updateMany).toHaveBeenCalledWith({
      where: { id: 'cs-race', status: 'approved' },
      data: { status: 'pending_review', reviewedAt: null },
    });
    expect(prisma.changeItem.updateMany).toHaveBeenCalledWith({
      where: { changeSetId: 'cs-race', status: 'accepted' },
      data: { status: 'pending' },
    });
    expect(prisma.page.create).not.toHaveBeenCalled();
    expect(prisma.$queryRaw.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it('rejects a proposal when the sole Grant is Reader despite stale Publisher principal metadata', async () => {
      prisma.space.findUnique.mockResolvedValue({ approvalPolicy: 'scoped-auto-publish', deletedAt: null });
      prisma.agent.findUnique.mockResolvedValue({
        status: 'active', revokedAt: null, approvalMode: 'scoped-auto-publish', memoryEnabled: true,
        owner: { deletedAt: null, lockedAt: null },
      });
      prisma.agentCredential.findFirst.mockResolvedValue({
        authorizationId: 'grant-1', revokedAt: null, expiresAt: null,
      });
      prisma.agentGrant.findUnique.mockResolvedValue({ id: 'grant-1', role: 'reader' });

      await expect(service.propose(
        {
          userId: 'owner-1',
          agentId: 'agent-1',
          credentialId: 'credential-1',
          agentRole: 'publisher',
          scopes: scopesForAgentAccessRole('publisher'),
        },
        'space-1', 'Manual', { type: 'create_page', payload: { title: 'A' } },
      )).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });

      expect(prisma.changeSet.create).not.toHaveBeenCalled();
  });

  it('keeps an Editor proposal pending despite stale Publisher principal metadata', async () => {
    prisma.space.findUnique.mockResolvedValue({ approvalPolicy: 'scoped-auto-publish', deletedAt: null });
    prisma.agent.findUnique.mockResolvedValue({
      status: 'active', revokedAt: null, approvalMode: 'scoped-auto-publish', memoryEnabled: true,
      owner: { deletedAt: null, lockedAt: null },
    });
    prisma.agentCredential.findFirst.mockResolvedValue({
      authorizationId: 'grant-1', revokedAt: null, expiresAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue({ id: 'grant-1', role: 'editor' });
    prisma.$queryRaw.mockResolvedValue([{ id: 'credential-1' }]);
    prisma.changeSet.create.mockResolvedValue({ id: 'cs-role-ceiling', status: 'pending_review', items: [] });

    const result = await service.propose(
      {
        userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1',
        agentRole: 'publisher', scopes: scopesForAgentAccessRole('publisher'),
      },
      'space-1', 'Manual', { type: 'create_page', payload: { title: 'A' } },
    );

    expect(prisma.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending_review' }),
    }));
    expect(result.autoPublished).toBe(false);
  });

  it('propose stays pending_review when auto-publish conditions are not met', async () => {
    prisma.space.findUnique.mockResolvedValue({ approvalPolicy: 'always-review', deletedAt: null });
    prisma.agent.findUnique.mockResolvedValue({
      status: 'active', revokedAt: null, approvalMode: 'scoped-auto-publish', memoryEnabled: true,
      owner: { deletedAt: null, lockedAt: null },
    });
    prisma.agentCredential.findFirst.mockResolvedValue({
      authorizationId: 'grant-1', revokedAt: null, expiresAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue({ id: 'grant-1', role: 'publisher' });
    prisma.changeSet.create.mockResolvedValue({ id: 'cs-p', status: 'pending_review', items: [] });
    const result = await service.propose(
      { userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1', agentRole: 'publisher', scopes: ['review:auto-publish'] },
      'space-1', 'Manual', { type: 'create_page', payload: { title: 'A' } },
    );
    expect(prisma.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending_review' }),
    }));
    expect(result.autoPublished).toBeFalsy();
  });

  it.each([
    ['Agent approval mode', { spacePolicy: 'scoped-auto-publish', agentMode: 'always-review' }],
    ['Space policy', { spacePolicy: 'always-review', agentMode: 'scoped-auto-publish' }],
  ])('keeps publisher proposals pending when the %s gate is missing', async (_gate, values) => {
    prisma.space.findUnique.mockResolvedValue({ approvalPolicy: values.spacePolicy, deletedAt: null });
    prisma.agent.findUnique.mockResolvedValue({
      status: 'active', revokedAt: null, approvalMode: values.agentMode, memoryEnabled: true,
      owner: { deletedAt: null, lockedAt: null },
    });
    prisma.agentCredential.findFirst.mockResolvedValue({
      authorizationId: 'grant-1', revokedAt: null, expiresAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue({ id: 'grant-1', role: 'publisher' });
    prisma.changeSet.create.mockResolvedValue({ id: 'cs-gated', status: 'pending_review', items: [] });

    const result = await service.propose(
      {
        userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1', agentRole: 'publisher',
        scopes: scopesForAgentAccessRole('publisher'),
      },
      'space-1', 'Manual', { type: 'create_page', payload: { title: 'A' } },
    );

    expect(prisma.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending_review' }),
    }));
    expect(result.autoPublished).toBe(false);
  });
});

describe('ReviewService readable page paths', () => {
  const prisma = {
    changeSet: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const search = {
    indexPage: jest.fn().mockResolvedValue({ lexicalIndexed: true }),
  } as any;
  const revisionWriter = {
    lockSpace: jest.fn().mockImplementation(async (tx: unknown) => tx),
    advance: jest.fn().mockResolvedValue({ revisionId: 'revision-1' }),
  } as any;
  revisionWriter.advanceLocked = revisionWriter.advance;
  const syncPaths = {
    allocate: jest.fn(),
  } as any;
  const graphMaintenance = { enqueue: jest.fn() } as any;
  const service = new ReviewService(
    prisma,
    search,
    revisionWriter,
    syncPaths,
    graphMaintenance,
    makeReviewContentTree(revisionWriter, syncPaths) as any,
  );

  let changeSet: any;
  let tx: any;

  beforeEach(() => {
    jest.clearAllMocks();
    changeSet = {
      id: 'cs-1',
      status: 'approved',
      spaceId: 'space-1',
      createdByUserId: 'user-1',
      createdByAgentId: null,
      items: [],
      approvals: [],
      space: {},
      run: null,
    };
    tx = {
      changeSet: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      changeItem: { update: jest.fn().mockResolvedValue({}) },
      page: {
        create: jest.fn().mockResolvedValue({
          id: 'page-1',
          knowledgeKey: 'knowledge-1',
        }),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          title: 'Guide',
          content: '# Guide\n\nBody',
          deletedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([{
          knowledgeKey: 'knowledge-1',
          syncPath: 'pages/Guide.md',
          title: 'Guide',
          content: '# Guide\n\nBody',
          deletedAt: null,
        }]),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      evidence: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    prisma.changeSet.findUnique.mockImplementation(async () => changeSet);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    syncPaths.allocate.mockResolvedValue({
      path: 'pages/Guide.md',
      pathKey: pathKey('pages/Guide.md'),
    });
  });

  it('keeps sourcePath as provenance while ContentTree allocates the runtime Page path', async () => {
    changeSet.items = [{
      id: 'create-1',
      type: 'create_page',
      status: 'accepted',
      payload: {
        title: 'Setup',
        content: '# Setup\n\nBody',
        sourcePath: 'guides/Setup.md',
        expectedTreeRevision: '0',
      },
    }];
    tx.page.findUnique.mockResolvedValue({
      title: 'Setup',
      content: '# Setup\n\nBody',
      deletedAt: null,
    });
    tx.page.findMany.mockResolvedValue([{
      knowledgeKey: 'knowledge-1',
      syncPath: 'guides/Setup.md',
      title: 'Setup',
      content: '# Setup\n\nBody',
      deletedAt: null,
    }]);

    await service.publish('cs-1');

    expect(syncPaths.allocate).toHaveBeenCalledWith(tx, {
      spaceId: 'space-1', directory: 'pages', title: 'Setup',
    });
    expect(tx.page.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        syncPath: 'pages/Guide.md',
        syncPathKey: pathKey('pages/Guide.md'),
      }),
    }));
  });

  it('allocates a readable path when sourcePath is absent or non-portable', async () => {
    changeSet.items = [{
      id: 'create-1',
      type: 'create_page',
      status: 'accepted',
      payload: {
        title: 'Guide',
        content: '# Guide\n\nBody',
        sourcePath: '/not-portable.md',
        expectedTreeRevision: '0',
      },
    }];

    await service.publish('cs-1');

    expect(syncPaths.allocate).toHaveBeenCalledWith(tx, {
      spaceId: 'space-1',
      directory: 'pages',
      title: 'Guide',
    });
    expect(tx.page.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        syncPath: 'pages/Guide.md',
        syncPathKey: pathKey('pages/Guide.md'),
      }),
    }));
  });

  it('renames the existing path when an accepted update changes title', async () => {
    const updatedAt = new Date('2026-08-20T00:00:00.000Z');
    changeSet.items = [{
      id: 'update-1',
      type: 'update_page',
      status: 'accepted',
      payload: {
        pageId: 'page-1',
        expectedTreeRevision: '0',
        changes: { title: 'New' },
      },
    }];
    tx.page.findFirst.mockResolvedValue({
      id: 'page-1',
      knowledgeKey: 'knowledge-1',
      spaceId: 'space-1',
      title: 'Old',
      slug: 'old',
      content: '# Old\n\nBody',
      parentId: null,
      format: 'markdown',
      authorId: 'user-1',
      updatedAt,
      sourceChangeSetId: null,
      createdByAgentId: null,
      lastChangeSetId: null,
      lastModifiedByUserId: 'user-1',
      lastModifiedByAgentId: null,
      lastModifiedAt: updatedAt,
      sourceId: null,
      sourceVersionId: null,
      sourcePath: null,
      syncPath: 'guides/Old.md',
      syncPathKey: pathKey('guides/Old.md'),
    });
    syncPaths.allocate.mockResolvedValue({
      path: 'guides/New.md',
      pathKey: pathKey('guides/New.md'),
    });
    tx.page.findUnique.mockResolvedValue({
      title: 'New',
      content: '# Old\n\nBody',
      deletedAt: null,
    });
    tx.page.findMany.mockResolvedValue([{
      knowledgeKey: 'knowledge-1',
      syncPath: 'guides/New.md',
      title: 'New',
      content: '# Old\n\nBody',
      deletedAt: null,
    }]);

    await service.publish('cs-1');

    expect(syncPaths.allocate).toHaveBeenCalledWith(tx, {
      spaceId: 'space-1',
      directory: 'guides',
      title: 'New',
      excludePageId: 'page-1',
    });
    expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        syncPath: 'guides/Old.md',
        syncPathKey: pathKey('guides/Old.md'),
      }),
    }));
    expect(tx.changeItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          before: expect.objectContaining({
            syncPath: 'guides/Old.md',
            syncPathKey: pathKey('guides/Old.md'),
          }),
        }),
      }),
    }));
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: 'New',
        syncPath: 'guides/New.md',
        syncPathKey: pathKey('guides/New.md'),
      }),
    }));
    expect(revisionWriter.advance).toHaveBeenCalledWith(
      tx,
      'space-1',
      [expect.objectContaining({
        path: 'guides/New.md',
        body: '# Old\n\nBody',
      })],
      expect.anything(),
    );
  });

  it('preserves body bytes including a matching H1 during path allocation', async () => {
    changeSet.items = [{
      id: 'create-1',
      type: 'create_page',
      status: 'accepted',
      payload: { title: 'Title', content: '# Title\n\nBody', expectedTreeRevision: '0' },
    }];
    syncPaths.allocate.mockResolvedValue({
      path: 'pages/Title.md',
      pathKey: pathKey('pages/Title.md'),
    });
    tx.page.findUnique.mockResolvedValue({
      title: 'Title',
      content: '# Title\n\nBody',
      deletedAt: null,
    });
    tx.page.findMany.mockResolvedValue([{
      knowledgeKey: 'knowledge-1',
      syncPath: 'pages/Title.md',
      title: 'Title',
      content: '# Title\n\nBody',
      deletedAt: null,
    }]);

    await service.publish('cs-1');

    expect(tx.page.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ content: '# Title\n\nBody' }),
    }));
    expect(revisionWriter.advance).toHaveBeenCalledWith(
      tx,
      'space-1',
      [expect.objectContaining({ body: '# Title\n\nBody' })],
      expect.anything(),
    );
  });

  it('advances a normal ChangeSet when the real knowledgeSubmission delegate finds no submission', async () => {
    changeSet.items = [{
      id: 'create-1',
      type: 'create_page',
      status: 'accepted',
      payload: { title: 'Guide', content: '# Guide\n\nBody', expectedTreeRevision: '0' },
    }];
    tx.knowledgeSubmission = {
      findUnique: jest.fn().mockResolvedValue(null),
    };

    await service.publish('cs-1');

    expect(tx.knowledgeSubmission.findUnique).toHaveBeenCalledWith({
      where: { changeSetId: 'cs-1' },
    });
    expect(revisionWriter.advance).toHaveBeenCalledWith(
      tx,
      'space-1',
      [expect.objectContaining({ operation: 'upsert', pageId: 'knowledge-1' })],
      expect.objectContaining({ sourceChangeSetId: 'cs-1' }),
    );
  });

  it('keeps the current path for a sanitization-equivalent title update', async () => {
    const updatedAt = new Date('2026-08-20T00:00:00.000Z');
    changeSet.items = [{
      id: 'update-1',
      type: 'update_page',
      status: 'accepted',
      payload: {
        pageId: 'page-1',
        expectedTreeRevision: '0',
        changes: { title: 'A <> B' },
      },
    }];
    tx.page.findFirst.mockResolvedValue({
      id: 'page-1',
      knowledgeKey: 'knowledge-1',
      spaceId: 'space-1',
      title: 'A / B',
      slug: 'a-b',
      content: '# A / B\n\nBody',
      parentId: null,
      format: 'markdown',
      authorId: 'user-1',
      updatedAt,
      sourceChangeSetId: null,
      createdByAgentId: null,
      lastChangeSetId: null,
      lastModifiedByUserId: 'user-1',
      lastModifiedByAgentId: null,
      lastModifiedAt: updatedAt,
      sourceId: null,
      sourceVersionId: null,
      sourcePath: null,
      syncPath: 'notes/custom.md',
      syncPathKey: pathKey('notes/custom.md'),
    });
    tx.page.findUnique.mockResolvedValue({
      title: 'A <> B',
      content: '# A / B\n\nBody',
      deletedAt: null,
    });
    tx.page.findMany.mockResolvedValue([{
      knowledgeKey: 'knowledge-1',
      syncPath: 'notes/custom.md',
      title: 'A <> B',
      content: '# A / B\n\nBody',
      deletedAt: null,
    }]);

    await service.publish('cs-1');

    expect(syncPaths.allocate).not.toHaveBeenCalled();
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({
        syncPath: expect.anything(),
        syncPathKey: expect.anything(),
      }),
    }));
    expect(revisionWriter.advance).toHaveBeenCalledWith(
      tx,
      'space-1',
      [expect.objectContaining({
        path: 'notes/custom.md',
        body: '# A / B\n\nBody',
      })],
      expect.anything(),
    );
  });

  it('locks the Space before allocating or writing a page', async () => {
    changeSet.items = [{
      id: 'create-1',
      type: 'create_page',
      status: 'accepted',
      payload: { title: 'Guide', content: '', expectedTreeRevision: '0' },
    }];

    await service.publish('cs-1');

    expect(revisionWriter.lockSpace).toHaveBeenCalledWith(tx, 'space-1');
    expect(revisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(
      syncPaths.allocate.mock.invocationCallOrder[0],
    );
    expect(syncPaths.allocate.mock.invocationCallOrder[0]).toBeLessThan(
      tx.page.create.mock.invocationCallOrder[0],
    );
  });
});

describe('ReviewService page revert ordering and audit', () => {
  const prisma = {
    changeSet: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const search = {
    indexPage: jest.fn().mockResolvedValue({ lexicalIndexed: true }),
  } as any;
  const revisionWriter = {
    lockSpace: jest.fn().mockImplementation(async (tx: unknown) => tx),
    advance: jest.fn().mockResolvedValue({ revisionId: 'revision-1' }),
  } as any;
  revisionWriter.advanceLocked = revisionWriter.advance;
  const graphMaintenance = { enqueue: jest.fn() } as any;
  const syncPaths = { allocate: jest.fn() } as any;
  const contentTree = makeReviewContentTree(revisionWriter, syncPaths) as any;
  const service = new ReviewService(
    prisma,
    search,
    revisionWriter,
    syncPaths,
    graphMaintenance,
    contentTree,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reverts title and Folder placement through one ContentTree CAS boundary without restoring parentId', async () => {
    const publishedAt = new Date('2026-08-20T00:01:00.000Z');
    const updatedAt = new Date('2026-08-20T00:00:30.000Z');
    const current = {
      id: 'page-1', knowledgeKey: 'knowledge-1', spaceId: 'space-1',
      title: 'New title', content: 'New body', authorId: 'user-1', slug: 'new-title',
      format: 'markdown', parentId: null, folderId: 'folder-new', sortOrder: 3,
      createdAt: new Date('2026-08-19T00:00:00.000Z'), updatedAt,
      syncPath: 'pages/New/New title.md', syncPathKey: pathKey('pages/New/New title.md'),
      sourceChangeSetId: 'cs-before', lastChangeSetId: 'cs-1', deletedAt: null,
    };
    const before = {
      title: 'Old title', slug: 'old-title', content: 'Old body', format: 'markdown',
      parentId: 'legacy-page-parent', folderId: 'folder-old',
      sourceChangeSetId: 'cs-before', createdByAgentId: null,
      lastChangeSetId: 'cs-before', lastModifiedByUserId: 'user-1',
      lastModifiedByAgentId: null, lastModifiedAt: updatedAt,
      sourceId: null, sourceVersionId: null, sourcePath: null,
      syncPath: 'pages/Old/Old title.md', syncPathKey: pathKey('pages/Old/Old title.md'),
    };
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-1', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-1', createdByAgentId: null,
      items: [{
        id: 'item-1', type: 'update_page', status: 'published',
        publishedResourceId: 'page-1', payload: { before },
      }],
      approvals: [], space: {}, run: null,
    });
    const restored = {
      ...current, ...before, parentId: null, deletedAt: null,
      syncPathKey: pathKey(before.syncPath),
    };
    const tx = {
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn().mockResolvedValue({}) },
      page: {
        findFirst: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(restored),
        findMany: jest.fn().mockResolvedValue([restored]),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    contentTree.advancePageMutation.mockResolvedValueOnce({
      treeRevision: 9n, syncRevisionId: 'revision-1',
    });

    await service.revert('cs-1', '8');

    expect(contentTree.lockPageMutationSpace).toHaveBeenCalledWith(tx, 'space-1', 8n);
    expect(contentTree.prepareExactPageMutation).toHaveBeenCalledWith(tx, expect.objectContaining({
      pageId: 'page-1', title: 'Old title', folderId: 'folder-old',
      syncPath: 'pages/Old/Old title.md',
    }));
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        parentId: null, folderId: 'folder-old',
        syncPath: 'pages/Old/Old title.md', syncPathKey: pathKey('pages/Old/Old title.md'),
      }),
    }));
    expect(contentTree.advancePageMutation).toHaveBeenCalledTimes(1);
    expect(contentTree.advancePageMutation).toHaveBeenCalledWith(tx, expect.objectContaining({
      expectedTreeRevision: 8n,
      structural: true,
      changes: [expect.objectContaining({
        operation: 'upsert', pageId: 'knowledge-1', folderId: 'folder-old',
        path: 'pages/Old/Old title.md',
      })],
    }));
    expect(revisionWriter.advance).not.toHaveBeenCalled();
  });

  it.each([
    ['create_page', {}, null],
    ['update_page', { before: {
      title: 'Before', slug: 'before', content: 'Old', format: 'markdown',
      folderId: 'folder-1', syncPath: 'guides/Before.md',
      syncPathKey: pathKey('guides/Before.md'),
    } }, null],
    ['archive_page', { before: { deletedAt: null } }, new Date('2026-08-20T00:00:00.000Z')],
  ])('locks and snapshots the current Page before reverting %s', async (type, payload, deletedAt) => {
    const publishedAt = new Date('2026-08-20T00:01:00.000Z');
    const current = {
      id: 'page-1',
      knowledgeKey: 'knowledge-1',
      spaceId: 'space-1',
      title: 'Current title',
      content: 'Current body',
      authorId: 'user-1',
      slug: 'current-title',
      format: 'markdown',
      parentId: null,
      folderId: 'folder-1',
      syncPath: 'guides/Current title.md',
      syncPathKey: 'guides/current title.md',
      sourceChangeSetId: 'cs-1',
      lastChangeSetId: 'cs-1',
      updatedAt: new Date('2026-08-20T00:00:30.000Z'),
      deletedAt,
    };
    const changeSet = {
      id: 'cs-1',
      status: 'published',
      spaceId: 'space-1',
      publishedAt,
      createdByUserId: 'user-1',
      createdByAgentId: null,
      items: [{
        id: 'item-1',
        type,
        status: 'published',
        publishedResourceId: 'page-1',
        payload,
      }],
      approvals: [],
      space: {},
      run: null,
    };
    const tx = {
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn().mockResolvedValue({}) },
      page: {
        findFirst: jest.fn().mockResolvedValue(current),
        findUnique: jest.fn().mockResolvedValue({
          title: current.title,
          content: current.content,
          deletedAt: type === 'archive_page' ? null : new Date(),
        }),
        findMany: jest.fn().mockResolvedValue([current]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.changeSet.findUnique.mockResolvedValue(changeSet);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.revert('cs-1', '0');

    expect(tx.changeSet.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      revisionWriter.lockSpace.mock.invocationCallOrder[0],
    );
    expect(revisionWriter.lockSpace).toHaveBeenCalledWith(tx, 'space-1');
    const firstPageOperation = Math.min(
      ...[tx.page.findFirst, tx.page.findUnique, tx.page.findMany, tx.page.updateMany]
        .map((mock: any) => mock.mock.invocationCallOrder[0])
        .filter((order: number) => order !== undefined),
    );
    expect(revisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(firstPageOperation);
    expect(tx.page.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      tx.pageVersion.create.mock.invocationCallOrder[0],
    );
    expect(tx.pageVersion.create).toHaveBeenCalledWith({
      data: {
        pageId: current.id,
        title: current.title,
        content: current.content,
        authorId: current.authorId,
        slug: current.slug,
        format: current.format,
        parentId: current.parentId,
        folderId: current.folderId,
        syncPath: current.syncPath,
        syncPathKey: current.syncPathKey,
      },
    });
    expect(tx.pageVersion.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.page.updateMany.mock.invocationCallOrder[0],
    );
    expect(tx.page.findFirst.mock.calls[0][0].where).toBe(
      tx.page.updateMany.mock.calls[0][0].where,
    );
    expect(revisionWriter.advance).toHaveBeenCalledWith(
      tx,
      'space-1',
      expect.any(Array),
      expect.objectContaining({ origin: 'change_set', sourceChangeSetId: 'cs-1' }),
    );
  });
});

describe('ReviewService archive audit and provenance', () => {
  const prisma = {
    changeSet: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const search = {
    indexPage: jest.fn().mockResolvedValue({ lexicalIndexed: true }),
  } as any;
  const revisionWriter = {
    lockSpace: jest.fn().mockImplementation(async (tx: unknown) => tx),
    advance: jest.fn().mockResolvedValue({ revisionId: 'revision-1' }),
  } as any;
  revisionWriter.advanceLocked = revisionWriter.advance;
  const graphMaintenance = { enqueue: jest.fn() } as any;
  const syncPaths = { allocate: jest.fn() } as any;
  const service = new ReviewService(
    prisma,
    search,
    revisionWriter,
    syncPaths,
    graphMaintenance,
    makeReviewContentTree(revisionWriter, syncPaths) as any,
  );

  const originalUpdatedAt = new Date('2026-08-20T00:00:00.000Z');
  const originalModifiedAt = new Date('2026-08-19T23:59:00.000Z');
  const originalPage = {
    id: 'page-1', knowledgeKey: 'knowledge-1', spaceId: 'space-1',
    title: 'Archived title', slug: 'archived-title',
    content: '# Archived title\n\nOriginal body', format: 'markdown',
    parentId: 'parent-1', authorId: 'author-1',
    sourceChangeSetId: 'cs-origin', createdByAgentId: 'agent-origin',
    lastChangeSetId: 'cs-before', lastModifiedByUserId: 'user-before',
    lastModifiedByAgentId: null, lastModifiedAt: originalModifiedAt,
    sourceId: 'source-1', sourceVersionId: 'source-version-1',
    sourcePath: 'source/Archived.md', syncPath: 'guides/Archived title.md',
    syncPathKey: pathKey('guides/Archived title.md'), deletedAt: null,
    updatedAt: originalUpdatedAt,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes a complete pre-archive audit record and archives with exact row CAS', async () => {
    const changeSet = {
      id: 'cs-archive', status: 'approved', spaceId: 'space-1',
      createdByUserId: null, createdByAgentId: 'agent-archive',
      items: [{
        id: 'item-archive', type: 'archive_page', status: 'accepted',
        payload: { pageId: 'page-1', expectedUpdatedAt: originalUpdatedAt.toISOString(), expectedTreeRevision: '0' },
      }], approvals: [], space: {}, run: null,
    };
    (prisma as any).agent = { findUnique: jest.fn().mockResolvedValue({ ownerId: 'agent-owner' }) };
    const tx = {
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn().mockResolvedValue({}) },
      page: {
        findFirst: jest.fn().mockResolvedValue(originalPage),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          title: originalPage.title, content: originalPage.content,
          deletedAt: new Date('2026-08-20T00:01:00.000Z'),
        }),
        findMany: jest.fn().mockResolvedValue([{
          knowledgeKey: originalPage.knowledgeKey, syncPath: originalPage.syncPath,
          title: originalPage.title, content: originalPage.content,
          deletedAt: new Date('2026-08-20T00:01:00.000Z'),
        }]),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.changeSet.findUnique.mockResolvedValue(changeSet);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.publish('cs-archive');

    expect(revisionWriter.lockSpace).toHaveBeenCalledWith(tx, 'space-1');
    expect(revisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(
      tx.page.findFirst.mock.invocationCallOrder[0],
    );
    expect(tx.pageVersion.create).toHaveBeenCalledWith({
      data: {
        pageId: originalPage.id, title: originalPage.title,
        content: originalPage.content, authorId: originalPage.authorId,
        slug: originalPage.slug, format: originalPage.format,
        parentId: originalPage.parentId, folderId: null, syncPath: originalPage.syncPath,
        syncPathKey: originalPage.syncPathKey,
      },
    });
    expect(tx.changeItem.update).toHaveBeenCalledWith({
      where: { id: 'item-archive' },
      data: { payload: {
        pageId: 'page-1', expectedUpdatedAt: originalUpdatedAt.toISOString(),
        expectedTreeRevision: '0',
        before: {
          title: originalPage.title,
          slug: originalPage.slug,
          content: originalPage.content,
          format: originalPage.format,
          parentId: originalPage.parentId,
          folderId: null,
          syncPath: originalPage.syncPath,
          syncPathKey: originalPage.syncPathKey,
          sourceChangeSetId: originalPage.sourceChangeSetId,
          createdByAgentId: originalPage.createdByAgentId,
          lastChangeSetId: originalPage.lastChangeSetId,
          lastModifiedByUserId: originalPage.lastModifiedByUserId,
          lastModifiedByAgentId: originalPage.lastModifiedByAgentId,
          lastModifiedAt: originalModifiedAt.toISOString(),
          sourceId: originalPage.sourceId,
          sourceVersionId: originalPage.sourceVersionId,
          sourcePath: originalPage.sourcePath,
          deletedAt: null,
          deletionBatchId: null,
        },
      } },
    });
    expect(tx.page.updateMany).toHaveBeenCalledWith({
      where: {
        id: originalPage.id, spaceId: originalPage.spaceId,
        deletedAt: null, updatedAt: originalUpdatedAt,
      },
      data: expect.objectContaining({
        deletedAt: expect.any(Date), lastChangeSetId: 'cs-archive',
        lastModifiedByAgentId: 'agent-archive', lastModifiedByUserId: null,
        lastModifiedAt: expect.any(Date),
      }),
    });
    expect(tx.pageVersion.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.page.updateMany.mock.invocationCallOrder[0],
    );
  });

  it('rolls back archive audit, item status and revision when exact row CAS loses a race', async () => {
    const changeSet = {
      id: 'cs-archive', status: 'approved', spaceId: 'space-1',
      createdByUserId: 'user-archive', createdByAgentId: null,
      items: [{ id: 'item-archive', type: 'archive_page', status: 'accepted', payload: { pageId: 'page-1', expectedTreeRevision: '0' } }],
      approvals: [], space: {}, run: null,
    };
    let committed = {
      changeSetStatus: 'approved', itemStatus: 'accepted',
      itemPayload: { pageId: 'page-1' } as Record<string, unknown>,
      page: { ...originalPage }, versions: [] as unknown[],
    };
    prisma.changeSet.findUnique.mockResolvedValue(changeSet);
    prisma.$transaction.mockImplementation(async (callback: any) => {
      const local = structuredClone(committed);
      const tx = {
        changeSet: { updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          if (local.changeSetStatus !== where.status) return { count: 0 };
          local.changeSetStatus = data.status;
          return { count: 1 };
        }) },
        changeItem: { update: jest.fn().mockImplementation(async ({ data }: any) => {
          if (data.payload) local.itemPayload = data.payload;
          if (data.status) local.itemStatus = data.status;
          return {};
        }) },
        page: {
          findFirst: jest.fn().mockImplementation(async () => {
            const snapshot = structuredClone(local.page);
            committed.page.updatedAt = new Date('2026-08-20T00:00:01.000Z');
            return snapshot;
          }),
          updateMany: jest.fn().mockImplementation(async ({ where }: any) => ({
            count: committed.page.updatedAt.getTime() === where.updatedAt.getTime() ? 1 : 0,
          })),
          findUnique: jest.fn(), findMany: jest.fn(),
        },
        pageVersion: { create: jest.fn().mockImplementation(async ({ data }: any) => {
          local.versions.push(data);
          return {};
        }) },
        pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      };
      const result = await callback(tx);
      committed = local;
      return result;
    });

    await expect(service.publish('cs-archive')).rejects.toMatchObject({
      businessCode: 'CHANGESET_INVALID_STATE',
      message: 'The page changed while it was being archived',
    });

    expect(committed.changeSetStatus).toBe('approved');
    expect(committed.itemStatus).toBe('accepted');
    expect(committed.itemPayload).toEqual({ pageId: 'page-1' });
    expect(committed.versions).toEqual([]);
    expect(committed.page.deletedAt).toBeNull();
    expect(committed.page.updatedAt).toEqual(new Date('2026-08-20T00:00:01.000Z'));
    expect(revisionWriter.advance).not.toHaveBeenCalled();
    expect(search.indexPage).not.toHaveBeenCalled();
  });

  it('reconstructs JSON dates and restores complete pre-archive provenance', async () => {
    const publishedAt = new Date('2026-08-20T00:02:00.000Z');
    const archivedAt = new Date('2026-08-20T00:01:00.000Z');
    const before = {
      lastChangeSetId: originalPage.lastChangeSetId,
      lastModifiedByUserId: originalPage.lastModifiedByUserId,
      lastModifiedByAgentId: originalPage.lastModifiedByAgentId,
      lastModifiedAt: originalModifiedAt.toISOString(),
      deletedAt: null,
      id: 'attacker-controlled-page-id',
      spaceId: 'attacker-controlled-space-id',
      updatedAt: '1999-01-01T00:00:00.000Z',
      title: 'must not be restored',
      content: 'must not be restored',
      unknownKey: 'must not reach Prisma',
    };
    const archivedPage = {
      ...originalPage, deletedAt: archivedAt, updatedAt: archivedAt,
      lastChangeSetId: 'cs-archive', lastModifiedByUserId: null,
      lastModifiedByAgentId: 'agent-archive', lastModifiedAt: archivedAt,
    };
    const changeSet = {
      id: 'cs-archive', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: null, createdByAgentId: 'agent-archive',
      items: [{
        id: 'item-archive', type: 'archive_page', status: 'published',
        publishedResourceId: 'page-1', payload: { pageId: 'page-1', before },
      }], approvals: [], space: {}, run: null,
    };
    const tx = {
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn().mockResolvedValue({}) },
      page: {
        findFirst: jest.fn().mockResolvedValue(archivedPage),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          title: originalPage.title, content: originalPage.content,
          deletedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([{
          knowledgeKey: originalPage.knowledgeKey,
          syncPath: originalPage.syncPath,
          title: originalPage.title, content: originalPage.content,
          deletedAt: null,
        }]),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.changeSet.findUnique.mockResolvedValue(changeSet);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.revert('cs-archive', '0');

    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastChangeSetId: originalPage.lastChangeSetId,
        lastModifiedByUserId: originalPage.lastModifiedByUserId,
        lastModifiedByAgentId: originalPage.lastModifiedByAgentId,
        lastModifiedAt: originalModifiedAt,
        deletedAt: null,
        parentId: null,
      }),
    }));
    expect(tx.page.updateMany.mock.calls[0][0].data.lastChangeSetId).toBe('cs-before');
    expect(tx.page.updateMany.mock.calls[0][0].data.lastModifiedByUserId).toBe('user-before');
    expect(tx.page.updateMany.mock.calls[0][0].data.lastModifiedByAgentId).toBeNull();
    expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        syncPath: archivedPage.syncPath, syncPathKey: archivedPage.syncPathKey,
      }),
    }));
  });

  it.each([
    [
      'supports a legacy deletedAt-only prior state',
      { deletedAt: null },
      { deletedAt: null },
    ],
    [
      'preserves nullable provenance ID nulls',
      {
        lastChangeSetId: null,
        lastModifiedByUserId: null,
        lastModifiedByAgentId: null,
        deletedAt: null,
      },
      {
        lastChangeSetId: null,
        lastModifiedByUserId: null,
        lastModifiedByAgentId: null,
        deletedAt: null,
      },
    ],
    [
      'converts a valid lastModifiedAt ISO date',
      {
        lastModifiedAt: '2026-08-19T23:59:00.000Z',
        deletedAt: null,
      },
      {
        lastModifiedAt: new Date('2026-08-19T23:59:00.000Z'),
        deletedAt: null,
      },
    ],
    [
      'copies a valid lastModifiedAt Date value',
      {
        lastModifiedAt: new Date('2026-08-19T23:58:00.000Z'),
        deletedAt: null,
      },
      {
        lastModifiedAt: new Date('2026-08-19T23:58:00.000Z'),
        deletedAt: null,
      },
    ],
  ] as Array<[string, Record<string, unknown>, Record<string, unknown>]>)('%s', async (_label, before, expectedData) => {
    const publishedAt = new Date('2026-08-20T00:02:00.000Z');
    const archivedAt = new Date('2026-08-20T00:01:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-archive', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-archive', createdByAgentId: null,
      items: [{
        id: 'item-archive', type: 'archive_page', status: 'published',
        publishedResourceId: 'page-1', payload: { pageId: 'page-1', before },
      }], approvals: [], space: {}, run: null,
    });
    const tx = {
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { update: jest.fn().mockResolvedValue({}) },
      page: {
        findFirst: jest.fn().mockResolvedValue({ ...originalPage, deletedAt: archivedAt }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          title: originalPage.title, content: originalPage.content, deletedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.revert('cs-archive', '0');

    expect(tx.page.updateMany.mock.calls[0][0].data).toMatchObject({
      ...expectedData,
      parentId: null,
    });
  });

  it.each([
    ['missing before', { pageId: 'page-1' }],
    ['missing deletedAt', { pageId: 'page-1', before: {} }],
    ['undefined deletedAt', { pageId: 'page-1', before: { deletedAt: undefined } }],
    ['non-null deletedAt', { pageId: 'page-1', before: { deletedAt: '2026-08-19T00:00:00.000Z' } }],
    ['null lastModifiedAt', { pageId: 'page-1', before: { deletedAt: null, lastModifiedAt: null } }],
    ['undefined lastModifiedAt', { pageId: 'page-1', before: { deletedAt: null, lastModifiedAt: undefined } }],
    ['invalid lastModifiedAt string', { pageId: 'page-1', before: { deletedAt: null, lastModifiedAt: 'not-a-date' } }],
    ['invalid lastModifiedAt Date', { pageId: 'page-1', before: { deletedAt: null, lastModifiedAt: new Date('invalid') } }],
  ] as Array<[string, Record<string, unknown>]>)('fails closed before starting revert work for %s', async (_label, payload) => {
    const publishedAt = new Date('2026-08-20T00:02:00.000Z');
    const archivedAt = new Date('2026-08-20T00:01:00.000Z');
    prisma.changeSet.findUnique.mockResolvedValue({
      id: 'cs-archive', status: 'published', spaceId: 'space-1', publishedAt,
      createdByUserId: 'user-archive', createdByAgentId: null,
      items: [{
        id: 'item-archive', type: 'archive_page', status: 'published',
        publishedResourceId: 'page-1', payload,
      }], approvals: [], space: {}, run: null,
    });
    const initialState = {
      changeSetStatus: 'published',
      itemStatus: 'published',
      page: {
        deletedAt: archivedAt,
        lastChangeSetId: 'cs-archive',
      },
      pageVersions: [] as unknown[],
    };
    let committed = structuredClone(initialState);
    const changeSetClaim = jest.fn();
    const changeItemUpdate = jest.fn();
    const pageFindFirst = jest.fn();
    const pageUpdate = jest.fn();
    const pageVersionCreate = jest.fn();
    prisma.$transaction.mockImplementation(async (callback: any) => {
      const local = structuredClone(committed);
      changeSetClaim.mockImplementation(async () => {
        local.changeSetStatus = 'reverting';
        return { count: 1 };
      });
      changeItemUpdate.mockImplementation(async ({ data }: any) => {
        if (data.status) local.itemStatus = data.status;
        return {};
      });
      pageFindFirst.mockResolvedValue({
        ...originalPage,
        deletedAt: archivedAt,
        lastChangeSetId: 'cs-archive',
      });
      pageUpdate.mockImplementation(async ({ data }: any) => {
        if (Object.prototype.hasOwnProperty.call(data, 'deletedAt')) {
          local.page.deletedAt = data.deletedAt;
        }
        return { count: 1 };
      });
      pageVersionCreate.mockImplementation(async ({ data }: any) => {
        local.pageVersions.push(data);
        return {};
      });
      const tx = {
        changeSet: { updateMany: changeSetClaim },
        changeItem: { update: changeItemUpdate },
        page: {
          findFirst: pageFindFirst,
          updateMany: pageUpdate,
          findUnique: jest.fn().mockResolvedValue({
            title: originalPage.title,
            content: originalPage.content,
            deletedAt: local.page.deletedAt,
          }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        pageVersion: { create: pageVersionCreate },
        pageSearchDocument: {
          upsert: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      const result = await callback(tx);
      committed = local;
      return result;
    });

    await expect(service.revert('cs-archive', '0')).rejects.toMatchObject({
      businessCode: 'CHANGESET_INVALID_STATE',
      message: 'Archived page prior state is invalid',
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(changeSetClaim).not.toHaveBeenCalled();
    expect(pageFindFirst).not.toHaveBeenCalled();
    expect(pageVersionCreate).not.toHaveBeenCalled();
    expect(pageUpdate).not.toHaveBeenCalled();
    expect(changeItemUpdate).not.toHaveBeenCalled();
    expect(revisionWriter.advance).not.toHaveBeenCalled();
    expect(search.indexPage).not.toHaveBeenCalled();
    expect(committed).toEqual(initialState);
  });
});
