import { createHash } from 'node:crypto';
import { PagePublicationService } from './page-publication.service';

function contentHash(value: string): string {
  return createHash('sha256').update(value.replace(/\r\n?/gu, '\n'), 'utf8').digest('hex');
}

describe('PagePublicationService', () => {
  const oldPage = {
    id: 'page-1', spaceId: 'space-1', title: 'Target', slug: 'target', content: 'Old\r\nbody',
    parentId: null, folderId: null, format: 'markdown', authorId: 'owner-1', knowledgeKey: 'knowledge-1',
    sourceChangeSetId: null, createdByAgentId: null, lastChangeSetId: null,
    lastModifiedByUserId: 'owner-1', lastModifiedByAgentId: null,
    lastModifiedAt: new Date('2026-09-05T07:00:00.000Z'),
    sourceId: null, sourceVersionId: null, sourcePath: null,
    syncPath: 'pages/Target.md', syncPathKey: 'pages/target.md', sortOrder: 0,
    createdAt: new Date('2026-09-05T06:00:00.000Z'), updatedAt: new Date('2026-09-05T08:00:00.000Z'),
    deletedAt: null,
  };
  const changeSet = {
    id: 'change-set-1', spaceId: 'space-1', status: 'pending_review',
    origin: 'collaboration',
    createdByUserId: null, createdByAgentId: 'agent-1',
    items: [{
      id: 'item-1', type: 'update_page', status: 'pending', payload: {
        pageId: 'page-1', expectedUpdatedAt: oldPage.updatedAt.toISOString(),
        expectedContentHash: contentHash(oldPage.content), expectedPageVersionId: null,
        changes: { content: '# Submitted' },
      },
    }],
  };
  const tx = {
    collaborationArtifactChangeSetLink: { findUnique: jest.fn() },
    changeSet: { findUnique: jest.fn(), updateMany: jest.fn() },
    changeItem: { updateMany: jest.fn(), update: jest.fn() },
    page: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    pageVersion: { create: jest.fn() },
    approval: { create: jest.fn() },
  } as any;
  const contentTree = {
    lockPageMutationSpace: jest.fn(async (value: any) => Object.assign(value, { contentTreeRevision: 7n })),
    preparePageMutation: jest.fn(),
    advancePageMutation: jest.fn(),
  } as any;
  const search = { indexPage: jest.fn() } as any;
  const graph = { enqueue: jest.fn() } as any;
  const service = new PagePublicationService(contentTree, search, graph);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.collaborationArtifactChangeSetLink.findUnique.mockResolvedValue({
      artifactId: 'artifact-1', changeSetId: 'change-set-1', runId: 'run-1', taskId: 'task-1',
      spaceId: 'space-1', pageId: 'page-1',
      artifact: { attempt: {
        id: 'attempt-1', basePageVersionId: null, basePageUpdatedAt: oldPage.updatedAt,
        baseContentHash: contentHash(oldPage.content),
      } },
    });
    tx.changeSet.findUnique.mockResolvedValue(changeSet);
    tx.changeSet.updateMany.mockReset().mockResolvedValue({ count: 1 });
    tx.changeItem.updateMany.mockResolvedValue({ count: 1 });
    tx.page.findFirst.mockResolvedValue(oldPage);
    tx.page.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    tx.page.findUnique.mockResolvedValue({ ...oldPage, content: '# Submitted', updatedAt: new Date('2026-09-05T09:00:00.000Z') });
    tx.page.findMany.mockResolvedValue([{ ...oldPage, content: '# Submitted' }]);
    tx.pageVersion.create.mockReset()
      .mockResolvedValueOnce({ id: 'before-version' })
      .mockResolvedValueOnce({ id: 'published-version' });
    tx.approval.create.mockResolvedValue({ id: 'approval-1' });
    contentTree.advancePageMutation.mockResolvedValue({ treeRevision: 8n, syncRevisionId: 'sync-1' });
    search.indexPage.mockResolvedValue({ lexicalIndexed: true });
  });

  it('publishes one linked Markdown update and returns an immutable after-image PageVersion', async () => {
    const locked = await service.lockChangeSetSpace(tx, 'change-set-1');
    await expect(service.publishLocked(locked, 'change-set-1', {
      userId: 'reviewer-1', comment: 'Accepted',
    })).resolves.toEqual({ pageId: 'page-1', pageVersionId: 'published-version' });

    expect(tx.pageVersion.create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({
      pageId: 'page-1', content: 'Old\r\nbody',
    }) });
    expect(tx.pageVersion.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({
      pageId: 'page-1', content: '# Submitted',
    }) });
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'page-1', updatedAt: oldPage.updatedAt }),
      data: expect.objectContaining({
        content: '# Submitted', sourceChangeSetId: 'change-set-1',
        lastChangeSetId: 'change-set-1', lastModifiedByAgentId: 'agent-1',
      }),
    }));
    expect(tx.approval.create).toHaveBeenCalledWith({ data: {
      changeSetId: 'change-set-1', reviewerId: 'reviewer-1', decision: 'approved', comment: 'Accepted',
    } });
    expect(contentTree.advancePageMutation).toHaveBeenCalledWith(locked, expect.objectContaining({
      spaceId: 'space-1', expectedTreeRevision: 7n,
      revisionOrigin: { sourceChangeSetId: 'change-set-1' },
    }));
  });

  it('fails closed when the current body hash differs despite an unchanged timestamp', async () => {
    tx.page.findFirst.mockResolvedValue({ ...oldPage, content: 'silently changed' });
    await expect(service.publishLocked(Object.assign(tx, { contentTreeRevision: 7n }), 'change-set-1', {
      userId: 'reviewer-1',
    })).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(tx.pageVersion.create).not.toHaveBeenCalled();
    expect(tx.approval.create).not.toHaveBeenCalled();
  });

  it('fails closed when the final ChangeSet publication compare-and-set loses', async () => {
    tx.changeSet.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(service.publishLocked(Object.assign(tx, { contentTreeRevision: 7n }), 'change-set-1', {
      userId: 'reviewer-1',
    })).rejects.toMatchObject({ businessCode: 'CHANGESET_INVALID_STATE' });
  });

  it('publishes an unchanged Page once and still returns a truthful immutable result version', async () => {
    const unchanged = {
      ...changeSet,
      items: [{
        ...changeSet.items[0],
        payload: {
          ...changeSet.items[0].payload,
          changes: { content: oldPage.content },
        },
      }],
    };
    tx.changeSet.findUnique.mockResolvedValue(unchanged);
    tx.page.findUnique.mockResolvedValue({ ...oldPage });

    await expect(service.publishLocked(Object.assign(tx, { contentTreeRevision: 7n }), 'change-set-1', {
      userId: 'reviewer-1',
    })).resolves.toEqual({ pageId: 'page-1', pageVersionId: 'published-version' });
    expect(tx.pageVersion.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({
      pageId: 'page-1', content: oldPage.content,
    }) });
  });

  it('contains post-commit indexing and graph failures after a committed publication', async () => {
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    search.indexPage.mockRejectedValueOnce(new Error('search unavailable'));
    graph.enqueue.mockImplementationOnce(() => { throw new Error('graph unavailable'); });
    await expect(service.runPostCommitEffects('space-1', ['page-1'])).resolves.toBeUndefined();
  });
});
