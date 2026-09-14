import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { ReviewService } from './review.service';
import { SearchService } from '../core/search/search.service';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import { ReadableSyncPathService } from '../core/sync/readable-sync-path.service';
import { ContentTreeService } from '../content-tree/content-tree.service';

const databaseUrl = safeTestUrl();
const dbIt = databaseUrl ? it : it.skip;

// The standard random-schema harness owns schema creation and cleanup.
function safeTestUrl(): string | undefined {
  const value = process.env.COLLABORATION_TEST_DATABASE_URL;
  if (!value || value !== process.env.DATABASE_URL) return undefined;
  const url = new URL(value);
  return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    && decodeURIComponent(url.pathname).includes('test')
    && /^collaboration_test_[a-z0-9_]+$/.test(url.searchParams.get('schema') ?? '')
    ? value : undefined;
}

async function withFixture(run: (f: any) => Promise<void>) {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const id = randomUUID();
  const user = await db.user.create({ data: { email: `${id}@q3.test` } });
  const space = await db.space.create({ data: { name: 'Q3 test', slug: id } });
  const page = await db.page.create({ data: {
    title: 'Original', slug: 'original', content: 'Original body',
    spaceId: space.id, authorId: user.id, syncPath: 'pages/Original.md', syncPathKey: 'pages/original.md',
  } });
  const paths = new ReadableSyncPathService();
  const writer = new SpaceRevisionWriterService(db as any, {} as any);
  const tree = new ContentTreeService(db as any, writer, paths);
  // Real advisory/tree locks and all review writes; revision serialization is
  // covered by the coordinator's full harness, not duplicated in this test.
  jest.spyOn(tree, 'advancePageMutation').mockResolvedValue({ treeRevision: 0n, syncRevisionId: 'test' });
  const search = { indexPage: jest.fn() };
  const review = new ReviewService(db as any, search as any, writer, paths, { enqueue: jest.fn() } as any, tree);
  try { await run({ db, user, space, page, review, search }); }
  finally {
    await db.space.delete({ where: { id: space.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
}

describe('Q3 real PostgreSQL publication and hybrid search', () => {
  dbIt.each(['update_page', 'archive_page'])('%s missing/stale baselines preserve human edits and pending review across retries', async (type) => {
    await withFixture(async ({ db, user, space, page, review, search }) => {
      for (const baseline of [{}, { expectedUpdatedAt: page.updatedAt.toISOString() }]) {
        const cs = await db.changeSet.create({ data: {
          title: 'Candidate', spaceId: space.id, createdByUserId: user.id, status: 'pending_review',
          items: { create: { type, status: 'pending', payload: {
            pageId: page.id, expectedTreeRevision: '0', ...baseline, changes: { content: 'Candidate body' },
          } } },
        } });
        await db.page.update({ where: { id: page.id }, data: {
          content: 'Human edit', updatedAt: new Date(page.updatedAt.getTime() + 1000),
        } });
        for (let retry = 0; retry < 2; retry++) {
          await expect(review.reviewPublish(cs.id, user.id)).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
          expect(await db.changeSet.findUnique({ where: { id: cs.id } })).toMatchObject({ status: 'pending_review', reviewedAt: null });
          expect(await db.changeItem.findFirst({ where: { changeSetId: cs.id } })).toMatchObject({ status: 'pending' });
          expect(await db.approval.count({ where: { changeSetId: cs.id } })).toBe(0);
          expect(await db.pageVersion.count({ where: { pageId: page.id } })).toBe(0);
          expect(await db.page.findUnique({ where: { id: page.id } })).toMatchObject({ content: 'Human edit', deletedAt: null });
        }
      }
      expect(search.indexPage).not.toHaveBeenCalled();
    });
  });

  dbIt.each(['update_page', 'archive_page'])('%s current baseline preserves original PageVersion and approves atomically', async (type) => {
    await withFixture(async ({ db, user, space, page, review }) => {
      const cs = await db.changeSet.create({ data: {
        title: 'Candidate', spaceId: space.id, createdByUserId: user.id, status: 'pending_review',
        items: { create: { type, status: 'pending', payload: {
          pageId: page.id, expectedTreeRevision: '0', expectedUpdatedAt: page.updatedAt.toISOString(),
          changes: { content: 'Candidate body' },
        } } },
      } });
      await review.reviewPublish(cs.id, user.id);
      expect(await db.changeSet.findUnique({ where: { id: cs.id } })).toMatchObject({ status: 'published' });
      expect(await db.approval.count({ where: { changeSetId: cs.id } })).toBe(1);
      expect(await db.pageVersion.findFirst({ where: { pageId: page.id } })).toMatchObject({ content: 'Original body' });
      const current = await db.page.findUnique({ where: { id: page.id } });
      expect(current.content).toBe(type === 'update_page' ? 'Candidate body' : 'Original body');
      expect(current.deletedAt === null).toBe(type === 'update_page');
    });
  });

  dbIt('rolls back an already applied valid item when the next item conflicts', async () => {
    await withFixture(async ({ db, user, space, page, review }) => {
      const cs = await db.changeSet.create({ data: {
        title: 'Mixed candidates', spaceId: space.id, createdByUserId: user.id, status: 'pending_review',
        items: { create: [
          { type: 'update_page', status: 'pending', payload: { pageId: page.id, expectedUpdatedAt: page.updatedAt.toISOString(), changes: { content: 'First' } } },
          { type: 'update_page', status: 'pending', payload: { pageId: page.id, expectedUpdatedAt: '2000-01-01T00:00:00.000Z', changes: { content: 'Stale' } } },
        ] },
      } });
      await expect(review.reviewPublish(cs.id, user.id)).rejects.toMatchObject({ businessCode: 'CHANGESET_CONFLICT' });
      expect(await db.page.findUnique({ where: { id: page.id } })).toMatchObject({ content: 'Original body' });
      expect(await db.pageVersion.count({ where: { pageId: page.id } })).toBe(0);
      expect(await db.approval.count({ where: { changeSetId: cs.id } })).toBe(0);
      expect(await db.changeItem.count({ where: { changeSetId: cs.id, status: 'pending' } })).toBe(2);
    });
  });

  dbIt.each(['create_page', 'update_page'])('%s rejects an explicit blank title without partial approval or writes', async type => {
    await withFixture(async ({ db, user, space, page, review }) => {
      const cs = await db.changeSet.create({ data: {
        title: 'Legacy invalid candidate', spaceId: space.id, createdByUserId: user.id, status: 'pending_review',
        items: { create: { type, status: 'pending', payload: {
          title: ' \t\u3000', content: 'New body', pageId: page.id,
          expectedTreeRevision: '0', expectedUpdatedAt: page.updatedAt.toISOString(),
          changes: { title: ' \t\u3000', content: 'New body' },
        } } },
      } });
      await expect(review.reviewPublish(cs.id, user.id)).rejects.toThrow('non-whitespace');
      expect(await db.page.findUnique({ where: { id: page.id } })).toMatchObject({ title: page.title, content: page.content });
      expect(await db.page.count({ where: { spaceId: space.id } })).toBe(1);
      expect(await db.pageVersion.count({ where: { pageId: page.id } })).toBe(0);
      expect(await db.approval.count({ where: { changeSetId: cs.id } })).toBe(0);
      expect(await db.changeSet.findUnique({ where: { id: cs.id } })).toMatchObject({ status: 'pending_review' });
    });
  });

  dbIt('preserves historical blank titles during content-only publication', async () => {
    await withFixture(async ({ db, user, space, page, review }) => {
      const legacy = await db.page.update({ where: { id: page.id }, data: { title: '   ' } });
      const cs = await db.changeSet.create({ data: {
        title: 'Content only', spaceId: space.id, createdByUserId: user.id, status: 'pending_review',
        items: { create: { type: 'update_page', status: 'pending', payload: {
          pageId: page.id, expectedUpdatedAt: legacy.updatedAt.toISOString(), changes: { content: 'Human content update' },
        } } },
      } });
      await review.reviewPublish(cs.id, user.id);
      expect(await db.page.findUnique({ where: { id: page.id } })).toMatchObject({ title: '   ', content: 'Human content update' });
      expect(await db.pageVersion.findFirst({ where: { pageId: page.id } })).toMatchObject({ title: '   ', content: page.content });
    });
  });

  dbIt('review detail warns about exact existing bodies only in the active authorized space', async () => {
    await withFixture(async ({ db, user, space, page, review }) => {
      const hidden = await db.space.create({ data: { name: 'Private', slug: randomUUID() } });
      try {
        const other = await db.page.create({ data: {
          title: 'Other same-space page', slug: randomUUID(), content: page.content, authorId: user.id, spaceId: space.id,
          syncPath: 'pages/other.md', syncPathKey: 'pages/other.md',
        } });
        await db.page.createMany({ data: [
          { title: 'Deleted', spaceId: space.id, deletedAt: new Date() },
          { title: 'Private', spaceId: hidden.id, deletedAt: null },
        ].map(value => ({ ...value, slug: randomUUID(), content: page.content, authorId: user.id,
          syncPath: `pages/${value.title}.md`, syncPathKey: `pages/${value.title.toLowerCase()}.md` })) });
        const cs = await db.changeSet.create({ data: {
          title: 'Duplicate candidates', spaceId: space.id, createdByUserId: user.id, status: 'pending_review',
          items: { create: [
            { type: 'create_page', status: 'pending', payload: { title: 'Candidate', content: page.content, expectedTreeRevision: '0' } },
            { type: 'update_page', status: 'pending', payload: { pageId: page.id, expectedUpdatedAt: page.updatedAt.toISOString(), changes: { content: page.content } } },
          ] },
        } });
        const before = await db.changeSet.findUnique({ where: { id: cs.id }, include: { items: true, approvals: true } });
        const result = await review.get(cs.id);
        const create = before.items.find((item: any) => item.type === 'create_page');
        const update = before.items.find((item: any) => item.type === 'update_page');
        expect(result.duplicateContentWarnings).toEqual(expect.arrayContaining([
          { itemId: create.id, pages: expect.arrayContaining([{ id: page.id, title: page.title }, { id: other.id, title: other.title }]) },
          { itemId: update.id, pages: [{ id: other.id, title: other.title }] },
        ]));
        expect(result.duplicateContentWarnings.find((w: any) => w.itemId === create.id).pages).toHaveLength(2);
        expect(await db.changeSet.findUnique({ where: { id: cs.id }, include: { items: true, approvals: true } })).toEqual(before);
        expect(await db.pageVersion.count({ where: { pageId: page.id } })).toBe(0);
        expect((await review.reviewPublish(cs.id, user.id)).status).toBe('published');
      } finally { await db.space.delete({ where: { id: hidden.id } }); }
    });
  });

  dbIt('looks up 500 distinct candidate bodies in one bounded metadata query', async () => {
    await withFixture(async ({ db, user, space, page, review }) => {
      const cs = await db.changeSet.create({ data: {
        title: 'Many distinct candidates', spaceId: space.id, createdByUserId: user.id, status: 'pending_review',
        items: { create: Array.from({ length: 500 }, (_, index) => ({
          type: 'create_page', status: 'pending', payload: { content: index === 499 ? page.content : `Missing ${index}` },
        })) },
      }, include: { items: true } });
      const raw = jest.spyOn(db, '$queryRaw');
      const result = await review.get(cs.id);
      expect(raw).toHaveBeenCalledTimes(1);
      expect(await raw.mock.results[0].value).toEqual([
        { groupIndex: expect.any(Number), id: page.id, title: page.title },
      ]);
      expect(result.duplicateContentWarnings).toEqual([{
        itemId: cs.items.find((item: any) => item.payload.content === page.content).id,
        pages: [{ id: page.id, title: page.title }],
      }]);
      raw.mockRestore();
    });
  });

  dbIt('ranks a late exact title across a broad corpus before limiting and hydrates only winners', async () => {
    await withFixture(async ({ db, user, space }) => {
      const body = 'needle ' + 'large body '.repeat(1000);
      const pages = Array.from({ length: 250 }, (_, index) => ({
        id: randomUUID(), title: `Body ${index}`, slug: randomUUID(), content: body,
        spaceId: space.id, authorId: user.id, syncPath: `pages/body-${index}.md`, syncPathKey: `pages/body-${index}.md`,
      }));
      await db.page.createMany({ data: pages });
      await db.pageSearchDocument.createMany({ data: pages.map(page => ({
        pageId: page.id, text: `${page.title}\n${page.content}`, contentHash: 'test', indexedAt: new Date('2026-09-14'),
      })) });
      const substring = await db.page.create({ data: {
        title: 'A needle guide', slug: randomUUID(), content: body, spaceId: space.id, authorId: user.id,
        syncPath: 'pages/substring.md', syncPathKey: 'pages/substring.md',
        searchDocument: { create: { text: 'A needle guide', contentHash: 'test', indexedAt: new Date('2001-01-01') } },
      } });
      const exact = await db.page.create({ data: {
        title: 'NEEDLE', slug: randomUUID(), content: body, spaceId: space.id, authorId: user.id,
        syncPath: 'pages/exact.md', syncPathKey: 'pages/exact.md',
        searchDocument: { create: { text: 'NEEDLE', contentHash: 'test', indexedAt: new Date('2000-01-01') } },
      } });
      const vector = [1, ...Array(2047).fill(0)];
      await db.$executeRaw(Prisma.sql`UPDATE "Page" SET "embeddingVector" = ${JSON.stringify(vector)}::public.halfvec WHERE "id" = ${pages[0].id}`);
      const hydrate = jest.spyOn(db.page, 'findMany');
      const documents = jest.spyOn(db.pageSearchDocument, 'findMany');
      const raw = jest.spyOn(db, '$queryRaw');
      const llm = { generateEmbedding: jest.fn().mockResolvedValue({ embedding: vector }) };
      const search = new SearchService(db, llm as any);
      for (const limit of [1, 2, 5]) {
        hydrate.mockClear(); documents.mockClear(); raw.mockClear();
        const results = await search.searchPages('needle', undefined, limit, [space.id]);
        expect(results[0].page.id).toBe(exact.id);
        if (limit > 1) expect(results[1].page.id).toBe(substring.id);
        expect(results).toHaveLength(limit);
        expect(documents).not.toHaveBeenCalled();
        expect(hydrate).toHaveBeenCalledTimes(1);
        expect((hydrate.mock.calls[0][0] as any).where.id.in).toEqual(results.map(result => result.page.id));
        for (const call of raw.mock.results) {
          const candidates = await call.value;
          expect(candidates.length).toBeLessThanOrEqual(limit);
          for (const candidate of candidates) {
            expect(candidate).not.toHaveProperty('content');
            expect(candidate).not.toHaveProperty('text');
            expect(candidate).not.toHaveProperty('page');
          }
        }
      }
      llm.generateEmbedding.mockResolvedValue(null);
      expect((await search.searchPages('needle', space.id, 1, []))[0].page.id).toBe(exact.id);
      expect(await search.searchPages('%_needle', undefined, 1, [space.id])).toEqual([]);
    });
  });

  dbIt('pgvector and lexical queries combine titles, semantic-only hits, limits and authorization', async () => {
    await withFixture(async ({ db, user, space }) => {
      const hidden = await db.space.create({ data: { name: 'Private', slug: randomUUID() } });
      try {
        const vector = [1, ...Array(2047).fill(0)];
        for (const [title, hasVector, targetSpace, deletedAt] of [
          ['Project notes', true, space.id, null], ['PROJECT', false, space.id, null],
          ['Old project', false, space.id, null], ['Related idea', true, space.id, null],
          ['Private project', true, hidden.id, null], ['Deleted project', true, space.id, new Date()],
        ] as const) {
          const page = await db.page.create({ data: {
            title, slug: randomUUID(), content: title, spaceId: targetSpace, authorId: user.id,
            syncPath: `pages/${title}.md`, syncPathKey: `pages/${title.toLowerCase()}.md`, deletedAt,
            searchDocument: { create: { text: title, contentHash: 'test' } },
          } });
          if (hasVector) await db.$executeRaw(Prisma.sql`UPDATE "Page" SET "embeddingVector" = ${JSON.stringify(vector)}::public.halfvec WHERE "id" = ${page.id}`);
        }
        const llm = { generateEmbedding: jest.fn().mockResolvedValue({ embedding: vector }) };
        const search = new SearchService(db, llm as any);
        const result = await search.searchPages('project', undefined, 10, [space.id]);
        expect(new Set(result.map(r => r.page.title))).toEqual(new Set(['Project notes', 'PROJECT', 'Old project', 'Related idea']));
        expect(result[0].page.title).toBe('PROJECT');
        expect(result.find(r => r.page.title === 'Related idea')).toMatchObject({ matchType: 'semantic', similarity: 1 });
        expect(result.find(r => r.page.title === 'Old project')).toMatchObject({ matchType: 'text', similarity: 0 });
        expect((await search.searchPages('project', undefined, 1, [space.id]))[0].page.title).toBe('PROJECT');
        expect(await search.searchPages('project', undefined, 10, [])).toEqual([]);
        llm.generateEmbedding.mockRejectedValue(new Error('offline'));
        expect((await search.searchPages('project', undefined, 10, [space.id])).map(r => r.matchType)).toEqual(['text', 'text', 'text']);
      } finally { await db.space.delete({ where: { id: hidden.id } }); }
    });
  });
});
