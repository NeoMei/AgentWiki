import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { assertLoopbackDatabaseHost } from './test-database-url-safety.mjs';
import { createSyncV3TestRuntime } from './sync-v3-test-runtime.mjs';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { contentHash } = require('@neomei/agentwiki-sync-protocol');
const { ContentTreeService } = require('./dist/content-tree/content-tree.service.js');
const { ReadableSyncPathService } = require('./dist/core/sync/readable-sync-path.service.js');
// Run against a newly created local database with all Prisma migrations applied.
// The caller owns dropping this disposable database after the gate; application
// database names and non-loopback hosts are rejected before any fixture write.
const databaseUrl = process.env.SYNC_VERSION_TEST_DATABASE_URL;

test('Sync v2 uses entity versions and safely accepts historical snapshot tokens in PostgreSQL', {
  skip: databaseUrl ? false : 'SYNC_VERSION_TEST_DATABASE_URL is not configured', timeout: 60_000,
}, async (t) => {
  const url = new URL(databaseUrl);
  assertLoopbackDatabaseHost(url);
  assert.match(url.pathname, /^\/agentwiki_sync_version_test_[a-z0-9_]+$/u,
    'Use a dedicated migrated disposable database, never an application database');
  // Force the connection timezone: timestamptz -> timestamp casts must not
  // silently shift UTC versions in deployments outside UTC.
  url.searchParams.set('options', '-c timezone=Asia/Shanghai');
  const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
  const runtime = await createSyncV3TestRuntime(prisma, 'sync-version');
  const suffix = randomUUID();
  const userId = `version-user-${suffix}`;
  const spaceId = `version-space-${suffix}`;
  const folderId = `version-folder-${suffix}`;
  const pageId = `version-page-${suffix}`;
  const principal = { userId, platformRole: 'user' };
  const actor = { userId };
  const revisionOrigin = { origin: 'obsidian_sync', createdByUserId: userId };
  const tree = new ContentTreeService(prisma, runtime.writer, new ReadableSyncPathService());
  let revision;
  const readPage = () => prisma.page.findUniqueOrThrow({ where: { knowledgeKey: pageId } });
  const readSnapshot = () => prisma.syncRevisionPageRow.findUniqueOrThrow({
    where: { revisionId_pageId: { revisionId: revision, pageId } },
  });
  const publish = (changes, baseRevision = revision) => prisma.$transaction((tx) => tree.publishSyncV2Batch(tx, {
    spaceId, baseRevision, changes, principal, actor, revisionOrigin,
  }));
  const pageChange = async (body, snapshot = undefined) => {
    const row = snapshot ?? await readSnapshot();
    return { operation: 'upsert_page', page: {
      pageId, folderId: row.folderId, path: row.path, title: row.title,
      body, contentHash: await contentHash(body), updatedAt: row.updatedAt.toISOString(),
    } };
  };
  try {
    const [{ TimeZone }] = await prisma.$queryRawUnsafe('SHOW TIME ZONE');
    assert.equal(TimeZone, 'Asia/Shanghai');
    await prisma.user.create({ data: { id: userId, email: `${userId}@test.local`, type: 'human' } });
    await prisma.space.create({ data: { id: spaceId, slug: spaceId, name: 'Version regression' } });
    await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
    const initial = await publish([
      { operation: 'upsert_folder', folder: {
        folderId, parentFolderId: null, name: 'Folder', path: 'pages/Folder', sortOrder: 0,
        updatedAt: '2026-09-24T10:07:05.965Z',
      } },
      { operation: 'upsert_page', page: {
        pageId, folderId, title: 'Page', path: 'pages/Folder/Page.md', body: '# Initial\n',
        contentHash: await contentHash('# Initial\n'), updatedAt: '2026-09-24T10:07:05.965Z',
      } },
    ], '0');
    revision = initial.revision;
    await t.test('batch writer publishes the exact persisted entity version', async () => {
      assert.equal((await readSnapshot()).updatedAt.toISOString(), (await readPage()).updatedAt.toISOString());
    });
    await t.test('web editor writer publishes entity version and Pull to local edit to Push succeeds', async () => {
      const result = await prisma.$transaction(async (tx) => {
        const locked = await runtime.writer.lockContentTreeSpace(tx, spaceId);
        const page = await tx.page.update({ where: { knowledgeKey: pageId }, data: {
          content: '# Web edit\n', updatedAt: new Date('2026-09-24T10:07:05.965Z'),
        } });
        return runtime.writer.advanceLocked(locked, spaceId, [{
          operation: 'upsert', pageId, title: page.title, path: page.syncPath, body: page.content,
        }], { origin: 'web_editor', createdByUserId: userId });
      });
      revision = result.revisionId;
      assert.equal((await readSnapshot()).updatedAt.toISOString(), '2026-09-24T10:07:05.965Z');
      const pushed = await publish([await pageChange('# Local edit\n')]);
      assert.equal(pushed.status, 'published');
      revision = pushed.revision;
      assert.equal((await readPage()).content, '# Local edit\n');
    });
    await t.test('keep-local Push accepts a 139ms historical drift without rewriting the old snapshot', async () => {
      const snapshot = await readSnapshot();
      const oldRevision = revision;
      // Emulate an old writer: the snapshot clock was later than the entity clock.
      await prisma.page.update({ where: { knowledgeKey: pageId }, data: {
        updatedAt: new Date(snapshot.updatedAt.getTime() - 139),
      } });
      const result = await publish([await pageChange('# Keep local\n', snapshot)]);
      assert.equal(result.status, 'published');
      revision = result.revision;
      assert.equal((await readPage()).content, '# Keep local\n');
      assert.deepEqual(await prisma.syncRevisionPageRow.findUniqueOrThrow({
        where: { revisionId_pageId: { revisionId: oldRevision, pageId } },
      }), snapshot);
      assert.equal((await readSnapshot()).updatedAt.toISOString(), (await readPage()).updatedAt.toISOString());
      assert.equal((await publish([await pageChange('# Keep local\n')])).status, 'noop');
    });
    await t.test('Folder rename with a moved Page uses snapshot versions', async () => {
      const folder = await prisma.syncRevisionFolderRow.findUniqueOrThrow({
        where: { revisionId_folderId: { revisionId: revision, folderId } },
      });
      const change = await pageChange('# Keep local\n');
      change.page.path = 'pages/Renamed/Page.md';
      const result = await publish([
        { operation: 'upsert_folder', folder: {
          folderId, parentFolderId: null, name: 'Renamed', path: 'pages/Renamed', sortOrder: 0,
          updatedAt: folder.updatedAt.toISOString(),
        } }, change,
      ]);
      revision = result.revision;
      assert.equal((await readPage()).syncPath, 'pages/Renamed/Page.md');
      assert.equal((await readSnapshot()).updatedAt.toISOString(), (await readPage()).updatedAt.toISOString());
    });
    await t.test('true concurrent head movement and live content drift remain rejected', async () => {
      const staleRevision = revision;
      const stale = await pageChange('# Stale client\n');
      revision = (await publish([await pageChange('# Concurrent published\n')])).revision;
      await assert.rejects(publish([stale], staleRevision), { code: 'CONTENT_TREE_CONFLICT' });
      const snapshot = await readSnapshot();
      await prisma.page.update({ where: { knowledgeKey: pageId }, data: {
        content: '# Unrepresented concurrent content\n', updatedAt: new Date(snapshot.updatedAt.getTime() - 139),
      } });
      await assert.rejects(publish([await pageChange('# Overwrite attempt\n')]), { code: 'CONTENT_TREE_CONFLICT' });
      assert.equal((await readPage()).content, '# Unrepresented concurrent content\n');
    });
  } finally {
    await runtime.dispose();
    await prisma.$disconnect();
  }
});
