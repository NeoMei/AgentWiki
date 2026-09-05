import { RunService } from './run.service';
import { canonicalPageContentHash } from './page-baseline';
import { PageResultService } from './page-result.service';

const principal = { userId: 'human-1' };

function serviceWith(overrides: Record<string, any> = {}) {
  const updatedAt = new Date('2026-09-05T10:00:00.000Z');
  const prisma: any = {
    collaborationRun: { findFirst: jest.fn().mockResolvedValue({ id: 'run-1', spaceId: 'space-1' }) },
    collaborationReview: { findFirst: jest.fn().mockResolvedValue({
      id: 'review-1', runId: 'run-1', sourceTaskId: 'task-1', artifactId: 'artifact-1',
      status: 'pending', minimumRole: 'editor', reviewerUserIds: [],
    }) },
    collaborationTaskArtifact: { findFirst: jest.fn().mockResolvedValue({
      id: 'artifact-1', runId: 'run-1', taskId: 'task-1', attemptId: 'attempt-1',
      payload: { markdown: '# Proposed' }, evidence: {}, status: 'pending',
      attempt: {
        id: 'attempt-1', basePageVersionId: 'version-1', basePageUpdatedAt: updatedAt,
        baseContentHash: 'a'.repeat(64),
      },
    }) },
    collaborationArtifactChangeSetLink: { findUnique: jest.fn().mockResolvedValue({
      artifactId: 'artifact-1', changeSetId: 'change-1', runId: 'run-1', taskId: 'task-1',
      spaceId: 'space-1', pageId: 'page-1', changeSet: { status: 'pending_review' },
    }) },
    page: { findFirst: jest.fn().mockResolvedValue({
      id: 'page-1', title: 'Page', content: '# Current', updatedAt,
      slug: 'page', format: 'markdown', parentId: null, folderId: 'folder-1',
      syncPath: 'pages/Page.md', syncPathKey: 'pages/page.md',
    }) },
    pageVersion: { findFirst: jest.fn(async ({ where }: any) => where.id
      ? { id: 'version-1', pageId: 'page-1', title: 'Page', content: '# Baseline', createdAt: updatedAt }
      : { id: 'version-current' }) },
    spaceMember: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const authorization: any = {
    assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'editor', userId: 'human-1' }),
  };
  return {
    service: new RunService(
      prisma, authorization, {} as any, {} as any, {} as any, {} as any, {} as any,
      new PageResultService(),
    ),
    prisma, authorization,
  };
}

