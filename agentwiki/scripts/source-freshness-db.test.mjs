import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { migratePages } from './backfill-sync-v1.mjs';
import { withCollaborationTestDatabase } from './collaboration-test-database.mjs';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { SourceFreshnessService } = require('./dist/core/source-freshness/source-freshness.service.js');
const { AuthorizationService } = require('./dist/core/authorization/authorization.service.js');
const { SpaceRevisionWriterService } = require('./dist/core/sync/space-revision-writer.service.js');
const { ReadableSyncPathService } = require('./dist/core/sync/readable-sync-path.service.js');
const { ContentTreeService } = require('./dist/content-tree/content-tree.service.js');
const { KnowledgeSyncService } = require('./dist/knowledge-pipeline/knowledge-sync.service.js');
const { SourceService } = require('./dist/knowledge-pipeline/source.service.js');
const { ReviewService } = require('./dist/review/review.service.js');
const { SyncV3PushSessionService } = require('./dist/integrations/obsidian/sync-v3-push-session.service.js');
const { PageService } = require('./dist/core/page/page.service.js');
const { lockSourceHead, assertSourceHeadMatches } = require('./dist/knowledge-pipeline/source-head.js');
const baseDatabaseUrl = process.env.SOURCE_FRESHNESS_TEST_DATABASE_URL;
const hash = text => createHash('sha256').update(text).digest('hex');
const conflict = error => error?.businessCode === 'SOURCE_VERSION_CONFLICT';

