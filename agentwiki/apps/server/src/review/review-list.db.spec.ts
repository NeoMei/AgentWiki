import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { SourceFreshnessService } from '../core/source-freshness/source-freshness.service';
import { ReviewService } from './review.service';

const value = process.env.COLLABORATION_TEST_DATABASE_URL;
const parsed = value ? new URL(value) : undefined;
const safe = value === process.env.DATABASE_URL && parsed && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  && decodeURIComponent(parsed.pathname).includes('test') && /^collaboration_test_[a-z0-9_]+$/.test(parsed.searchParams.get('schema') ?? '');
const dbDescribe = safe ? describe : describe.skip;

dbDescribe('review full-history search in real PostgreSQL', () => {
  let db: PrismaClient;
  let review: ReviewService;
  let owner: { id: string };
  let space: { id: string };
  let other: { id: string };
  let hidden: { id: string };
  let target: { id: string };
  let hiddenTarget: { id: string };
  const prefix = randomUUID();
  const id = (index: number) => `${prefix}-${String(index).padStart(3, '0')}`;
  const time = new Date('2026-10-14T10:00:00Z');

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: value } } });
    const authorization = new AuthorizationService(db as any);
    review = new ReviewService(new SourceFreshnessService(db as any, authorization), db as any, {} as any, {} as any, {} as any);
    owner = await db.user.create({ data: { email: `${prefix}@review.test`, name: 'History Submitter' } });
    space = await db.space.create({ data: { name: 'Review one', slug: `${prefix}-one`, members: { create: { userId: owner.id, role: 'owner' } } } });
    other = await db.space.create({ data: { name: 'Review two', slug: `${prefix}-two`, members: { create: { userId: owner.id, role: 'owner' } } } });
    hidden = await db.space.create({ data: { name: 'Hidden', slug: `${prefix}-hidden` } });
    target = await db.page.create({ data: { title: 'Rare_% title', syncPath: 'notes/Rare_% title.md', syncPathKey: 'notes/rare_% title.md', slug: prefix, spaceId: space.id, authorId: owner.id } });
    hiddenTarget = await db.page.create({ data: { title: 'Private title', syncPath: 'notes/private.md', syncPathKey: 'notes/private.md', slug: `${prefix}-private`, spaceId: hidden.id, authorId: owner.id } });
    await db.changeSet.createMany({ data: Array.from({ length: 61 }, (_, index) => ({ id: id(index), title: 'Proposed update: same-id', spaceId: space.id, status: 'pending_review', createdByUserId: owner.id, createdAt: time })) });
    await db.changeItem.createMany({ data: Array.from({ length: 61 }, (_, index) => ({ changeSetId: id(index), type: index === 0 ? 'update_page' : 'create_page', payload: index === 0 ? { pageId: target.id } : { title: `General ${index}` } })) });
    await db.changeSet.create({ data: { id: id(90), title: 'Other space', spaceId: other.id, status: 'published', createdByUserId: owner.id, createdAt: new Date('2026-10-13T10:00:00Z') } });
    await db.changeSet.create({ data: { id: id(91), title: 'Hidden item', spaceId: hidden.id, status: 'pending_review', createdByUserId: owner.id } });
  }, 30000);
  afterAll(async () => {
    if (db) {
      await db.space.deleteMany({ where: { id: { in: [space?.id, other?.id, hidden?.id].filter(Boolean) } } });
      if (owner) await db.user.delete({ where: { id: owner.id } });
      await db.$disconnect();
    }
  });

  it('paginates beyond two screens deterministically and finds a page/path outside the first screen', async () => {
    const all: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await review.listPage([space.id], { userId: owner.id }, { page, pageSize: 25 });
      expect(result.total).toBe(61);
      expect(result.items.length).toBe(page === 3 ? 11 : 25);
      all.push(...result.items.map(row => row.id));
    }
    expect(all).toEqual(Array.from({ length: 61 }, (_, index) => id(60 - index)));
    for (const q of ['Rare_%', 'notes/Rare_% title.md']) {
      const result = await review.listPage([space.id], { userId: owner.id }, { page: 1, pageSize: 25, q });
      expect(result.total).toBe(1);
      expect(result.items).toMatchObject([{ id: id(0), targets: [{ title: 'Rare_% title', path: 'notes/Rare_% title.md' }], submitter: { name: 'History Submitter' }, reviewAccess: { canDecide: true } }]);
    }
    expect((await review.listPage([space.id], { userId: owner.id }, { page: 1, pageSize: 25, q: 'History Submitter' })).total).toBe(61);
  });

  it('combines space, state and half-open dates and returns totals for empty/out-of-range pages', async () => {
    const result = await review.listPage([space.id, other.id], { userId: owner.id }, { page: 1, pageSize: 25, status: 'published', from: '2026-10-13T00:00:00Z', to: '2026-10-14T00:00:00Z' }, other.id);
    expect(result.total).toBe(1);
    expect(result.items.map(row => row.id)).toEqual([id(90)]);
    const outside = await review.listPage([space.id], { userId: owner.id }, { page: 99, pageSize: 25 });
    expect(outside).toMatchObject({ items: [], total: 61 });
    expect(await review.listPage([space.id], { userId: owner.id }, { page: 1, pageSize: 25, from: '2026-10-15T00:00:00Z' })).toMatchObject({ items: [], total: 0 });
  });

  it('does not resolve or search a cross-space target and reads owner revocation live', async () => {
    await db.changeItem.updateMany({ where: { changeSetId: id(0) }, data: { payload: { pageId: hiddenTarget.id } } });
    const query = await review.listPage([space.id, other.id], { userId: owner.id }, { page: 1, pageSize: 25, q: 'Private title' });
    expect(query).toMatchObject({ items: [], total: 0 });
    const detail = await review.get(id(0), { userId: owner.id });
    expect(detail.targets).toMatchObject([{ title: null, path: null, unavailable: true }]);
    await db.spaceMember.update({ where: { userId_spaceId: { userId: owner.id, spaceId: space.id } }, data: { role: 'viewer' } });
    expect((await review.get(id(0), { userId: owner.id })).reviewAccess).toEqual({ canDecide: false, reason: 'owner_required' });
    expect((await review.list([space.id], { userId: owner.id }))).toHaveLength(61);
  });
});