describe('RunService human Page review comparison', () => {
  it('uses the linked Artifact Attempt baseline and exact PageVersion', async () => {
    const h = serviceWith();
    const result = await h.service.getHumanPageReviewComparison(
      'space-1', 'run-1', 'review-1', principal as any,
    );
    expect(result).toEqual(expect.objectContaining({
      mode: 'candidate', canDecide: true,
      target: expect.objectContaining({ pageId: 'page-1', title: 'Page' }),
      baseline: expect.objectContaining({ pageVersionId: 'version-1', markdown: '# Baseline', available: true }),
      candidate: expect.objectContaining({ changeSetId: 'change-1', markdown: '# Proposed' }),
      current: expect.objectContaining({ pageVersionId: 'version-current', markdown: '# Current' }),
    }));
    expect(h.prisma.pageVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'version-1', pageId: 'page-1' },
    }));
  });

  it('reports a same-body structural Page change as a conflict through the exact current-version predicate', async () => {
    const updatedAt = new Date('2026-09-05T10:00:00.000Z');
    const markdown = '# Same body';
    const versionLookup = jest.fn(async ({ where }: any) => (
      where.id
        ? { id: 'version-1', pageId: 'page-1', title: 'Old title', content: markdown, createdAt: updatedAt }
        : null
    ));
    const h = serviceWith({
      collaborationTaskArtifact: { findFirst: jest.fn().mockResolvedValue({
        id: 'artifact-1', runId: 'run-1', taskId: 'task-1', attemptId: 'attempt-1',
        payload: { markdown: '# Proposed' }, evidence: {}, status: 'pending',
        attempt: {
          id: 'attempt-1', basePageVersionId: 'version-1', basePageUpdatedAt: updatedAt,
          baseContentHash: canonicalPageContentHash(markdown),
        },
      }) },
      page: { findFirst: jest.fn().mockResolvedValue({
        id: 'page-1', title: 'New title', content: markdown, updatedAt,
        slug: 'page', format: 'markdown', parentId: null, folderId: 'folder-2',
        syncPath: 'pages/Page.md', syncPathKey: 'pages/page.md',
      }) },
      pageVersion: { findFirst: versionLookup },
    });
    const result = await h.service.getHumanPageReviewComparison('space-1', 'run-1', 'review-1', principal as any);
    expect(result.mode).toBe('candidate');
    if (result.mode !== 'candidate') throw new Error('expected candidate comparison');
    expect((result.current as any).pageVersionId).toBeNull();
    expect(result.conflict).toBe(true);
    expect(versionLookup).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        pageId: 'page-1', title: 'New title', content: markdown, folderId: 'folder-2',
        slug: 'page', format: 'markdown', parentId: null,
        syncPath: 'pages/Page.md', syncPathKey: 'pages/page.md',
      }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
  });

  it('labels a null-version stale baseline unavailable instead of inventing it from current Page', async () => {
    const updatedAt = new Date('2026-09-05T10:00:00.000Z');
    const h = serviceWith({
      collaborationTaskArtifact: { findFirst: jest.fn().mockResolvedValue({
        id: 'artifact-1', runId: 'run-1', taskId: 'task-1', attemptId: 'attempt-1',
        payload: { markdown: '# Proposed' }, evidence: {}, status: 'pending',
        attempt: { id: 'attempt-1', basePageVersionId: null, basePageUpdatedAt: updatedAt, baseContentHash: '0'.repeat(64) },
      }) },
      pageVersion: { findFirst: jest.fn() },
    });
    const result = await h.service.getHumanPageReviewComparison('space-1', 'run-1', 'review-1', principal as any);
    expect(result.mode).toBe('candidate');
    if (result.mode !== 'candidate') throw new Error('expected candidate comparison');
    expect(result.baseline).toEqual(expect.objectContaining({ available: false, markdown: null, pageVersionId: null }));
    expect(result.conflict).toBe(true);
    expect(h.prisma.pageVersion.findFirst).toHaveBeenCalledTimes(1);
    expect(h.prisma.pageVersion.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: expect.anything() }),
    }));
  });

  it('returns adopted-current metadata for a completed Artifact without a Link', async () => {
    const versionLookup = jest.fn()
      .mockResolvedValueOnce({
        id: 'version-2', pageId: 'page-1', title: 'Page', content: '# Human current', createdAt: new Date(),
      })
      .mockResolvedValueOnce({ id: 'version-3' });
    const h = serviceWith({
      collaborationReview: { findFirst: jest.fn().mockResolvedValue({
        id: 'review-1', runId: 'run-1', sourceTaskId: 'task-1', artifactId: 'artifact-adopted',
        status: 'approved', minimumRole: 'editor', reviewerUserIds: [],
      }) },
      collaborationTaskArtifact: { findFirst: jest.fn().mockResolvedValue({
        id: 'artifact-adopted', runId: 'run-1', taskId: 'task-1', attemptId: 'attempt-1', status: 'accepted',
        payload: { markdown: '# Human current', adoptedCurrentPage: {
          kind: 'human_adopt_current', pageId: 'page-1', pageVersionId: 'version-2',
          contentHash: canonicalPageContentHash('# Human current'), adoptedByUserId: 'human-1',
        } }, evidence: {}, attempt: { id: 'attempt-1', basePageVersionId: null, basePageUpdatedAt: null, baseContentHash: null },
      }) },
      collaborationArtifactChangeSetLink: { findUnique: jest.fn().mockResolvedValue(null) },
      page: { findFirst: jest.fn().mockResolvedValue({
        id: 'page-1', title: 'Page', content: '# Human current', updatedAt: new Date(),
        slug: 'page', format: 'markdown', parentId: null, folderId: 'folder-1',
        syncPath: 'pages/Page.md', syncPathKey: 'pages/page.md',
      }) },
      pageVersion: { findFirst: versionLookup },
    });
    const result = await h.service.getHumanPageReviewComparison('space-1', 'run-1', 'review-1', principal as any);
    expect(result).toEqual(expect.objectContaining({
      mode: 'adopted_current', canDecide: false, conflict: true,
      adoptedCurrent: expect.objectContaining({ pageId: 'page-1', pageVersionId: 'version-2' }),
      current: expect.objectContaining({ pageVersionId: 'version-3', markdown: '# Human current' }),
    }));
    expect(versionLookup).toHaveBeenCalledTimes(2);
  });

  it('fails closed before reading a Review from another Space', async () => {
    const h = serviceWith({
      collaborationRun: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(h.service.getHumanPageReviewComparison(
      'space-other', 'run-1', 'review-1', principal as any,
    )).rejects.toMatchObject({ businessCode: 'RESOURCE_NOT_FOUND' });
    expect(h.prisma.collaborationReview.findFirst).not.toHaveBeenCalled();
  });

  it('serves the largest legal escaped Page candidate within the separate 8 MB budget', async () => {
    const escaped = '\u0001'.repeat(200_000);
    const updatedAt = new Date('2026-09-05T10:00:00.000Z');
    const hash = canonicalPageContentHash(escaped);
    const h = serviceWith({
      collaborationTaskArtifact: { findFirst: jest.fn().mockResolvedValue({
        id: 'artifact-1', runId: 'run-1', taskId: 'task-1', attemptId: 'attempt-1',
        payload: { markdown: escaped }, evidence: [], status: 'pending',
        attempt: {
          id: 'attempt-1', basePageVersionId: 'version-1',
          basePageUpdatedAt: updatedAt, baseContentHash: hash,
        },
      }) },
      page: { findFirst: jest.fn().mockResolvedValue({
        id: 'page-1', title: 'Page', content: escaped, updatedAt,
        slug: 'page', format: 'markdown', parentId: null, folderId: 'folder-1',
        syncPath: 'pages/Page.md', syncPathKey: 'pages/page.md',
      }) },
      pageVersion: { findFirst: jest.fn().mockResolvedValue({
        id: 'version-1', pageId: 'page-1', title: 'Page', content: escaped, createdAt: updatedAt,
      }) },
    });
    const result = await h.service.getHumanPageReviewComparison(
      'space-1', 'run-1', 'review-1', principal as any,
    );
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(8_000_000);
    expect(result.mode).toBe('candidate');
  });
});