// No HTTP/provider/Redis server is started. Existing service methods run against protected isolated PostgreSQL.
test('source generations, receipts, revocation and atomic reviewed publication in real PostgreSQL', {
  skip: !baseDatabaseUrl && 'SOURCE_FRESHNESS_TEST_DATABASE_URL is required', timeout: 180_000,
}, async t => {
  let schema;
  await withCollaborationTestDatabase(baseDatabaseUrl, async scope => {
    schema = scope.schemaName;
    assert.equal(scope.migrationTreeDigest, '27e1fba987e09b55b599433ca7b875c1567234152c74886e003954b723dbe57e');
    const db = new PrismaClient({ datasources: { db: { url: scope.databaseUrl } } });
    const authorization = new AuthorizationService(db);
    const freshness = new SourceFreshnessService(db, authorization);
    const writer = SpaceRevisionWriterService.legacyOnly(db);
    const paths = new ReadableSyncPathService();
    const tree = new ContentTreeService(db, writer, paths);
    const search = { indexPage: async () => ({ lexicalIndexed: true }), deletePageIndex: async () => {} };
    const graph = { enqueue: () => {} };
    const reviews = new ReviewService(freshness, db, search, writer, paths, graph, tree);
    const sources = new SourceService(db, { get: () => undefined }, reviews, authorization, writer);
    const intake = new KnowledgeSyncService(db, { record: async () => {} }, authorization, writer);
    const pages = new PageService(freshness, db, search, writer, paths, graph, {}, authorization, tree);
    try {
      const owner = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: 'Source reviewer' } });
      const principal = { userId: owner.id };
      const secondHuman = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: 'Other editor' } });
      const space = await db.space.create({ data: { name: 'Source lifecycle test', slug: randomUUID(), members: { create: { userId: owner.id, role: 'owner' } } } });
      await db.spaceMember.create({ data: { spaceId: space.id, userId: secondHuman.id, role: 'editor' } });
      const input = (value, sourceKey = 'epochs') => Buffer.from(JSON.stringify({
        okfVersion: '0.1', sourceKey, name: 'Source epochs', kind: 'documents', producer: { name: 'test', version: '1' },
        documents: ['one', 'two'].map(path => { const content = `# ${path}\n\n${value} ${path}\n`; return { path: `${path}.md`, content, contentHash: hash(content), evidence: [] }; }),
      }));
      const sync = (value, key, who = principal, sourceKey) => intake.createSync(space.id, who, input(value, sourceKey), key, true);
      const process = async runId => {
        await db.ingestRun.update({ where: { id: runId }, data: { status: 'reserved' } });
        await sources.processRun(runId);
        return db.changeSet.findUniqueOrThrow({ where: { runId }, include: { items: true } });
      };
      const allPages = () => db.page.findMany({ where: { spaceId: space.id, sourceId: first.sourceId, deletedAt: null }, orderBy: { sourcePath: 'asc' } });
      let first;
      await t.test('concurrent same input advances once and exact-key replay never queues again', async () => {
        const [a, b] = await Promise.all([sync('A', 'K1'), sync('A', 'K1', { userId: secondHuman.id })]);
        first = a;
        assert.equal(a.runId, b.runId); assert.deepEqual([a.status, b.status].sort(), ['existing', 'queued']);
        assert.equal(await db.ingestRun.count({ where: { sourceId: a.sourceId } }), 1);
        assert.equal((await db.source.findUniqueOrThrow({ where: { id: a.sourceId } })).currentSourceGeneration, 1);
      });
      const initial = await process(first.runId);
      await reviews.reviewPublish(initial.id, owner.id, 'review A', principal);
      assert.deepEqual((await allPages()).map(p => p.sourceGeneration), [1, 1]);
      const originalPages = await allPages();
      const noop = await sync('A', 'K-noop');
      assert.equal(noop.status, 'noop');
      const b = await sync('B', 'K2');
      const staleCandidate = await process(b.runId);
      const lateRun = await sources.createRun(first.sourceId, principal, 'late-b');
      const c = await sync('C', 'K3');
      await t.test('late workers and stale candidates fail before approval/page changes; noop replay stays pinned', async () => {
        assert.deepEqual(await sync('A', 'K-noop'), noop);
        await assert.rejects(sync('C', 'K-noop'), conflict);
        assert.equal((await db.source.findUniqueOrThrow({ where: { id: first.sourceId } })).currentSourceGeneration, 3);
        await db.ingestRun.update({ where: { id: lateRun.id }, data: { status: 'reserved' } });
        await assert.rejects(sources.processRun(lateRun.id), conflict);
        assert.equal(await db.changeSet.count({ where: { runId: lateRun.id } }), 0);
        await assert.rejects(reviews.reviewPublish(staleCandidate.id, owner.id, '', principal), conflict);
        assert.equal(await db.approval.count({ where: { changeSetId: staleCandidate.id } }), 0);
        assert.deepEqual((await allPages()).map(p => [p.content, p.sourceGeneration]), originalPages.map(p => [p.content, p.sourceGeneration]));
      });
      const current = await process(c.runId);
      await t.test('partial human review marks only the accepted page with the current generation', async () => {
        const rejected = current.items.find(i => i.payload.sourcePath === 'two.md');
        await reviews.decideItem(current.id, rejected.id, 'rejected', principal);
        await reviews.reviewPublish(current.id, owner.id, 'partial C', principal);
        assert.deepEqual((await allPages()).map(p => p.sourceGeneration), [3, 1]);
      });
      await t.test('manual body edits and PageVersion restoration clear reviewed generation', async () => {
        const page = (await allPages())[0];
        await pages.update(page.id, { content: `${page.content}\nHuman edit`, expectedUpdatedAt: page.updatedAt.toISOString() }, principal);
        assert.equal((await db.page.findUniqueOrThrow({ where: { id: page.id } })).sourceGeneration, null);
        const version = await db.pageVersion.findFirstOrThrow({ where: { pageId: page.id }, orderBy: { createdAt: 'asc' } });
        const revision = (await db.space.findUniqueOrThrow({ where: { id: space.id } })).contentTreeRevision.toString();
        await pages.restoreVersion(page.id, version.id, revision, principal);
        assert.equal((await db.page.findUniqueOrThrow({ where: { id: page.id } })).sourceGeneration, null);
      });
      const a3 = await sync('A', 'K4');
      await t.test('A-B-C-A reuses A version but rejects A1 and restores exact prior generation on revert', async () => {
        assert.equal(a3.sourceVersionId, first.sourceVersionId);
        const head = await db.$transaction(async tx => { await writer.lockSyncSpace(tx, space.id); return lockSourceHead(tx, first.sourceId, space.id); });
        assert.equal(head.generation, 4);
        assert.throws(() => assertSourceHeadMatches(head, { sourceId: first.sourceId, sourceVersionId: first.sourceVersionId, generation: 1 }), conflict);
        const cs = await process(a3.runId);
        await reviews.reviewPublish(cs.id, owner.id, '', principal);
        assert.deepEqual((await allPages()).map(p => p.sourceGeneration), [4, 4]);
        const revision = (await db.space.findUniqueOrThrow({ where: { id: space.id } })).contentTreeRevision.toString();
        await reviews.revert(cs.id, revision, principal);
        assert.deepEqual((await allPages()).map(p => p.sourceGeneration), [null, 1]);
        assert.equal((await db.source.findUniqueOrThrow({ where: { id: first.sourceId } })).currentSourceGeneration, 4);
      });
      await t.test('later accepted item failure rolls back Page and Approval in the publication transaction', async () => {
        const before = await allPages();
        const cs = await db.changeSet.create({ data: { spaceId: space.id, createdByUserId: owner.id, status: 'pending_review', title: 'Atomic failure', items: { create: before.map((p, index) => ({ type: 'update_page', payload: { pageId: p.id, expectedUpdatedAt: index ? new Date(0).toISOString() : p.updatedAt.toISOString(), changes: { content: 'must roll back' } } })) } } });
        await assert.rejects(reviews.reviewPublish(cs.id, owner.id, '', principal), error => error?.businessCode === 'CHANGESET_CONFLICT');
        assert.equal(await db.approval.count({ where: { changeSetId: cs.id } }), 0);
        assert.deepEqual((await allPages()).map(p => [p.content, p.sourceGeneration]), before.map(p => [p.content, p.sourceGeneration]));
      });
      await t.test('archived sources block candidate publication and preserve their accepted head', async () => {
        const run = await sources.createRun(first.sourceId, principal, 'archive-candidate');
        const cs = await process(run.id);
        await sources.update(first.sourceId, { status: 'archived' }, principal);
        await assert.rejects(reviews.reviewPublish(cs.id, owner.id, '', principal), conflict);
        assert.equal((await db.source.findUniqueOrThrow({ where: { id: first.sourceId } })).currentSourceGeneration, 4);
        await sources.update(first.sourceId, { status: 'active' }, principal);
      });
      await t.test('revoked PAT waiting on its row lock cannot replay an accepted request', async () => {
        const pat = await db.apiKeyCredential.create({ data: { name: 'fixture', prefix: 'sf', keyHash: randomUUID(), scopes: ['*'], userId: owner.id } });
        let release; const held = new Promise(done => { release = done; }); let acquired;
        const locked = new Promise(done => { acquired = done; });
        const revoke = db.$transaction(async tx => { await tx.apiKeyCredential.update({ where: { id: pat.id }, data: { revokedAt: new Date() } }); acquired(); await held; });
        await locked;
        const request = sync('A', 'K1', { userId: owner.id, credentialId: pat.id });
        const rejected = assert.rejects(request, error => error?.businessCode === 'SPACE_ACCESS_DENIED');
        await new Promise(done => setTimeout(done, 30)); release(); await Promise.all([revoke, rejected]);
      });
      await t.test('human revocation wins a queued intake before the Space boundary', async () => {
        let release; const held = new Promise(done => { release = done; }); let acquired;
        const locked = new Promise(done => { acquired = done; });
        const revoke = db.$transaction(async tx => { await tx.user.update({ where: { id: secondHuman.id }, data: { lockedAt: new Date() } }); acquired(); await held; });
        await locked;
        const request = sync('A', 'K1', { userId: secondHuman.id });
        const rejected = assert.rejects(request, error => error?.businessCode === 'SPACE_ACCESS_DENIED');
        await new Promise(done => setTimeout(done, 30)); release(); await Promise.all([revoke, rejected]);
      });
      await t.test('publication rechecks live personal review scope after request authorization', async () => {
        const run = await sources.createRun(first.sourceId, principal, 'pat-review-scope');
        const cs = await process(run.id);
        const pat = await db.apiKeyCredential.create({ data: { name: 'downgraded reviewer', prefix: 'sf', keyHash: randomUUID(), scopes: ['pages:read'], userId: owner.id } });
        await assert.rejects(reviews.reviewPublish(cs.id, owner.id, '', { userId: owner.id, credentialId: pat.id, scopes: ['review:decide'] }), error => error?.businessCode === 'AUTH_SCOPE_REQUIRED');
        assert.equal(await db.approval.count({ where: { changeSetId: cs.id } }), 0);
      });
      await t.test('PAT expiring while publication waits for Space rejects without Page Approval or ChangeSet writes', async () => {
        const run = await sources.createRun(first.sourceId, principal, 'pat-expiry-wait');
        const cs = await process(run.id);
        const beforePages = await allPages();
        const beforeChangeSet = await db.changeSet.findUniqueOrThrow({ where: { id: cs.id }, include: { items: true } });
        const beforeApprovals = await db.approval.findMany({ where: { changeSetId: cs.id } });
        const expiresAt = new Date(Date.now() + 1200);
        const pat = await db.apiKeyCredential.create({ data: { name: 'expiring reviewer', prefix: 'sf', keyHash: randomUUID(), scopes: ['review:decide'], userId: owner.id, expiresAt } });
        let release; const held = new Promise(done => { release = done; });
        let acquired; const locked = new Promise(done => { acquired = done; });
        let reachedSpace; const checked = new Promise(done => { reachedSpace = done; });
        const originalLock = tree.lockPageMutationSpace;
        // Observe the boundary after real User/PAT checks; delegate to the real blocked Space lock.
        tree.lockPageMutationSpace = function (...args) { reachedSpace(); return originalLock.apply(this, args); };
        const blocker = db.$transaction(async tx => { await writer.lockSyncSpace(tx, space.id); acquired(); await held; });
        let result;
        try {
          await locked;
          result = reviews.reviewPublish(cs.id, owner.id, '', { userId: owner.id, credentialId: pat.id }).then(value => ({ value }), error => ({ error }));
          await Promise.race([checked, new Promise((_, reject) => setTimeout(() => reject(new Error('Publication never reached Space after credential checks')), 2000))]);
          assert.ok(Date.now() < expiresAt.getTime(), 'pre-Space credential check completed before expiry');
          await new Promise(done => setTimeout(done, Math.max(0, expiresAt.getTime() - Date.now()) + 25));
          release(); await blocker;
          const outcome = await result;
          assert.equal(outcome.error?.businessCode, 'SPACE_ACCESS_DENIED');
          assert.deepEqual(await allPages(), beforePages);
          assert.deepEqual(await db.changeSet.findUniqueOrThrow({ where: { id: cs.id }, include: { items: true } }), beforeChangeSet);
          assert.deepEqual(await db.approval.findMany({ where: { changeSetId: cs.id } }), beforeApprovals);
        } finally {
          release(); await blocker; if (result) await result;
          tree.lockPageMutationSpace = originalLock;
        }
      });
      await t.test('DDL checks, historical nulls, immutable receipt references and Source cascade', async () => {
        const unknown = await db.source.create({ data: { spaceId: space.id, type: 'text', name: 'historical', contentHash: randomUUID() } });
        assert.equal(unknown.currentSourceVersionId, null); assert.equal(unknown.currentSourceGeneration, 0);
        await assert.rejects(db.source.update({ where: { id: unknown.id }, data: { currentSourceGeneration: -1 } }));
        const version = await db.sourceVersion.create({ data: { sourceId: unknown.id, version: 1, contentHash: randomUUID() } });
        await assert.rejects(db.source.update({ where: { id: unknown.id }, data: { currentSourceVersionId: version.id } }));
        await db.source.update({ where: { id: unknown.id }, data: { currentSourceVersionId: version.id, currentSourceGeneration: 7 } });
        await db.sourceVersion.delete({ where: { id: version.id } });
        const deleted = await db.source.findUniqueOrThrow({ where: { id: unknown.id } });
        assert.equal(deleted.currentSourceVersionId, null); assert.equal(deleted.currentSourceGeneration, 7);
        const ref = await sync('R', 'ref-run', principal, 'references');
        const receipt = await db.sourceSyncReceipt.findFirstOrThrow({ where: { sourceId: ref.sourceId } });
        await assert.rejects(db.sourceSyncReceipt.update({ where: { id: receipt.id }, data: { inputSourceGeneration: 0 } }));
        await assert.rejects(db.ingestRun.update({ where: { id: ref.runId }, data: { inputSourceGeneration: -1 } }));
        await assert.rejects(db.page.update({ where: { id: originalPages[0].id }, data: { sourceGeneration: 0 } }));
        await db.ingestRun.delete({ where: { id: ref.runId } });
        assert.equal((await db.sourceSyncReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).runId, ref.runId);
        assert.equal((await sync('R', 'ref-run', principal, 'references')).runId, ref.runId);
        await db.source.delete({ where: { id: ref.sourceId } });
        assert.equal(await db.sourceSyncReceipt.count({ where: { sourceId: ref.sourceId } }), 0);
      });
      await t.test('Sync V2/V3 final mixed-batch writers clear only actual body changes; backfill normalizes per page', async () => {
        const local = await db.space.create({ data: { name: 'Local writer fixture', slug: randomUUID(), members: { create: { userId: owner.id, role: 'owner' } } } });
        const rows = await Promise.all(['one', 'two'].map(name => db.page.create({ data: { spaceId: local.id, authorId: owner.id, title: name, slug: randomUUID(), content: 'same\n', format: 'markdown', sourceGeneration: 7, syncPath: `pages/${name}.md`, syncPathKey: `pages/${name}.md` } })));
        const changes = rows.map((p, index) => ({ operation: 'upsert_page', page: { pageId: p.knowledgeKey, folderId: null, path: p.syncPath, title: p.title, body: index ? 'same\n' : 'changed\n', contentHash: hash(index ? 'same\n' : 'changed\n'), updatedAt: p.updatedAt.toISOString() } }));
        await db.$transaction(async tx => {
          const locked = await writer.lockSyncSpace(tx, local.id);
          await tree.publishSyncV2BatchLocked(locked, { spaceId: local.id, baseRevision: '0', changes, actor: { userId: owner.id }, principal: { userId: owner.id, platformRole: 'user' }, revisionOrigin: { origin: 'obsidian_sync', createdByUserId: owner.id } });
        });
        assert.deepEqual((await db.page.findMany({ where: { spaceId: local.id }, orderBy: { title: 'asc' } })).map(p => p.sourceGeneration), [null, 7]);
        const v3 = new SyncV3PushSessionService({}, {}, {}, {}, {}, {}, {}, {});
        const cs = await db.changeSet.create({ data: { spaceId: local.id, title: 'v3 fixture' } });
        await db.$transaction(async tx => v3.applyLiveChanges(await writer.lockSyncSpace(tx, local.id), principal, local.id, changes.map((c, index) => ({ ...c, page: { ...c.page, body: index ? 'v3 change\n' : 'changed\n', contentHash: hash(index ? 'v3 change\n' : 'changed\n') } })), [], cs.id));
        assert.deepEqual((await db.page.findMany({ where: { spaceId: local.id }, orderBy: { title: 'asc' } })).map(p => p.sourceGeneration), [null, null]);
        const backfillSpace = await db.space.create({ data: { name: 'Backfill fixture', slug: randomUUID() } });
        const legacy = await Promise.all(['same\n', 'normalize\r\n'].map((content, index) => db.page.create({ data: { spaceId: backfillSpace.id, authorId: owner.id, title: String(index), slug: randomUUID(), content, format: 'markdown', sourceGeneration: 6, syncPath: '', syncPathKey: `legacy-${index}` } })));
        await db.$transaction(tx => migratePages(tx, backfillSpace.id, randomUUID()));
        const recovered = await Promise.all(legacy.map(p => db.page.findUniqueOrThrow({ where: { id: p.id } })));
        assert.deepEqual(recovered.map(p => p.sourceGeneration), [6, null]);
      });
      t.diagnostic(JSON.stringify({ schemaName: schema, migrationTreeDigest: scope.migrationTreeDigest, publicInventoryDigest: scope.publicInventoryDigest, providerExecuted: false }));
    } finally { await db.$disconnect(); }
  });
  const admin = new PrismaClient({ datasources: { db: { url: baseDatabaseUrl } } });
  try { assert.deepEqual(await admin.$queryRawUnsafe('SELECT nspname FROM pg_namespace WHERE nspname = $1', schema), []); }
  finally { await admin.$disconnect(); }
});
