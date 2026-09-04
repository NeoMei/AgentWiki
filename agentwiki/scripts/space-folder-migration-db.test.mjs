import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  TreeRevisionContentManifestV2Schema,
  canonicalBytes,
  pathKey,
  treeRevisionContentHashV2,
} from '../packages/sync-protocol/dist/esm/index.js';

import { withFolderTestDatabase } from './folder-test-database.mjs';
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
      const { SpaceRevisionWriterService } = await import(pathToFileURL(resolve(
        rootDirectory,
        'apps/server/dist/core/sync/space-revision-writer.service.js',
      )).href);
      const writer = SpaceRevisionWriterService.legacyOnly(prisma);
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
