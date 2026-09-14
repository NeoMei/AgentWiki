import { ReviewService } from './review.service';
import { canonicalPageContentHash } from '../collaboration-workflows/page-baseline';

// Transactional state double: only a successfully completed callback commits.
// This exercises the public service, including approval and publication boundaries.
function fixture(type: string, baseline: Record<string, unknown>, oneShot = false) {
  let beforeTransaction: (() => void) | undefined;
  const original = new Date('2026-09-14T00:00:00.000Z');
  let state: any = {
    status: oneShot ? 'pending_review' : 'approved', approvals: [], versions: [],
    items: [{ id: 'item', type, status: oneShot ? 'pending' : 'accepted', payload: {
      pageId: 'page', expectedTreeRevision: '0', changes: { content: 'Candidate' }, ...baseline,
    } }],
    page: { id: 'page', spaceId: 'space', title: 'Title', content: 'Original',
      updatedAt: original, lastModifiedAt: original, deletedAt: null, authorId: 'owner',
      syncPath: 'pages/Title.md', syncPathKey: 'pages/title.md', knowledgeKey: 'key' },
  };
  const view = () => ({ id: 'cs', spaceId: 'space', createdByUserId: 'owner',
    createdByAgentId: null, approvals: state.approvals, items: state.items, status: state.status });
  const search = { indexPage: jest.fn() };
  const advance = jest.fn();
  const prisma: any = {
    changeSet: { findUnique: jest.fn(async () => structuredClone(view())) },
    $transaction: jest.fn(async (callback: any) => {
      beforeTransaction?.(); beforeTransaction = undefined;
      const local = structuredClone(state);
      const tx: any = {
        changeSet: { updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.status && where.status !== local.status) return { count: 0 };
          local.status = data.status; return { count: 1 };
        }) },
        changeItem: {
          count: jest.fn(async ({ where }: any) => local.items.filter((i: any) => i.status === where.status).length),
          updateMany: jest.fn(async ({ where, data }: any) => {
            local.items.filter((i: any) => i.status === where.status).forEach((i: any) => Object.assign(i, data));
            return { count: 1 };
          }),
          update: jest.fn(async ({ where, data }: any) => Object.assign(local.items.find((i: any) => i.id === where.id), data)),
        },
        approval: { create: jest.fn(async ({ data }: any) => local.approvals.push(data)) },
        page: {
          findFirst: jest.fn(async () => structuredClone(local.page)),
          findUnique: jest.fn(async () => local.page), findMany: jest.fn(async () => [local.page]),
          updateMany: jest.fn(async ({ data }: any) => { Object.assign(local.page, data); return { count: 1 }; }),
        },
        pageVersion: { create: jest.fn(async ({ data }: any) => local.versions.push(data)) },
        pageSearchDocument: { upsert: jest.fn(), deleteMany: jest.fn() },
      };
      const result = await callback(tx);
      state = local;
      return result;
    }),
  };
  const service = new ReviewService(prisma, search as any, { advanceLocked: advance } as any,
    {} as any, { enqueue: jest.fn() } as any, {
      lockPageMutationSpace: jest.fn(async (tx: any) => Object.assign(tx, { contentTreeRevision: 0n })),
      advancePageMutation: advance,
    } as any);
  return { service, search, advance, state: () => state,
    rejectBeforeTransaction: () => { beforeTransaction = () => { state.items[0].status = 'rejected'; }; },
    humanEdit: () => { state.page.content = 'Human edit'; state.page.updatedAt = new Date('2026-09-14T01:00:00.000Z'); } };
}

const baseline = { expectedUpdatedAt: '2026-09-14T00:00:00.000Z' };

describe('Q3 candidate publication conflict regression', () => {
  it.each(['update_page', 'archive_page'])('%s without a baseline cannot overwrite a human edit', async (type) => {
    const f = fixture(type, {}); f.humanEdit();
    const before = structuredClone(f.state());
    await expect(f.service.publish('cs')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(f.state()).toEqual(before);
    expect(f.search.indexPage).not.toHaveBeenCalled();
    expect(f.advance).not.toHaveBeenCalled();
  });

  it.each(['update_page', 'archive_page'])('%s stale one-shot review rolls back approval and remains retryable', async (type) => {
    const f = fixture(type, baseline, true); f.humanEdit();
    const before = structuredClone(f.state());
    for (let retry = 0; retry < 2; retry++) {
      await expect(f.service.reviewPublish('cs', 'reviewer')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
      expect(f.state()).toEqual(before);
    }
    expect(f.search.indexPage).not.toHaveBeenCalled();
    expect(f.advance).not.toHaveBeenCalled();
  });

  it.each(['update_page', 'archive_page'])('%s with the current baseline publishes and preserves history', async (type) => {
    const f = fixture(type, baseline, true);
    await f.service.reviewPublish('cs', 'reviewer');
    expect(f.state().status).toBe('published');
    expect(f.state().items[0].status).toBe('published');
    expect(f.state().approvals).toHaveLength(1);
    expect(f.state().versions).toEqual([expect.objectContaining({ content: 'Original', title: 'Title' })]);
    expect(f.state().items[0].payload.before.content).toBe('Original');
    expect(f.state().page.content).toBe(type === 'update_page' ? 'Candidate' : 'Original');
    expect(f.state().page.deletedAt === null).toBe(type === 'update_page');
  });

  it.each(['update_page', 'archive_page'])('%s checks a supplied content hash even with a current timestamp', async (type) => {
    const f = fixture(type, { ...baseline, expectedContentHash: canonicalPageContentHash('Different') });
    await expect(f.service.publish('cs')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(f.state().versions).toEqual([]);
  });

  it.each([null, '', 123, 'invalid'])('rejects malformed baseline %p', async (expectedUpdatedAt) => {
    const f = fixture('update_page', { expectedUpdatedAt });
    await expect(f.service.publish('cs')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
  });

  it('does not publish an item rejected concurrently after loading the review', async () => {
    const f = fixture('update_page', baseline, true);
    f.rejectBeforeTransaction();
    await expect(f.service.reviewPublish('cs', 'reviewer')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(f.state().items[0].status).toBe('rejected');
    expect(f.state().page.content).toBe('Original');
    expect(f.state().approvals).toEqual([]);
  });

  it('a later conflict rolls back an earlier valid item, versions, approval and indexes', async () => {
    const f = fixture('update_page', baseline, true);
    f.state().items.push({ id: 'stale', type: 'update_page', status: 'pending',
      payload: { pageId: 'page', expectedUpdatedAt: '2026-09-13T00:00:00.000Z', changes: { content: 'Stale' } } });
    const before = structuredClone(f.state());
    await expect(f.service.reviewPublish('cs', 'reviewer')).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
    expect(f.state()).toEqual(before);
    expect(f.search.indexPage).not.toHaveBeenCalled();
  });
});
