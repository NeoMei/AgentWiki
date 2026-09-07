import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  TreeRevisionContentManifestV2Schema,
  canonicalBytes,
  contentHash,
  pathKey,
  revisionContentHash,
  treeRevisionContentHashV2,
  validatePortableMarkdownPath,
} from '../packages/sync-protocol/dist/esm/index.js';

import { withFolderTestDatabase } from './folder-test-database.mjs';
import { createSyncV3TestRuntime } from './sync-v3-test-runtime.mjs';
import {
  SpaceFolderMigrationPreflightError,
  legacyFolderId,
  migrateSpaceFolders,
  preflightSpaceFolderMigration,
  reserveReportTarget,
  runSpaceFolderMigrationMode,
} from './space-folder-migration.mjs';

const databaseUrl = process.env.FOLDER_TEST_DATABASE_URL;
const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const skip = databaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is required';
const execFileAsync = promisify(execFile);

test('forward alias CHECK preserves existing and new valid expanded Unicode keys', { skip, timeout: 180_000 }, async () => {
  await withFolderTestDatabase(databaseUrl, async ({ databaseUrl: schemaUrl }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
    try {
      const seeded = await seedUserAndSpace(prisma, 'UnicodeAlias');
      const owner = await createPage(prisma, seeded, { title: 'Owner', syncPath: 'pages/Owner.md' });
      const suffix = `${Array(4).fill('\u0130'.repeat(100)).join('/')}.md`;
      const existing = validatePortableMarkdownPath(`pages/${suffix}`);
      const incoming = validatePortableMarkdownPath(`old/${suffix}`);
      assert.deepEqual([Buffer.byteLength(existing.path), Buffer.byteLength(existing.key)], [812, 1212]);
      assert.deepEqual([Buffer.byteLength(incoming.path), Buffer.byteLength(incoming.key)], [810, 1210]);
      // Recreate the previously deployed CHECK and store a valid pre-upgrade alias.
      await prisma.$executeRawUnsafe('ALTER TABLE "PagePathAlias" DROP CONSTRAINT "PagePathAlias_non_empty_path"');
      await prisma.$executeRawUnsafe(`ALTER TABLE "PagePathAlias" ADD CONSTRAINT "PagePathAlias_non_empty_path"
        CHECK (char_length("path") > 0 AND char_length("pathKey") > 0 AND "path" LIKE 'pages/%')`);
      const before = await prisma.pagePathAlias.create({ data: {
        spaceId: seeded.spaceId, pageId: owner.id, path: existing.path, pathKey: existing.key,
      } });
      const sql = await readFile(new URL('../apps/server/prisma/migrations/20260907120000_allow_portable_legacy_page_aliases/migration.sql', import.meta.url), 'utf8');
      await prisma.$transaction(async (tx) => {
        for (const statement of sql.split(';').filter((part) => part.trim())) {
          await tx.$executeRawUnsafe(statement);
        }
      });
      assert.deepEqual(await prisma.pagePathAlias.findUniqueOrThrow({ where: { id: before.id } }), before);
      const inserted = await prisma.pagePathAlias.create({ data: {
        spaceId: seeded.spaceId, pageId: owner.id, path: incoming.path, pathKey: incoming.key,
      } });
      assert.equal(inserted.pathKey, incoming.key);
      for (const invalid of ['/absolute.md', '../escape.md', 'a/../escape.md', 'a\\escape.md', 'a//escape.md', `${'a'.repeat(1025)}.md`]) {
        await assert.rejects(() => prisma.pagePathAlias.create({ data: {
          spaceId: seeded.spaceId, pageId: owner.id, path: invalid, pathKey: invalid,
        } }));
      }
      await assert.rejects(() => prisma.pagePathAlias.create({ data: {
        spaceId: seeded.spaceId, pageId: owner.id, path: 'old/empty-key.md', pathKey: '',
      } }));
      assert.deepEqual(await prisma.pagePathAlias.findUniqueOrThrow({ where: { id: before.id } }), before);
    } finally { await prisma.$disconnect(); }
  });
});

for (const timezone of ['UTC', 'Asia/Shanghai']) {
  test(`migration preserves exact Page and Folder timestamps in ${timezone}`, { skip, timeout: 180_000 }, async () => {
    const zonedUrl = new URL(databaseUrl);
    zonedUrl.searchParams.set('options', `-ctimezone=${timezone}`);
    await withFolderTestDatabase(zonedUrl.toString(), async ({ databaseUrl: schemaUrl }) => {
      const prisma = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
      const runtime = await createSyncV3TestRuntime(prisma, 'timezone-migration');
      try {
        assert.equal((await prisma.$queryRawUnsafe('SHOW timezone'))[0].TimeZone, timezone);
        const seeded = await seedUserAndSpace(prisma, 'TimezoneMigration');
        const parent = await createPage(prisma, seeded, {
          id: 'timezone-parent', title: 'Parent', syncPath: 'legacy/parent.md',
          createdAt: new Date('2026-08-28T01:02:03.123Z'),
        });
        const child = await createPage(prisma, seeded, {
          id: 'timezone-child', title: 'Child', syncPath: 'legacy/child.md', parentId: parent.id,
          createdAt: new Date('2026-08-29T22:23:24.987Z'),
        });
        const sourcePages = [parent, child];
        const plan = await preflightSpaceFolderMigration(prisma, seeded.spaceId);
        const applied = await migrateSpaceFolders(prisma, seeded.spaceId, { expectedInputHash: plan.inputHash });
        const snapshot = await runtime.createV2Reader().snapshot(seeded.spaceId, applied.revisionId, undefined, 100);
        for (const source of sourcePages) {
          const current = await prisma.page.findUniqueOrThrow({ where: { id: source.id } });
          const immutable = await prisma.syncRevisionPageRow.findUniqueOrThrow({
            where: { revisionId_pageId: { revisionId: applied.revisionId, pageId: source.knowledgeKey } },
          });
          const expected = source.updatedAt.toISOString();
          assert.equal(plan.pages.find((page) => page.id === source.id).updatedAt.toISOString(), expected);
          assert.equal(current.updatedAt.toISOString(), expected);
          assert.equal(immutable.updatedAt.toISOString(), expected);
          assert.equal(snapshot.pages.find((page) => page.pageId === source.knowledgeKey).updatedAt, expected);
        }
        const folderPlan = plan.folders[0];
        assert.equal(folderPlan.updatedAt.toISOString(), '2026-08-28T01:02:03.123Z');
        const folder = await prisma.folder.findUniqueOrThrow({ where: { id: folderPlan.id } });
        const folderRow = await prisma.syncRevisionFolderRow.findUniqueOrThrow({
          where: { revisionId_folderId: { revisionId: applied.revisionId, folderId: folder.id } },
        });
        assert.equal(folder.updatedAt.toISOString(), '2026-08-28T01:02:03.123Z');
        assert.equal(folderRow.updatedAt.toISOString(), '2026-08-28T01:02:03.123Z');
        assert.equal(snapshot.folders[0].updatedAt, '2026-08-28T01:02:03.123Z');
      } finally {
        await runtime.dispose();
        await prisma.$disconnect();
      }
    });
  });
}

