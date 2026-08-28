import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  captureFolderDatabaseSafetyInventory,
  folderDatabaseSafetyInventoryDigest,
  validateFolderTestDatabaseUrl,
  withFolderTestDatabase,
} from './folder-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { pathKey } = requireFromServer('@neomei/agentwiki-sync-protocol');
const { AuthorizationService } = requireFromServer('./dist/core/authorization/authorization.service.js');
const { PageService } = requireFromServer('./dist/core/page/page.service.js');
const { ReadableSyncPathService } = requireFromServer('./dist/core/sync/readable-sync-path.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const { ContentTreeService } = requireFromServer('./dist/content-tree/content-tree.service.js');
const { PageTemplateService } = requireFromServer('./dist/page-templates/page-template.service.js');
const { ReviewService } = requireFromServer('./dist/review/review.service.js');

const baseDatabaseUrl = process.env.FOLDER_TEST_DATABASE_URL;

const administrativeUrl = (value) => {
  const parsed = validateFolderTestDatabaseUrl(value);
  parsed.searchParams.delete('schema');
  return parsed.toString();
};

const countFolderSchemas = async (value) => {
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl(value) } } });
  try {
    const rows = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM pg_namespace
      WHERE nspname LIKE 'folder\_test\_%' ESCAPE '\'
    `;
    return rows[0].count;
  } finally {
    await prisma.$disconnect();
  }
};

const countSanitizedMigrationDirectories = async () => (
  (await readdir(tmpdir())).filter((entry) => entry.startsWith('agentwiki-folder-migrations-')).length
);

const expectCode = async (promise, expectedCode) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.businessCode ?? error?.code, expectedCode);
    return true;
  });
};

test('Folder-aware Page consumers are atomic in real PostgreSQL', {
  skip: baseDatabaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
  timeout: 300_000,
}, async (t) => {
  const adminUrl = administrativeUrl(baseDatabaseUrl);
  const inventoryClient = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  let inventoryBefore;
  try {
    inventoryBefore = await captureFolderDatabaseSafetyInventory(adminUrl, inventoryClient);
  } finally {
    await inventoryClient.$disconnect();
  }

  let operationError;
  try {
    await withFolderTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const writer = new SpaceRevisionWriterService(prisma);
      const syncPaths = new ReadableSyncPathService();
      const contentTree = new ContentTreeService(prisma, writer, syncPaths);
      const authorization = new AuthorizationService(prisma);
      const config = { get: (_key, fallback) => fallback };
      const templates = new PageTemplateService(prisma, authorization, config, writer);
      const search = {
        indexPage: async () => ({ lexicalIndexed: true }),
        deletePageIndex: async () => undefined,
      };
      const graph = { enqueue: () => undefined };
      const pages = new PageService(
        prisma, search, writer, syncPaths, graph, templates, authorization, contentTree,
      );
      const reviews = new ReviewService(
        prisma, search, writer, syncPaths, graph, contentTree,
      );
      const suffix = schemaName.slice('folder_test_'.length);
      const userId = `consumer-user-${suffix}`;
      const principal = { userId, platformRole: 'user' };
      let serial = 0;
      let moveState;

      const createSpace = async (label) => {
        serial += 1;
        const id = `${label}-${serial}-${suffix}`;
        await prisma.space.create({ data: { id, name: label, slug: id } });
        await prisma.spaceMember.create({ data: { userId, spaceId: id, role: 'owner' } });
        return id;
      };

      const seedFolder = (spaceId, label, sortOrder = 0) => prisma.folder.create({ data: {
        id: `${label.toLowerCase()}-${spaceId}`,
        spaceId,
        parentId: null,
        name: label,
        nameKey: label.toLowerCase(),
        path: `pages/${label}`,
        pathKey: pathKey(`pages/${label}`),
        sortOrder,
        createdByUserId: userId,
        lastModifiedByUserId: userId,
      } });

      try {
        await prisma.user.create({ data: {
          id: userId,
          email: `${userId}@content-tree-consumers.test`,
          type: 'human',
          platformRole: 'user',
        } });

        await t.test('Page create commits Page, tree revision, and sync revision together and rolls all back on writer failure', async () => {
          const spaceId = await createSpace('page-create');
          const folder = await seedFolder(spaceId, 'Project');
          const created = await pages.create({
            title: 'Plan', content: '# Plan', spaceId,
            folderId: folder.id, expectedTreeRevision: '0',
          }, principal);
          assert.equal(created.folderId, folder.id);
          assert.equal(created.parentId, null);
          assert.equal(created.path, 'pages/Project/Plan.md');
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);

          const originalAdvance = writer.advanceStructuralPages;
          writer.advanceStructuralPages = async () => {
            throw new Error('forced structural revision failure');
          };
          try {
            await assert.rejects(pages.create({
              title: 'Must roll back', spaceId,
              folderId: folder.id, expectedTreeRevision: '1',
            }, principal), /forced structural revision failure/u);
          } finally {
            writer.advanceStructuralPages = originalAdvance;
          }
          assert.equal(await prisma.page.count({ where: { spaceId, title: 'Must roll back' } }), 0);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);
        });

        await t.test('Page folder move rolls aliases and versions back on stale CAS, then commits through ContentTree', async () => {
          const spaceId = await createSpace('page-move');
          const source = await seedFolder(spaceId, 'Source', 0);
          const target = await seedFolder(spaceId, 'Target', 1);
          const created = await pages.create({
            title: 'Weekly', content: '# Weekly', spaceId,
            folderId: source.id, expectedTreeRevision: '0',
          }, principal);

          await expectCode(pages.update(created.id, {
            folderId: target.id,
            expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
            expectedTreeRevision: '1',
          }, userId), 'RESOURCE_CONFLICT');
          assert.equal(await prisma.pagePathAlias.count({ where: { spaceId } }), 0);
          assert.equal(await prisma.pageVersion.count({ where: { pageId: created.id } }), 0);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);

          const current = await prisma.page.findUniqueOrThrow({ where: { id: created.id } });
          const moved = await pages.update(created.id, {
            folderId: target.id,
            expectedUpdatedAt: current.updatedAt.toISOString(),
            expectedTreeRevision: '1',
          }, userId);
          assert.equal(moved.folderId, target.id);
          assert.equal(moved.path, 'pages/Target/Weekly.md');
          assert.equal((await prisma.pageVersion.findFirstOrThrow({ where: { pageId: created.id } })).folderId, source.id);
          assert.equal((await prisma.pagePathAlias.findFirstOrThrow({ where: { pageId: created.id } })).path, 'pages/Source/Weekly.md');
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 2n);
          moveState = { spaceId, pageId: created.id, sourceFolderId: source.id, targetFolderId: target.id };
        });

        await t.test('template-based Page create resolves the immutable snapshot inside the locked Page transaction', async () => {
          const spaceId = await createSpace('template-page');
          const folder = await seedFolder(spaceId, 'Reports');
          const template = await prisma.pageTemplate.create({ data: {
            scope: 'system', scopeKey: 'system', stableKey: `db-${suffix}`,
            category: 'reporting', displayOrder: 0,
            nameI18n: { 'zh-CN': '周报', en: 'Weekly' },
            descriptionI18n: { 'zh-CN': '模板', en: 'Template' },
            defaultTitleI18n: { 'zh-CN': '周报', en: 'Weekly' },
            currentVersion: 1,
          } });
          await prisma.pageTemplateVersion.create({ data: {
            templateId: template.id, version: 1,
            contentI18n: { 'zh-CN': '# 周报', en: '# Weekly template' },
            contentHash: 'a'.repeat(64),
          } });

          const created = await pages.create({
            title: 'Generated report', spaceId, folderId: folder.id,
            expectedTreeRevision: '0', templateId: template.id,
            templateVersion: 1, templateLocale: 'en',
          }, principal);
          const persisted = await prisma.page.findUniqueOrThrow({ where: { id: created.id } });
          assert.equal(persisted.content, '# Weekly template');
          assert.equal(persisted.folderId, folder.id);
          assert.equal(persisted.sourceTemplateId, template.id);
          assert.equal(persisted.sourceTemplateVersion, 1);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
        });

        await t.test('Page-version restore replays folder placement, aliases, and folderId snapshots atomically', async () => {
          assert.ok(moveState);
          const version = await prisma.pageVersion.findFirstOrThrow({
            where: { pageId: moveState.pageId },
            orderBy: { createdAt: 'asc' },
          });
          const beforeCount = await prisma.pageVersion.count({ where: { pageId: moveState.pageId } });
          const restored = await pages.restoreVersion(moveState.pageId, version.id, '2');
          assert.equal(restored.folderId, moveState.sourceFolderId);
          assert.equal(restored.path, 'pages/Source/Weekly.md');
          const snapshots = await prisma.pageVersion.findMany({
            where: { pageId: moveState.pageId }, orderBy: { createdAt: 'asc' },
          });
          assert.equal(snapshots.length, beforeCount + 1);
          assert.equal(snapshots.at(-1).folderId, moveState.targetFolderId);
          assert.equal(await prisma.pagePathAlias.count({ where: { pageId: moveState.pageId } }), 2);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: moveState.spaceId } })).contentTreeRevision, 3n);

          const stableVersionCount = snapshots.length;
          await expectCode(pages.restoreVersion(moveState.pageId, version.id, '2'), 'CONTENT_TREE_CONFLICT');
          assert.equal(await prisma.pageVersion.count({ where: { pageId: moveState.pageId } }), stableVersionCount);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: moveState.spaceId } })).contentTreeRevision, 3n);
        });

        await t.test('Review publish commits Page placement once and rolls claim/Page/revisions back on a structural writer failure', async () => {
          const spaceId = await createSpace('review-publish');
          const folder = await seedFolder(spaceId, 'Reviewed');
          const makeChangeSet = async (title) => prisma.changeSet.create({ data: {
            title,
            status: 'approved',
            spaceId,
            createdByUserId: userId,
            items: { create: {
              type: 'create_page',
              status: 'accepted',
              payload: {
                title, content: `# ${title}`, folderId: folder.id,
                expectedTreeRevision: (await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision.toString(),
              },
            } },
          }, include: { items: true } });

          const publishedSet = await makeChangeSet('Published by review');
          await reviews.publish(publishedSet.id);
          const publishedPage = await prisma.page.findFirstOrThrow({ where: { spaceId, title: 'Published by review' } });
          assert.equal(publishedPage.folderId, folder.id);
          assert.equal(publishedPage.parentId, null);
          assert.equal(publishedPage.syncPath, 'pages/Reviewed/Published by review.md');
          assert.equal((await prisma.changeSet.findUniqueOrThrow({ where: { id: publishedSet.id } })).status, 'published');
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);

          const rollbackSet = await makeChangeSet('Review rollback');
          const originalAdvance = writer.advanceStructuralPages;
          writer.advanceStructuralPages = async () => {
            throw new Error('forced review structural revision failure');
          };
          try {
            await assert.rejects(reviews.publish(rollbackSet.id), /forced review structural revision failure/u);
          } finally {
            writer.advanceStructuralPages = originalAdvance;
          }
          assert.equal(await prisma.page.count({ where: { spaceId, title: 'Review rollback' } }), 0);
          assert.equal((await prisma.changeSet.findUniqueOrThrow({ where: { id: rollbackSet.id } })).status, 'approved');
          assert.equal((await prisma.changeItem.findFirstOrThrow({ where: { changeSetId: rollbackSet.id } })).status, 'accepted');
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);
        });

        await t.test('Review submission publish binds Folder placement to one prebuilt Sync revision and rolls it back with tree CAS failure', async () => {
          const spaceId = await createSpace('review-submission');
          const folder = await seedFolder(spaceId, 'Imported');
          const makeSubmissionSet = async (title) => {
            const changeSet = await prisma.changeSet.create({ data: {
              title,
              status: 'approved',
              spaceId,
              createdByUserId: userId,
              items: { create: {
                type: 'create_page',
                status: 'accepted',
                payload: {
                  title, content: `# ${title}`, folderId: folder.id,
                  expectedTreeRevision: (await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision.toString(),
                },
              } },
            }, include: { items: true } });
            const submission = await prisma.knowledgeSubmission.create({ data: {
              spaceId,
              principalKey: userId,
              idempotencyKey: `submission-${changeSet.id}`,
              schemaVersion: 'knowledge-bundle@1',
              recipeVersion: 'folder-test',
              contentHash: 'a'.repeat(64),
              bundle: {
                schemaVersion: 'knowledge-bundle@1', recipeVersion: 'folder-test',
                spaceId, baseRevision: null, pages: [], memories: [], relations: [],
                provenance: [], deletions: [],
              },
              changeSetId: changeSet.id,
            } });
            return { changeSet, submission };
          };

          const published = await makeSubmissionSet('Imported by review');
          await reviews.publish(published.changeSet.id);
          const page = await prisma.page.findFirstOrThrow({
            where: { spaceId, title: 'Imported by review' },
          });
          const submission = await prisma.knowledgeSubmission.findUniqueOrThrow({
            where: { id: published.submission.id },
          });
          assert.equal(page.folderId, folder.id);
          assert.equal(page.syncPath, 'pages/Imported/Imported by review.md');
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);
          assert.ok(submission.appliedRevisionId);
          const revisionRow = await prisma.syncRevisionPageRow.findFirstOrThrow({
            where: { revisionId: submission.appliedRevisionId, pageId: page.knowledgeKey },
          });
          assert.equal(revisionRow.folderId, folder.id);

          const rollback = await makeSubmissionSet('Submission rollback');
          const originalAdvanceTree = writer.advanceContentTreeRevision;
          writer.advanceContentTreeRevision = async () => {
            throw new Error('forced submission tree revision failure');
          };
          try {
            await assert.rejects(
              reviews.publish(rollback.changeSet.id),
              /forced submission tree revision failure/u,
            );
          } finally {
            writer.advanceContentTreeRevision = originalAdvanceTree;
          }
          assert.equal(await prisma.page.count({ where: { spaceId, title: 'Submission rollback' } }), 0);
          assert.equal((await prisma.changeSet.findUniqueOrThrow({ where: { id: rollback.changeSet.id } })).status, 'approved');
          assert.equal((await prisma.knowledgeSubmission.findUniqueOrThrow({ where: { id: rollback.submission.id } })).appliedRevisionId, null);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);
        });
      } finally {
        await prisma.$disconnect();
      }
    });
  } catch (error) {
    operationError = error;
  }

  const finalClient = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  let inventoryAfter;
  try {
    inventoryAfter = await captureFolderDatabaseSafetyInventory(adminUrl, finalClient);
  } finally {
    await finalClient.$disconnect();
  }
  assert.equal(await countFolderSchemas(baseDatabaseUrl), 0);
  assert.equal(await countSanitizedMigrationDirectories(), 0);
  assert.deepEqual(inventoryAfter, inventoryBefore);
  const beforeDigest = folderDatabaseSafetyInventoryDigest(inventoryBefore);
  const afterDigest = folderDatabaseSafetyInventoryDigest(inventoryAfter);
  assert.equal(afterDigest, beforeDigest);
  console.log('folder_test_schemas=0');
  console.log('sanitized_temp_dirs=0');
  console.log(`public_inventory_before=${beforeDigest}`);
  console.log(`public_inventory_after=${afterDigest}`);
  console.log('public_inventory_equal=true');
  if (operationError) throw operationError;
});
