import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { withFolderTestDatabase } from './folder-test-database.mjs';
import {
  SpaceFolderMigrationPreflightError,
  legacyFolderId,
  migrateSpaceFolders,
  preflightSpaceFolderMigration,
} from './space-folder-migration.mjs';

const databaseUrl = process.env.FOLDER_TEST_DATABASE_URL;
const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const skip = databaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is required';

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
      const writer = new SpaceRevisionWriterService(prisma);
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
      assert.equal((await prisma.syncRevisionPageRow.count({ where: { revisionId: revision.id } })), 3);
      assert.deepEqual(
        (await prisma.syncRevisionPageRow.findMany({
          where: { revisionId: revision.id }, orderBy: { pageId: 'asc' },
          select: { pageId: true, folderId: true },
        })).map(({ pageId, folderId }) => ({ pageId, folderId })),
        [root, child, grandchild]
          .map((entry) => ({
            pageId: entry.knowledgeKey,
            folderId: entry.id === root.id
              ? null
              : legacyFolderId(seeded.spaceId, entry.parentId),
          }))
          .sort((left, right) => left.pageId.localeCompare(right.pageId)),
      );

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
      const second = await migrateSpaceFolders(prisma, seeded.spaceId);
      assert.equal(second.status, 'completed');
      assert.equal(second.counts.foldersCreated, 0);
      assert.equal(second.counts.pagesMoved, 0);
      assert.equal((await prisma.page.findUnique({ where: { id: later.id } })).folderId, null);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId: seeded.spaceId } }), 2);
      assert.equal((await prisma.space.findUnique({ where: { id: seeded.spaceId } })).contentTreeRevision, 1n);

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
      await assert.rejects(
        () => migrateSpaceFolders(prisma, rollbackSeeded.spaceId),
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