test('portable resumed legacy history migrates current pages through trusted v2 cutover', { skip, timeout: 180_000 }, async () => {
  await withFolderTestDatabase(databaseUrl, async ({ databaseUrl: schemaUrl }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
    const runtime = await createSyncV3TestRuntime(prisma, 'portable-legacy-cutover');
    const { legacyBundleHash } = requireFromServer('./dist/core/sync/legacy-serializer.js');
    const { SyncV3RevisionService } = requireFromServer('./dist/integrations/obsidian/sync-v3-revision.service.js');
    const { SyncRevisionService } = requireFromServer('./dist/integrations/obsidian/sync-revision.service.js');
    const { SyncCursorService } = requireFromServer('./dist/integrations/obsidian/sync-cursor.service.js');
    try {
      const seeded = await seedUserAndSpace(prisma, 'PortableLegacy');
      const ordinary = await seedUserAndSpace(prisma, 'Ordinary');
      await prisma.spaceMember.createMany({ data: [
        { userId: seeded.userId, spaceId: seeded.spaceId, role: 'owner' },
        { userId: seeded.userId, spaceId: ordinary.spaceId, role: 'viewer' },
      ] });
      const principal = { userId: seeded.userId, credentialId: randomUUID(), credentialFamilyId: randomUUID(),
        deviceId: randomUUID(), vaultId: randomUUID(), status: 'active', platformRole: 'user' };
      await prisma.humanDeviceCredentialFamily.create({ data: {
        id: principal.credentialFamilyId, userId: seeded.userId, deviceId: principal.deviceId, vaultId: principal.vaultId,
      } });
      await prisma.humanDeviceCredential.create({ data: {
        id: principal.credentialId, credentialFamilyId: principal.credentialFamilyId, userId: seeded.userId,
        deviceId: principal.deviceId, vaultId: principal.vaultId, deviceName: 'Synthetic migration test',
        credentialHash: randomUUID(), status: 'active', activatedAt: new Date(),
      } });
      const pages = [];
      for (let index = 0; index < 3; index += 1) {
        pages.push(await createPage(prisma, seeded, {
          id: `portable-${index}`, title: `Current ${index}`, syncPath: `old/branch-${index}/note.md`,
          content: `# Current ${index}\n\n[Old link](old/branch-1/note.md)\n`,
        }));
        await createPage(prisma, seeded, { title: `Deleted ${index}`, syncPath: `deleted/${index}.md`, deletedAt: new Date() });
      }
      const earlyBatch = randomUUID();
      const resumedBatch = randomUUID();
      const revisionIds = [];
      const historicalBodyHashes = [];
      for (let sequence = 1; sequence <= 5; sequence += 1) {
        const id = randomUUID();
        const updatedAt = new Date(`2026-08-0${sequence}T00:00:00.000Z`);
        const historicalPages = await Promise.all(pages.map(async (page, index) => {
          const body = `# Historical ${index}\n\nRevision ${sequence}\n`;
          return { pageId: page.knowledgeKey, spaceId: seeded.spaceId,
            path: sequence === 2 ? `pages/Former ${index}.md` : page.syncPath,
            title: `Historical ${index}`, body, order: index, metadata: null, artifactIds: [],
            contentHash: await contentHash(body), updatedAt: updatedAt.toISOString() };
        }));
        const sidecar = { schemaVersion: 'knowledge-bundle@1', recipeVersion: 'unified-knowledge@1',
          baseRevision: revisionIds.at(-1) ?? '0', memories: [], relations: [], provenance: [], deletions: [] };
        const manifest = { protocolVersion: '1', spaceId: seeded.spaceId,
          pages: historicalPages.map(({ pageId, path, title, contentHash: hash }) => ({ pageId, path, title, contentHash: hash })) };
        historicalBodyHashes.push(...historicalPages.map((page) => page.contentHash));
        await prisma.syncPageContentRow.createMany({ data: historicalPages.map((page) => ({
          contentHash: page.contentHash, body: page.body, byteLength: Buffer.byteLength(page.body),
        })) });
        await prisma.legacyPageBodyRow.createMany({ data: historicalPages.map((page) => ({ contentHash: page.contentHash, body: page.body })) });
        await prisma.spaceKnowledgeRevision.create({ data: {
          id, spaceId: seeded.spaceId, sequence, parentRevisionId: null,
          schemaVersion: sidecar.schemaVersion, recipeVersion: sidecar.recipeVersion,
          contentHash: legacyBundleHash({ ...sidecar, spaceId: seeded.spaceId, pages: historicalPages }),
          revisionContentHash: await revisionContentHash(manifest), pageCount: 3n,
          revisionBodyBytes: BigInt(historicalPages.reduce((sum, page) => sum + Buffer.byteLength(page.body), 0)),
          revisionManifestByteLength: BigInt(canonicalBytes(manifest).byteLength),
          origin: 'migration', migrationBatchId: sequence === 1 ? earlyBatch : `${resumedBatch}:${id}`, createdAt: updatedAt,
        } });
        await prisma.syncRevisionPageRow.createMany({ data: historicalPages.map((page) => ({
          revisionId: id, pageId: page.pageId, folderId: null, path: page.path, pathKey: pathKey(page.path),
          title: page.title, contentHash: page.contentHash, updatedAt,
        })) });
        await prisma.legacyRevisionPageExtra.createMany({ data: historicalPages.map((page) => ({
          revisionId: id, pageId: page.pageId, ordinal: page.order, legacyBodyHash: page.contentHash,
          extra: { spaceId: seeded.spaceId, title: page.title, order: page.order, metadata: null,
            artifactIds: [], legacyBodyHash: page.contentHash, contentHash: page.contentHash, path: page.path, updatedAt: page.updatedAt },
        })) });
        await prisma.legacyRevisionSidecar.create({ data: { revisionId: id, sidecar } });
        revisionIds.push(id);
      }
      const historicalState = () => Promise.all([
        prisma.spaceKnowledgeRevision.findMany({ where: { id: { in: revisionIds } }, orderBy: { sequence: 'asc' } }),
        prisma.syncRevisionPageRow.findMany({ where: { revisionId: { in: revisionIds } }, orderBy: [{ revisionId: 'asc' }, { pageId: 'asc' }] }),
        prisma.legacyRevisionSidecar.findMany({ where: { revisionId: { in: revisionIds } }, orderBy: { revisionId: 'asc' } }),
        prisma.legacyRevisionPageExtra.findMany({ where: { revisionId: { in: revisionIds } }, orderBy: [{ revisionId: 'asc' }, { ordinal: 'asc' }] }),
        prisma.syncPageContentRow.findMany({ where: { contentHash: { in: historicalBodyHashes } }, orderBy: { contentHash: 'asc' } }),
        prisma.legacyPageBodyRow.findMany({ where: { contentHash: { in: historicalBodyHashes } }, orderBy: { contentHash: 'asc' } }),
      ]);
      const before = await historicalState();
      const currentBefore = await prisma.page.findMany({ where: { spaceId: seeded.spaceId }, orderBy: { id: 'asc' } });
      const plan = await preflightSpaceFolderMigration(prisma, seeded.spaceId);
      assert.equal(plan.status, 'ready');
      assert.equal(plan.counts.pagesMoved, 3);
      assert.equal(plan.counts.foldersToCreate, 0);
      assert.equal(plan.counts.deletedPagesSkipped, 3);
      const head = before[0].at(-1);
      await prisma.spaceKnowledgeRevision.update({ where: { id: head.id }, data: { contentHash: 'f'.repeat(64) } });
      await assert.rejects(() => migrateSpaceFolders(prisma, seeded.spaceId, { expectedInputHash: plan.inputHash }), /INTEGRITY/);
      await prisma.spaceKnowledgeRevision.update({ where: { id: head.id }, data: { contentHash: head.contentHash } });
      for (const data of [
        { schemaVersion: 'unknown@9', recipeVersion: head.recipeVersion },
        { schemaVersion: 'content-tree@3', recipeVersion: 'referenced-images-v1' },
      ]) {
        await prisma.spaceKnowledgeRevision.update({ where: { id: head.id }, data });
        await assert.rejects(() => migrateSpaceFolders(prisma, seeded.spaceId, { expectedInputHash: plan.inputHash }));
      }
      await prisma.spaceKnowledgeRevision.update({ where: { id: head.id }, data: {
        schemaVersion: head.schemaVersion, recipeVersion: head.recipeVersion,
      } });
      for (const invalidPath of ['/absolute.md', '../escape.md', 'old/../escape.md', 'old\\escape.md', `${'a'.repeat(1025)}.md`]) {
        await assert.rejects(() => prisma.pagePathAlias.create({ data: {
          spaceId: seeded.spaceId, pageId: pages[0].id, path: invalidPath, pathKey: invalidPath,
        } }));
      }
      await prisma.page.update({ where: { id: pages[0].id }, data: { title: 'Input changed after review' } });
      await assert.rejects(() => migrateSpaceFolders(prisma, seeded.spaceId, { expectedInputHash: plan.inputHash }),
        (error) => error.report.rejections.some((entry) => entry.code === 'MIGRATION_INPUT_CHANGED'));
      await prisma.page.update({ where: { id: pages[0].id }, data: { title: pages[0].title, updatedAt: pages[0].updatedAt } });
      await assert.rejects(() => migrateSpaceFolders(prisma, seeded.spaceId, {
        expectedInputHash: '0'.repeat(64),
      }), (error) => error.report.rejections.some((entry) => entry.code === 'MIGRATION_INPUT_CHANGED'));
      await assert.rejects(() => migrateSpaceFolders(prisma, seeded.spaceId, {
        expectedInputHash: plan.inputHash, persistReport: () => { throw new Error('synthetic report rollback'); },
      }), /synthetic report rollback/);
      assert.deepEqual(await historicalState(), before);
      assert.deepEqual(await prisma.page.findMany({ where: { spaceId: seeded.spaceId }, orderBy: { id: 'asc' } }), currentBefore);
      assert.equal(await prisma.pagePathAlias.count({ where: { spaceId: seeded.spaceId } }), 0);
      const applied = await migrateSpaceFolders(prisma, seeded.spaceId, { expectedInputHash: plan.inputHash });
      const revision = await prisma.spaceKnowledgeRevision.findUniqueOrThrow({ where: { id: applied.revisionId } });
      assert.equal(revision.schemaVersion, 'content-tree@2');
      assert.equal(revision.sequence, 6);
      assert.equal(revision.parentRevisionId, revisionIds[4]);
      const v2 = runtime.createV2Reader();
      const snapshot = await v2.snapshot(seeded.spaceId, applied.revisionId, undefined, 100);
      assert.deepEqual(snapshot.pages.map((page) => page.path).sort(), ['pages/Current 0.md', 'pages/Current 1.md', 'pages/Current 2.md']);
      await prisma.spaceKnowledgeRevision.update({ where: { id: head.id }, data: { contentHash: 'f'.repeat(64) } });
      await assert.rejects(() => v2.snapshot(seeded.spaceId, applied.revisionId, undefined, 100));
      await assert.rejects(() => new SyncRevisionService(prisma, runtime.immutableV3).snapshotPage(seeded.spaceId, head.id, 100));
      await prisma.spaceKnowledgeRevision.update({ where: { id: head.id }, data: { contentHash: head.contentHash } });
      for (const page of pages) {
        const current = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
        assert.deepEqual({ ...current, syncPath: page.syncPath, syncPathKey: page.syncPathKey }, page);
        const resolved = await runtime.markdown.resolve(seeded.spaceId, [{ kind: 'page', target: page.syncPath }],
          { kind: 'human', userId: seeded.userId });
        assert.equal(resolved[0].status, 'resolved');
        assert.equal(resolved[0].pageId, page.id);
      }
      const v3 = new SyncV3RevisionService(prisma, new SyncCursorService({ get: () => 'synthetic-migration-pepper' }), runtime.syncCapabilities, runtime.v3Writer);
      const listed = await v3.listSpaces(principal);
      assert.equal(listed.spaces.find((space) => space.spaceId === seeded.spaceId).currentRevision, applied.revisionId);
      assert.equal(listed.spaces.find((space) => space.spaceId === ordinary.spaceId).currentRevision, '0');
      const old = await new SyncRevisionService(prisma, runtime.immutableV3).snapshotPage(seeded.spaceId, revisionIds[4], 100);
      assert.deepEqual(old.items.map((page) => page.path).sort(), pages.map((page) => page.syncPath).sort());
      await assert.rejects(() => v2.snapshot(seeded.spaceId, revisionIds[4], undefined, 100));
      assert.equal((await migrateSpaceFolders(prisma, seeded.spaceId, { expectedInputHash: plan.inputHash })).status, 'completed');
      const after = await historicalState();
      assert.deepEqual(after, before);
      // Subsequent ordinary edits must retain the trusted cutover boundary too.
      const next = await prisma.$transaction((tx) => runtime.writer.advanceStructuralPages(tx, seeded.spaceId, [{
        operation: 'upsert', pageId: pages[0].knowledgeKey, folderId: null,
        path: 'pages/Current 0.md', title: pages[0].title, body: 'Next canonical revision',
      }], { origin: 'web_editor' }));
      assert.equal((await v2.snapshot(seeded.spaceId, next.revisionId, undefined, 100)).sequence, 7);
      const native = await prisma.$transaction(async (tx) => {
        const locked = await runtime.writer.lockSpace(tx, seeded.spaceId);
        return runtime.writer.advanceReferencedImagesLocked(locked, seeded.spaceId, [], { origin: 'web_editor' });
      });
      assert.equal((await v3.snapshot(principal, seeded.spaceId, native.revisionId, undefined, 100)).sequence, 8);
      await runtime.immutableV3.verify(prisma, seeded.spaceId, await prisma.spaceKnowledgeRevision.findUniqueOrThrow({ where: { id: native.revisionId } }));
    } finally {
      await runtime.dispose();
      await prisma.$disconnect();
    }
  });
});

async function seedUserAndSpace(prisma, label) {
  const userId = randomUUID();
  const spaceId = randomUUID();
  await prisma.user.create({ data: {
    id: userId,
    email: `${label}-${randomUUID()}@folder.test`,
    type: 'human',
  } });
  await prisma.space.create({ data: {
    id: spaceId,
    name: label,
    slug: `${label.toLowerCase()}-${randomUUID()}`,
  } });
  return { userId, spaceId };
}

async function createPage(prisma, seeded, input) {
  const createdAt = input.createdAt ?? new Date('2026-08-28T01:02:03.000Z');
  return prisma.page.create({ data: {
    id: input.id ?? randomUUID(),
    knowledgeKey: input.knowledgeKey ?? randomUUID(),
    title: input.title,
    slug: input.slug ?? randomUUID(),
    content: input.content ?? `# ${input.title}`,
    format: 'markdown',
    parentId: input.parentId ?? null,
    folderId: input.folderId ?? null,
    sortOrder: input.sortOrder ?? 0,
    spaceId: seeded.spaceId,
    authorId: seeded.userId,
    syncPath: input.syncPath,
    syncPathKey: input.syncPathKey ?? input.syncPath.toLowerCase(),
    lastModifiedByUserId: seeded.userId,
    lastModifiedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    deletedAt: input.deletedAt ?? null,
  } });
}

test('real PostgreSQL preflight/apply/no-op/version-alias/rollback contract', {
  skip,
  timeout: 180_000,
}, async () => {
  await withFolderTestDatabase(databaseUrl, async ({ databaseUrl: schemaUrl }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
    try {
      const seeded = await seedUserAndSpace(prisma, 'LegacyTree');
      const root = await createPage(prisma, seeded, {
        id: 'root-page', title: '项目', syncPath: 'pages/项目.md', content: 'root-content',
      });
      const child = await createPage(prisma, seeded, {
        id: 'child-page', title: '周报', parentId: root.id,
        syncPath: 'pages/周报.md', content: 'child-content',
      });
      const grandchild = await createPage(prisma, seeded, {
        id: 'grandchild-page', title: '第35周', parentId: child.id,
        syncPath: 'pages/第35周.md', content: 'grandchild-content',
      });
      await prisma.pageVersion.createMany({ data: [
        {
          id: 'child-version', pageId: child.id, title: child.title,
          content: child.content, authorId: seeded.userId, parentId: root.id,
          createdAt: new Date('2026-08-27T00:00:00.000Z'),
        },
        {
          id: 'grandchild-version', pageId: grandchild.id, title: grandchild.title,
          content: grandchild.content, authorId: seeded.userId, parentId: child.id,
          createdAt: new Date('2026-08-27T01:00:00.000Z'),
        },
      ] });
      const runtime = await createSyncV3TestRuntime(prisma, 'space-folder-migration-prior');
      const writer = runtime.writer;
      const priorRevision = await prisma.$transaction((tx) => writer.advanceStructuralPages(
        tx,
        seeded.spaceId,
        [root, child, grandchild].map((entry) => ({
          operation: 'upsert',
          pageId: entry.knowledgeKey,
          folderId: null,
          path: entry.syncPath,
          title: entry.title,
          body: entry.content,
        })),
        {
          origin: 'migration',
          legacySidecarOverride: {
            memories: [{ id: 'preserved-memory-evidence' }],
            customEvidence: 'preserved-sidecar',
          },
        },
      ));
      await runtime.dispose();
      assert.ok(priorRevision.revisionId);

      const before = {
        folders: await prisma.folder.count({ where: { spaceId: seeded.spaceId } }),
        aliases: await prisma.pagePathAlias.count({ where: { spaceId: seeded.spaceId } }),
        revisions: await prisma.spaceKnowledgeRevision.count({ where: { spaceId: seeded.spaceId } }),
        pages: await prisma.page.findMany({ where: { spaceId: seeded.spaceId }, orderBy: { id: 'asc' } }),
      };
      const dryRun = await preflightSpaceFolderMigration(prisma, seeded.spaceId);
      assert.equal(dryRun.status, 'ready');
      assert.equal(dryRun.counts.foldersToCreate, 2);
      assert.equal(await prisma.folder.count({ where: { spaceId: seeded.spaceId } }), before.folders);
      assert.equal(await prisma.pagePathAlias.count({ where: { spaceId: seeded.spaceId } }), before.aliases);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId: seeded.spaceId } }), before.revisions);
      assert.deepEqual(
        await prisma.page.findMany({ where: { spaceId: seeded.spaceId }, orderBy: { id: 'asc' } }),
        before.pages,
      );

      await assert.rejects(
        () => migrateSpaceFolders(prisma, seeded.spaceId),
        /expectedInputHash is required/,
      );
      await assert.rejects(
        () => migrateSpaceFolders(prisma, seeded.spaceId, { expectedInputHash: '0'.repeat(64) }),
        (error) => error instanceof SpaceFolderMigrationPreflightError
          && error.report.rejections.some((entry) => entry.code === 'MIGRATION_INPUT_CHANGED'),
      );
      assert.equal(await prisma.folder.count({ where: { spaceId: seeded.spaceId } }), 0);
      assert.equal(
        await prisma.spaceKnowledgeRevision.count({ where: { spaceId: seeded.spaceId } }),
        before.revisions,
      );

      const applied = await migrateSpaceFolders(prisma, seeded.spaceId, {
        expectedInputHash: dryRun.inputHash,
      });
      assert.equal(applied.status, 'applied');
      assert.equal(applied.batchKey, `space-folders-v1:${seeded.spaceId}`);
      assert.equal(applied.counts.foldersCreated, 2);
      assert.equal(applied.counts.pagesMoved, 2);
      assert.equal(applied.counts.aliasesCreated, 2);
      assert.equal(applied.counts.aliasesReused, 0);
      assert.equal(applied.counts.aliasesRefreshed, 0);
      assert.equal(applied.counts.aliasesPruned, 0);
      assert.equal(applied.counts.pageVersionsBackfilled, 2);

      const folders = await prisma.folder.findMany({
        where: { spaceId: seeded.spaceId }, orderBy: { path: 'asc' },
      });
      assert.deepEqual(folders.map(({ id, parentId, path }) => ({ id, parentId, path })), [
        {
          id: legacyFolderId(seeded.spaceId, root.id),
          parentId: null,
          path: 'pages/项目',
        },
        {
          id: legacyFolderId(seeded.spaceId, child.id),
          parentId: legacyFolderId(seeded.spaceId, root.id),
          path: 'pages/项目/周报',
        },
      ]);
      const pages = await prisma.page.findMany({
        where: { spaceId: seeded.spaceId }, orderBy: { id: 'asc' },
      });
      assert.deepEqual(pages.map(({ id, title, content, authorId, folderId, syncPath, createdAt, updatedAt }) => ({
        id, title, content, authorId, folderId, syncPath, createdAt, updatedAt,
      })), [
        {
          id: child.id, title: child.title, content: child.content, authorId: child.authorId,
          folderId: legacyFolderId(seeded.spaceId, root.id), syncPath: 'pages/项目/周报.md',
          createdAt: child.createdAt, updatedAt: child.updatedAt,
        },
        {
          id: grandchild.id, title: grandchild.title, content: grandchild.content,
          authorId: grandchild.authorId, folderId: legacyFolderId(seeded.spaceId, child.id),
          syncPath: 'pages/项目/周报/第35周.md',
          createdAt: grandchild.createdAt, updatedAt: grandchild.updatedAt,
        },
        {
          id: root.id, title: root.title, content: root.content, authorId: root.authorId,
          folderId: null, syncPath: 'pages/项目.md', createdAt: root.createdAt, updatedAt: root.updatedAt,
        },
      ]);
      assert.deepEqual(
        (await prisma.pagePathAlias.findMany({
          where: { spaceId: seeded.spaceId }, orderBy: { pageId: 'asc' },
        })).map(({ pageId, path }) => ({ pageId, path })),
        [
          { pageId: child.id, path: 'pages/周报.md' },
          { pageId: grandchild.id, path: 'pages/第35周.md' },
        ],
      );
      assert.deepEqual(
        (await prisma.pageVersion.findMany({
          where: { id: { in: ['child-version', 'grandchild-version'] } }, orderBy: { id: 'asc' },
        })).map(({ id, parentId, folderId, createdAt }) => ({ id, parentId, folderId, createdAt })),
        [
          {
            id: 'child-version', parentId: root.id,
            folderId: legacyFolderId(seeded.spaceId, root.id),
            createdAt: new Date('2026-08-27T00:00:00.000Z'),
          },
          {
            id: 'grandchild-version', parentId: child.id,
            folderId: legacyFolderId(seeded.spaceId, child.id),
            createdAt: new Date('2026-08-27T01:00:00.000Z'),
          },
        ],
      );
      const space = await prisma.space.findUnique({ where: { id: seeded.spaceId } });
      assert.equal(space.contentTreeRevision, 1n);
      const revision = await prisma.spaceKnowledgeRevision.findUnique({
        where: { spaceId_migrationBatchId: {
          spaceId: seeded.spaceId,
          migrationBatchId: `space-folders-v1:${seeded.spaceId}`,
        } },
      });
      assert.ok(revision);
      const migrationSidecar = await prisma.legacyRevisionSidecar.findUnique({
        where: { revisionId: revision.id },
      });
      assert.deepEqual(migrationSidecar.sidecar.memories, [{ id: 'preserved-memory-evidence' }]);
      assert.equal(migrationSidecar.sidecar.customEvidence, 'preserved-sidecar');
      assert.equal(migrationSidecar.sidecar.spaceFolderMigration.inputHash, dryRun.inputHash);
      assert.equal(migrationSidecar.sidecar.spaceFolderMigration.status, 'completed');
      assert.equal(migrationSidecar.sidecar.spaceFolderMigration.v2Revision.protocolVersion, '2');
      assert.equal(revision.schemaVersion, 'content-tree@2');
      const revisionFolders = await prisma.syncRevisionFolderRow.findMany({
        where: { revisionId: revision.id }, orderBy: { path: 'asc' },
      });
      assert.deepEqual(revisionFolders.map(({ folderId, parentFolderId, path }) => ({
        folderId, parentFolderId, path,
      })), [
        { folderId: legacyFolderId(seeded.spaceId, root.id), parentFolderId: null, path: 'pages/项目' },
        {
          folderId: legacyFolderId(seeded.spaceId, child.id),
          parentFolderId: legacyFolderId(seeded.spaceId, root.id),
          path: 'pages/项目/周报',
        },
      ]);
      const revisionPages = await prisma.syncRevisionPageRow.findMany({
        where: { revisionId: revision.id }, orderBy: { pathKey: 'asc' }, include: { content: true },
      });
      assert.equal(revisionPages.length, 3);
      assert.deepEqual(revisionPages.map(({ pageId, folderId, path, content: body }) => ({
        pageId, folderId, path, body: body.body,
      })), [
        {
          pageId: root.knowledgeKey, folderId: null, path: 'pages/项目.md', body: root.content,
        },
        {
          pageId: child.knowledgeKey, folderId: legacyFolderId(seeded.spaceId, root.id),
          path: 'pages/项目/周报.md', body: child.content,
        },
        {
          pageId: grandchild.knowledgeKey, folderId: legacyFolderId(seeded.spaceId, child.id),
          path: 'pages/项目/周报/第35周.md', body: grandchild.content,
        },
      ]);
      const manifest = TreeRevisionContentManifestV2Schema.parse({
        protocolVersion: '2',
        spaceId: seeded.spaceId,
        folders: revisionFolders.map((folder) => ({
          folderId: folder.folderId,
          parentFolderId: folder.parentFolderId,
          name: folder.name,
          path: folder.path,
          sortOrder: folder.sortOrder,
          updatedAt: folder.updatedAt.toISOString(),
        })),
        pages: revisionPages.map((pageRow) => ({
          pageId: pageRow.pageId,
          folderId: pageRow.folderId,
          path: pageRow.path,
          title: pageRow.title,
          body: pageRow.content.body,
          contentHash: pageRow.contentHash,
          updatedAt: pageRow.updatedAt.toISOString(),
        })),
      });
      assert.equal(revision.revisionContentHash, await treeRevisionContentHashV2(manifest));
      assert.equal(revision.revisionManifestByteLength, BigInt(canonicalBytes(manifest).byteLength));
      assert.equal(migrationSidecar.sidecar.spaceFolderMigration.v2Revision.folderCount, '2');
      assert.equal(migrationSidecar.sidecar.spaceFolderMigration.v2Revision.pageCount, '3');
      const treeDelta = await prisma.syncRevisionTreeDeltaRow.findMany({
        where: { revisionId: revision.id }, orderBy: { ordinal: 'asc' },
      });
      assert.deepEqual(treeDelta.map(({ operation, folderId, pageId, contentHash }) => ({
        operation, folderId, pageId, contentHash,
      })), [
        ...revisionFolders.map((folder) => ({
          operation: 'upsert_folder', folderId: folder.folderId, pageId: null, contentHash: null,
        })),
        ...revisionPages.map((pageRow) => ({
          operation: 'upsert_page', folderId: null, pageId: pageRow.pageId, contentHash: pageRow.contentHash,
        })),
      ]);

      const later = await createPage(prisma, seeded, {
        id: 'later-malformed', title: 'later', parentId: 'missing-parent',
        syncPath: 'pages/later.md',
      }).catch(async () => {
        // The Page FK can reject a truly missing parent in some future schema;
        // a later valid root still proves completed-key scan avoidance.
        return createPage(prisma, seeded, {
          id: 'later-root', title: 'later', syncPath: 'pages/later.md',
        });
      });
      await assert.rejects(
        () => migrateSpaceFolders(prisma, seeded.spaceId, { expectedInputHash: 'f'.repeat(64) }),
        (error) => error instanceof SpaceFolderMigrationPreflightError
          && error.report.rejections.some((entry) => entry.code === 'MIGRATION_INPUT_CHANGED'),
      );
      const second = await migrateSpaceFolders(prisma, seeded.spaceId, {
        expectedInputHash: dryRun.inputHash,
      });
      assert.equal(second.status, 'completed');
      assert.equal(second.counts.foldersCreated, 0);
      assert.equal(second.counts.pagesMoved, 0);
      assert.equal((await prisma.page.findUnique({ where: { id: later.id } })).folderId, null);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId: seeded.spaceId } }), 2);
      assert.equal((await prisma.space.findUnique({ where: { id: seeded.spaceId } })).contentTreeRevision, 1n);

      const savedSidecar = migrationSidecar.sidecar;
      await prisma.legacyRevisionSidecar.delete({ where: { revisionId: revision.id } });
      await assert.rejects(
        () => migrateSpaceFolders(prisma, seeded.spaceId, { expectedInputHash: dryRun.inputHash }),
        (error) => error instanceof SpaceFolderMigrationPreflightError
          && error.report.rejections.some((entry) => entry.code === 'MIGRATION_BATCH_EVIDENCE_INVALID'),
      );
      await prisma.legacyRevisionSidecar.create({ data: { revisionId: revision.id, sidecar: savedSidecar } });

      const rollbackSeeded = await seedUserAndSpace(prisma, 'RollbackTree');
      const rollbackRoot = await createPage(prisma, rollbackSeeded, {
        id: 'rollback-root', title: 'Root', syncPath: 'pages/Root.md',
      });
      const rollbackChild = await createPage(prisma, rollbackSeeded, {
        id: 'rollback-child', title: 'Child', parentId: rollbackRoot.id,
        syncPath: 'pages/Child.md',
      });
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "reject_rollback_page_update"() RETURNS trigger AS $$
        BEGIN
          IF NEW."id" = 'rollback-child' THEN
            RAISE EXCEPTION 'forced Task 6 rollback';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "reject_rollback_page_update"
        BEFORE UPDATE ON "Page"
        FOR EACH ROW EXECUTE FUNCTION "reject_rollback_page_update"()
      `);
      const rollbackDryRun = await preflightSpaceFolderMigration(prisma, rollbackSeeded.spaceId);
      await assert.rejects(
        () => migrateSpaceFolders(prisma, rollbackSeeded.spaceId, {
          expectedInputHash: rollbackDryRun.inputHash,
        }),
        /forced Task 6 rollback/,
      );
      assert.equal(await prisma.folder.count({ where: { spaceId: rollbackSeeded.spaceId } }), 0);
      assert.equal(await prisma.pagePathAlias.count({ where: { spaceId: rollbackSeeded.spaceId } }), 0);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId: rollbackSeeded.spaceId } }), 0);
      assert.equal((await prisma.space.findUnique({ where: { id: rollbackSeeded.spaceId } })).contentTreeRevision, 0n);
      assert.deepEqual(
        await prisma.page.findUnique({ where: { id: rollbackChild.id }, select: { parentId: true, folderId: true, syncPath: true } }),
        { parentId: rollbackRoot.id, folderId: null, syncPath: 'pages/Child.md' },
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('real PostgreSQL preflight rejects cross-Space and orphan legacy parents without writes', {
  skip,
  timeout: 180_000,
}, async () => {
  await withFolderTestDatabase(databaseUrl, async ({ databaseUrl: schemaUrl }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
    try {
      const first = await seedUserAndSpace(prisma, 'First');
      const second = await seedUserAndSpace(prisma, 'Second');
      const foreign = await createPage(prisma, second, {
        id: 'foreign-parent', title: 'Foreign', syncPath: 'pages/Foreign.md',
      });
      await createPage(prisma, first, {
        id: 'cross-child', title: 'Cross', parentId: foreign.id, syncPath: 'pages/Cross.md',
      });
      await assert.rejects(
        () => preflightSpaceFolderMigration(prisma, first.spaceId),
        (error) => error instanceof SpaceFolderMigrationPreflightError
          && error.report.rejections.some((entry) => entry.code === 'LEGACY_PAGE_CROSS_SPACE'),
      );
      assert.equal(await prisma.folder.count({ where: { spaceId: first.spaceId } }), 0);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId: first.spaceId } }), 0);
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('real PostgreSQL alias planning applies ContentTree upsert/retention and reruns without mutation', {
  skip,
  timeout: 180_000,
}, async () => {
  await withFolderTestDatabase(databaseUrl, async ({ databaseUrl: schemaUrl }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
    try {
      const seeded = await seedUserAndSpace(prisma, 'AliasTree');
      const root = await createPage(prisma, seeded, {
        id: 'alias-root', title: 'Root', syncPath: 'pages/Root.md',
      });
      const child = await createPage(prisma, seeded, {
        id: 'alias-child', title: 'Child', parentId: root.id, syncPath: 'pages/Child.md',
      });
      const current = await createPage(prisma, seeded, {
        id: 'alias-current', title: 'Current', syncPath: 'pages/Current.md',
      });
      const deleted = await createPage(prisma, seeded, {
        id: 'alias-deleted', title: 'Deleted', syncPath: 'pages/Deleted.md',
        deletedAt: new Date('2026-08-20T00:00:00.000Z'),
      });
      const pastOwner = await createPage(prisma, seeded, {
        id: 'alias-past-owner', title: 'PastOwner', syncPath: 'pages/PastOwner.md',
      });
      const equalOwner = await createPage(prisma, seeded, {
        id: 'alias-equal-owner', title: 'EqualOwner', syncPath: 'pages/EqualOwner.md',
      });
      await prisma.pagePathAlias.createMany({ data: [
        ...Array.from({ length: 20 }, (_, index) => ({
          id: `history-${String(index).padStart(2, '0')}`,
          spaceId: seeded.spaceId,
          pageId: child.id,
          path: `pages/history-${index}.md`,
          pathKey: pathKey(`pages/history-${index}.md`),
          createdAt: new Date(`2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
        })),
        {
          id: 'ambiguous-existing', spaceId: seeded.spaceId, pageId: current.id,
          path: child.syncPath, pathKey: child.syncPathKey,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        {
          id: 'shadowed-existing', spaceId: seeded.spaceId, pageId: root.id,
          path: current.syncPath, pathKey: current.syncPathKey,
          createdAt: new Date('2026-07-02T00:00:00.000Z'),
        },
        {
          id: 'future-duplicate', spaceId: seeded.spaceId, pageId: root.id,
          path: child.syncPath, pathKey: child.syncPathKey,
          createdAt: new Date('2026-07-03T00:00:00.000Z'),
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        },
        {
          id: 'deleted-owner-duplicate', spaceId: seeded.spaceId, pageId: deleted.id,
          path: child.syncPath, pathKey: child.syncPathKey,
          createdAt: new Date('2026-07-04T00:00:00.000Z'),
        },
        {
          id: 'past-duplicate', spaceId: seeded.spaceId, pageId: pastOwner.id,
          path: child.syncPath, pathKey: child.syncPathKey,
          createdAt: new Date('2026-07-05T00:00:00.000Z'),
          expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        },
        {
          id: 'equal-or-past-duplicate', spaceId: seeded.spaceId, pageId: equalOwner.id,
          path: child.syncPath, pathKey: child.syncPathKey,
          createdAt: new Date('2026-07-06T00:00:00.000Z'),
          expiresAt: new Date('2026-08-28T00:00:00.000Z'),
        },
      ] });

      const dryRun = await preflightSpaceFolderMigration(prisma, seeded.spaceId);
      assert.equal(dryRun.counts.aliasesCreated, 1);
      assert.equal(dryRun.counts.aliasesPruned, 1);
      assert.deepEqual(dryRun.aliasRetention, [{ pageId: child.id, prunedAliasIds: ['history-00'] }]);
      assert.deepEqual(dryRun.aliasResolutions.map(({ pathKey: key, resolution }) => ({ key, resolution })), [
        { key: child.syncPathKey, resolution: 'ambiguous-alias' },
        { key: current.syncPathKey, resolution: 'current-page' },
      ]);
      assert.deepEqual(
        dryRun.aliasResolutions.find((entry) => entry.pathKey === child.syncPathKey).aliasPageIds,
        [child.id, current.id, root.id].sort(),
      );
      await prisma.pagePathAlias.update({
        where: { id: 'future-duplicate' },
        data: { path: 'pages/ExpiredOther.md', pathKey: pathKey('pages/ExpiredOther.md') },
      });
      assert.notEqual((await preflightSpaceFolderMigration(prisma, seeded.spaceId)).inputHash, dryRun.inputHash);
      await prisma.pagePathAlias.update({
        where: { id: 'future-duplicate' },
        data: { path: child.syncPath, pathKey: child.syncPathKey },
      });

      const applied = await migrateSpaceFolders(prisma, seeded.spaceId, {
        expectedInputHash: dryRun.inputHash,
      });
      assert.equal(applied.counts.aliasesCreated, 1);
      assert.equal(applied.counts.aliasesPruned, 1);
      assert.equal(await prisma.pagePathAlias.count({ where: { pageId: child.id } }), 20);
      assert.equal(await prisma.pagePathAlias.count({ where: { id: 'history-00' } }), 0);
      assert.deepEqual(
        (await prisma.pagePathAlias.findMany({
          where: {
            spaceId: seeded.spaceId,
            pathKey: child.syncPathKey,
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date('2026-08-29T00:00:00.000Z') } },
            ],
            page: { deletedAt: null },
          },
          orderBy: { pageId: 'asc' }, select: { pageId: true },
        })).map((alias) => alias.pageId),
        [child.id, current.id, root.id].sort(),
      );
      assert.equal(await prisma.pagePathAlias.count({
        where: { id: { in: [
          'future-duplicate', 'past-duplicate',
          'equal-or-past-duplicate', 'deleted-owner-duplicate',
        ] } },
      }), 4);
      const beforeRerun = await prisma.pagePathAlias.findMany({
        where: { spaceId: seeded.spaceId }, orderBy: { id: 'asc' },
      });
      const rerun = await migrateSpaceFolders(prisma, seeded.spaceId, {
        expectedInputHash: dryRun.inputHash,
      });
      assert.equal(rerun.status, 'completed');
      assert.deepEqual(
        await prisma.pagePathAlias.findMany({
          where: { spaceId: seeded.spaceId }, orderBy: { id: 'asc' },
        }),
        beforeRerun,
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('CLI apply reserves a required report before writes and persists it before commit', {
  skip,
  timeout: 180_000,
}, async () => {
  await withFolderTestDatabase(databaseUrl, async ({ databaseUrl: schemaUrl }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
    const sandbox = await mkdtemp(join(tmpdir(), 'agentwiki-folder-report-'));
    const script = resolve(rootDirectory, 'scripts/space-folder-migration.mjs');
    try {
      const seedTree = async (label) => {
        const seeded = await seedUserAndSpace(prisma, label);
        const rootPage = await createPage(prisma, seeded, {
          title: 'Root', syncPath: `pages/${label}-Root.md`,
        });
        await createPage(prisma, seeded, {
          title: 'Child', parentId: rootPage.id, syncPath: `pages/${label}-Child.md`,
        });
        const dryRun = await preflightSpaceFolderMigration(prisma, seeded.spaceId);
        return { ...seeded, dryRun };
      };
      const runApply = (seeded, extra = [], expectedInputHash = seeded.dryRun.inputHash) => execFileAsync(process.execPath, [
        script,
        '--apply',
        '--space', seeded.spaceId,
        '--expected-input-hash', expectedInputHash,
        ...extra,
      ], { env: { ...process.env, DATABASE_URL: schemaUrl } });
      const assertNoWrites = async (spaceId) => {
        assert.equal(await prisma.folder.count({ where: { spaceId } }), 0);
        assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 0);
        assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 0n);
      };

      const missingReport = await seedTree('MissingReport');
      await assert.rejects(() => runApply(missingReport), /--report/);
      await assertNoWrites(missingReport.spaceId);

      const existingReport = await seedTree('ExistingReport');
      const existingPath = join(sandbox, 'existing.json');
      await writeFile(existingPath, 'do-not-overwrite', { mode: 0o600 });
      await assert.rejects(() => runApply(existingReport, ['--report', existingPath]), /EEXIST|already exists/iu);
      assert.equal(await readFile(existingPath, 'utf8'), 'do-not-overwrite');
      await assertNoWrites(existingReport.spaceId);

      const missingDirectory = await seedTree('MissingDirectory');
      await assert.rejects(
        () => runApply(missingDirectory, ['--report', join(sandbox, 'missing', 'report.json')]),
        /ENOENT|directory/iu,
      );
      await assertNoWrites(missingDirectory.spaceId);

      const unwritable = await seedTree('UnwritableReport');
      const unwritableDirectory = join(sandbox, 'unwritable');
      await mkdir(unwritableDirectory, { mode: 0o700 });
      await chmod(unwritableDirectory, 0o500);
      await assert.rejects(
        () => runApply(unwritable, ['--report', join(unwritableDirectory, 'report.json')]),
        /EACCES|permission/iu,
      );
      await assertNoWrites(unwritable.spaceId);
      await chmod(unwritableDirectory, 0o700);

      const finalWriteFailure = await seedTree('FinalWriteFailure');
      await assert.rejects(
        () => migrateSpaceFolders(prisma, finalWriteFailure.spaceId, {
          expectedInputHash: finalWriteFailure.dryRun.inputHash,
          persistReport: async () => { throw new Error('forced final report failure'); },
        }),
        (error) => error instanceof SpaceFolderMigrationPreflightError
          && error.report.pathChanges.length === 2
          && error.report.plannedFolders.length === 1
          && error.report.plannedAliases.length === 1
          && error.report.rejections.some((entry) => entry.message.includes('forced final report failure')),
      );
      await assertNoWrites(finalWriteFailure.spaceId);

      const wrongHash = await seedTree('WrongHashReport');
      const wrongHashPath = join(sandbox, 'wrong-hash.json');
      await assert.rejects(() => runApply(
        wrongHash,
        ['--report', wrongHashPath],
        '0'.repeat(64),
      ));
      const wrongHashReport = JSON.parse(await readFile(wrongHashPath, 'utf8'));
      assert.equal(wrongHashReport.status, 'rejected');
      assert.equal(wrongHashReport.pathChanges.length, 2);
      assert.equal(wrongHashReport.plannedFolders.length, 1);
      assert.equal(wrongHashReport.plannedAliases.length, 1);
      await assertNoWrites(wrongHash.spaceId);

      const parentReplacement = await seedTree('ParentReplacement');
      const reportParent = join(sandbox, 'replace-parent');
      const movedReportParent = join(sandbox, 'replace-parent-moved');
      await mkdir(reportParent, { mode: 0o700 });
      const replacedPath = join(reportParent, 'apply.json');
      const reservation = await reserveReportTarget(replacedPath);
      try {
        await assert.rejects(
          () => migrateSpaceFolders(prisma, parentReplacement.spaceId, {
            expectedInputHash: parentReplacement.dryRun.inputHash,
            persistReport: async (value) => {
              await rename(reportParent, movedReportParent);
              await mkdir(reportParent, { mode: 0o700 });
              await writeFile(replacedPath, 'other-target-must-survive', { mode: 0o600 });
              await reservation.write(value);
            },
          }),
          (error) => error instanceof SpaceFolderMigrationPreflightError
            && error.report.pathChanges.length === 2
            && error.report.rejections.some((entry) => entry.message.includes('identity changed')),
        );
        assert.equal(await readFile(replacedPath, 'utf8'), 'other-target-must-survive');
        await assertNoWrites(parentReplacement.spaceId);
      } finally {
        await reservation.close();
      }

      const invalidDatabaseReportPath = join(sandbox, 'invalid-database.json');
      await assert.rejects(() => execFileAsync(process.execPath, [
        script,
        '--apply', '--space', wrongHash.spaceId,
        '--expected-input-hash', wrongHash.dryRun.inputHash,
        '--report', invalidDatabaseReportPath,
      ], { env: { ...process.env, DATABASE_URL: 'not-a-postgresql-url' } }));
      const invalidDatabaseReport = JSON.parse(await readFile(invalidDatabaseReportPath, 'utf8'));
      assert.equal(invalidDatabaseReport.status, 'rejected');
      assert.notEqual(invalidDatabaseReport.status, 'reserved');
      assert.ok(invalidDatabaseReport.rejections.some((entry) => entry.code === 'MIGRATION_EXECUTION_FAILED'));

      const prismaConnectionReportPath = join(sandbox, 'prisma-connection.json');
      await assert.rejects(() => execFileAsync(process.execPath, [
        script,
        '--apply', '--space', wrongHash.spaceId,
        '--expected-input-hash', wrongHash.dryRun.inputHash,
        '--report', prismaConnectionReportPath,
      ], {
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://neomei@127.0.0.1:1/agentwiki_folder_test?connect_timeout=1',
        },
      }));
      const prismaConnectionReport = JSON.parse(await readFile(prismaConnectionReportPath, 'utf8'));
      assert.equal(prismaConnectionReport.status, 'rejected');
      assert.notEqual(prismaConnectionReport.status, 'reserved');
      assert.ok(prismaConnectionReport.rejections.some((entry) => entry.code === 'MIGRATION_EXECUTION_FAILED'));

      const preflightRejected = await seedTree('PreflightRejectedReport');
      await prisma.pagePathAlias.create({ data: {
        id: randomUUID(),
        spaceId: preflightRejected.spaceId,
        pageId: (await prisma.page.findFirstOrThrow({
          where: { spaceId: preflightRejected.spaceId }, orderBy: { id: 'asc' },
        })).id,
        path: 'pages/invalid?.md',
        pathKey: 'pages/invalid?.md',
      } });
      const preflightRejectedPath = join(sandbox, 'preflight-rejected.json');
      await assert.rejects(() => execFileAsync(process.execPath, [
        script,
        '--dry-run', '--space', preflightRejected.spaceId,
        '--report', preflightRejectedPath,
      ], { env: { ...process.env, DATABASE_URL: schemaUrl } }));
      const preflightRejectedReport = JSON.parse(await readFile(preflightRejectedPath, 'utf8'));
      assert.equal(preflightRejectedReport.status, 'rejected');
      assert.equal(preflightRejectedReport.pathChanges.length, 2);
      assert.equal(preflightRejectedReport.plannedFolders.length, 1);
      assert.equal(preflightRejectedReport.plannedAliases.length, 1);
      assert.ok(preflightRejectedReport.rejections.some((entry) => entry.code === 'PAGE_ALIAS_INVALID'));
      await assertNoWrites(preflightRejected.spaceId);

      const successful = await seedTree('SuccessfulReport');
      const reportPath = join(sandbox, 'applied.json');
      const successfulCommand = await runApply(successful, ['--report', reportPath]);
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      const stdoutReport = JSON.parse(successfulCommand.stdout);
      assert.equal(report.status, 'applied');
      assert.equal(report.inputHash, successful.dryRun.inputHash);
      assert.equal(report.pathChanges.length, 2);
      assert.equal(report.plannedFolders.length, 1);
      assert.deepEqual(stdoutReport.pathChanges, report.pathChanges);
      assert.deepEqual(stdoutReport.plannedFolders, report.plannedFolders);
      assert.deepEqual(stdoutReport.plannedAliases, report.plannedAliases);
      assert.equal(await prisma.folder.count({ where: { spaceId: successful.spaceId } }), 1);
    } finally {
      await chmod(join(sandbox, 'unwritable'), 0o700).catch(() => {});
      await rm(sandbox, { recursive: true, force: true });
      await prisma.$disconnect();
    }
  });
});

test('apply report lifecycle writes success once before commit and rewrites only after commit failure', {
  skip,
  timeout: 180_000,
}, async () => {
  await withFolderTestDatabase(databaseUrl, async ({ databaseUrl: schemaUrl }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
    try {
      const seedTree = async (label) => {
        const seeded = await seedUserAndSpace(prisma, label);
        const rootPage = await createPage(prisma, seeded, {
          title: 'Root', syncPath: `pages/${label}-Root.md`,
        });
        await createPage(prisma, seeded, {
          title: 'Child', parentId: rootPage.id, syncPath: `pages/${label}-Child.md`,
        });
        const dryRun = await preflightSpaceFolderMigration(prisma, seeded.spaceId);
        return { ...seeded, dryRun };
      };
      const argsFor = (seeded, mode = 'apply') => ({
        mode,
        spaceId: seeded.spaceId,
        reportPath: '/fd-bound-by-test',
        expectedInputHash: mode === 'apply' ? seeded.dryRun.inputHash : null,
      });

      const successful = await seedTree('LifecycleSuccess');
      const successWrites = [];
      const successOutcome = await runSpaceFolderMigrationMode(
        argsFor(successful),
        prisma,
        { write: async (value) => {
          successWrites.push(structuredClone(value));
          if (successWrites.length > 1) throw new Error('old post-commit report write');
        } },
      );
      assert.equal(successOutcome.ok, true);
      assert.equal(successWrites.length, 1);
      assert.equal(successWrites[0].status, 'applied');
      assert.equal(successWrites[0].pathChanges.length, 2);
      assert.equal(successWrites[0].plannedFolders.length, 1);
      assert.equal(successWrites[0].plannedAliases.length, 1);
      assert.equal(await prisma.folder.count({ where: { spaceId: successful.spaceId } }), 1);

      const dryRunOnly = await seedTree('LifecycleDryRun');
      const dryRunWrites = [];
      const dryRunOutcome = await runSpaceFolderMigrationMode(
        argsFor(dryRunOnly, 'dry-run'),
        prisma,
        { write: async (value) => { dryRunWrites.push(structuredClone(value)); } },
      );
      assert.equal(dryRunOutcome.ok, true);
      assert.deepEqual(dryRunWrites.map((value) => value.status), ['ready']);
      assert.equal(await prisma.folder.count({ where: { spaceId: dryRunOnly.spaceId } }), 0);

      const commitFailure = await seedTree('LifecycleCommitFailure');
      const commitFailureWrites = [];
      const commitFailingPrisma = new Proxy(prisma, {
        get(realPrisma, property) {
          if (property === '$transaction') {
            return (callback, options) => realPrisma.$transaction(async (tx) => {
              await callback(tx);
              throw new Error('forced commit failure');
            }, options);
          }
          const value = Reflect.get(realPrisma, property, realPrisma);
          return typeof value === 'function' ? value.bind(realPrisma) : value;
        },
      });
      const commitFailureOutcome = await runSpaceFolderMigrationMode(
        argsFor(commitFailure),
        commitFailingPrisma,
        { write: async (value) => { commitFailureWrites.push(structuredClone(value)); } },
      );
      assert.equal(commitFailureOutcome.ok, false);
      assert.deepEqual(commitFailureWrites.map((value) => value.status), ['applied', 'rejected']);
      assert.match(commitFailureOutcome.report.rejections.at(-1).message, /forced commit failure/u);
      assert.equal(commitFailureOutcome.report.pathChanges.length, 2);
      assert.equal(await prisma.folder.count({ where: { spaceId: commitFailure.spaceId } }), 0);
      assert.equal(await prisma.spaceKnowledgeRevision.count({
        where: { spaceId: commitFailure.spaceId },
      }), 0);

      const combinedFailure = await seedTree('LifecycleCombinedFailure');
      let combinedWriteCount = 0;
      const combinedOutcome = await runSpaceFolderMigrationMode(
        argsFor(combinedFailure),
        commitFailingPrisma,
        { write: async () => {
          combinedWriteCount += 1;
          if (combinedWriteCount === 2) throw new Error('forced rejection rewrite failure');
        } },
      );
      assert.equal(combinedOutcome.ok, false);
      assert.equal(combinedWriteCount, 2);
      assert.match(combinedOutcome.reportPersistenceError.message, /forced rejection rewrite failure/u);
      assert.equal(await prisma.folder.count({ where: { spaceId: combinedFailure.spaceId } }), 0);
    } finally {
      await prisma.$disconnect();
    }
  });
});
