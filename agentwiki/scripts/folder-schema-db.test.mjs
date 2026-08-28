import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  validateFolderTestDatabaseUrl,
  withFolderTestDatabase,
} from './folder-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const baseDatabaseUrl = process.env.FOLDER_TEST_DATABASE_URL;

const administrativeUrl = (value) => {
  const parsed = validateFolderTestDatabaseUrl(value);
  parsed.searchParams.delete('schema');
  return parsed.toString();
};

const countFolderTestSchemas = async (value) => {
  const prisma = new PrismaClient({
    datasources: { db: { url: administrativeUrl(value) } },
  });
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

test('Folder database URLs fail closed', () => {
  assert.throws(() => validateFolderTestDatabaseUrl(undefined), /required/iu);
  assert.throws(() => validateFolderTestDatabaseUrl('not a url'), /valid PostgreSQL/iu);
  assert.throws(() => validateFolderTestDatabaseUrl('mysql://localhost/agentwiki_test'), /PostgreSQL/iu);
  assert.throws(() => validateFolderTestDatabaseUrl('postgresql://localhost/agentwiki'), /test/iu);
  assert.throws(
    () => validateFolderTestDatabaseUrl('postgresql://localhost/agentwiki_test?schema=public'),
    /schema/iu,
  );
  assert.throws(
    () => validateFolderTestDatabaseUrl('postgresql://localhost/agentwiki_test?schema='),
    /schema/iu,
  );
  for (const repeatedSchema of [
    'schema=folder_test_one&schema=folder_test_two',
    'schema=folder_test_safe&schema=public',
    'schema=public&schema=folder_test_safe',
    'schema=&schema=folder_test_safe',
  ]) {
    assert.throws(
      () => validateFolderTestDatabaseUrl(
        `postgresql://localhost/agentwiki_test?${repeatedSchema}`,
      ),
      /schema/iu,
    );
  }
  assert.doesNotThrow(
    () => validateFolderTestDatabaseUrl('postgresql://localhost/agentwiki_test'),
  );
  assert.doesNotThrow(
    () => validateFolderTestDatabaseUrl(
      'postgresql://localhost/agentwiki_test?schema=folder_test_existing',
    ),
  );
});

test('Folder harness creates and removes only generated schemas', {
  skip: baseDatabaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const before = await countFolderTestSchemas(baseDatabaseUrl);
  let generatedSchema;
  await withFolderTestDatabase(baseDatabaseUrl, async ({ schemaName }) => {
    generatedSchema = schemaName;
    assert.match(schemaName, /^folder_test_[a-z0-9_]+$/u);
    assert.notEqual(schemaName, 'public');
    assert.equal(await countFolderTestSchemas(baseDatabaseUrl), before + 1);
  });
  assert.match(generatedSchema, /^folder_test_[a-z0-9_]+$/u);
  assert.equal(await countFolderTestSchemas(baseDatabaseUrl), before);
});

test('Folder Space-scoped relations reject cross-Space targets', {
  skip: baseDatabaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  await withFolderTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = schemaName.replace('folder_test_', '');
    const ids = Object.fromEntries([
      'user', 'spaceA', 'spaceB', 'changeA', 'changeB', 'folderA', 'folderB',
      'pageA', 'pageB', 'batchB',
    ].map((name) => [name, `${name}_${suffix}`]));
    try {
      await prisma.user.create({
        data: { id: ids.user, email: `${ids.user}@folder-relations.test` },
      });
      await prisma.space.createMany({ data: [
        { id: ids.spaceA, name: 'Space A', slug: ids.spaceA },
        { id: ids.spaceB, name: 'Space B', slug: ids.spaceB },
      ] });
      await prisma.changeSet.createMany({ data: [
        { id: ids.changeA, title: 'Change A', spaceId: ids.spaceA },
        { id: ids.changeB, title: 'Change B', spaceId: ids.spaceB },
      ] });
      await prisma.folder.createMany({ data: [
        {
          id: ids.folderA,
          spaceId: ids.spaceA,
          name: 'Folder A',
          nameKey: 'folder a',
          path: 'pages/Folder A',
          pathKey: 'pages/folder a',
          sourceChangeSetId: ids.changeA,
        },
        {
          id: ids.folderB,
          spaceId: ids.spaceB,
          name: 'Folder B',
          nameKey: 'folder b',
          path: 'pages/Folder B',
          pathKey: 'pages/folder b',
          sourceChangeSetId: ids.changeB,
        },
      ] });
      await prisma.page.createMany({ data: [
        {
          id: ids.pageA,
          title: 'Page A',
          slug: ids.pageA,
          spaceId: ids.spaceA,
          authorId: ids.user,
          folderId: ids.folderA,
          syncPath: 'pages/Folder A/Page A.md',
          syncPathKey: 'pages/folder a/page a.md',
        },
        {
          id: ids.pageB,
          title: 'Page B',
          slug: ids.pageB,
          spaceId: ids.spaceB,
          authorId: ids.user,
          folderId: ids.folderB,
          syncPath: 'pages/Folder B/Page B.md',
          syncPathKey: 'pages/folder b/page b.md',
        },
      ] });
      await prisma.contentDeletionBatch.create({ data: {
        id: ids.batchB,
        spaceId: ids.spaceB,
        rootFolderId: ids.folderB,
        deletedByUserId: ids.user,
        deletedTreeRevision: 1n,
        folderCount: 1,
        pageCount: 1,
        impactHash: 'b'.repeat(64),
      } });

      await assert.rejects(
        prisma.folder.update({
          where: { id: ids.folderA },
          data: { sourceChangeSetId: ids.changeB },
        }),
        /foreign key|constraint/iu,
      );
      await assert.rejects(
        prisma.page.update({ where: { id: ids.pageA }, data: { folderId: ids.folderB } }),
        /foreign key|constraint/iu,
      );
      await assert.rejects(
        prisma.pagePathAlias.create({ data: {
          spaceId: ids.spaceA,
          pageId: ids.pageB,
          path: 'pages/Wrong Space.md',
          pathKey: 'pages/wrong space.md',
        } }),
        /foreign key|constraint/iu,
      );
      await assert.rejects(
        prisma.contentDeletionBatch.create({ data: {
          spaceId: ids.spaceA,
          rootFolderId: ids.folderB,
          deletedByUserId: ids.user,
          deletedTreeRevision: 2n,
          folderCount: 1,
          pageCount: 0,
          impactHash: 'c'.repeat(64),
        } }),
        /foreign key|constraint/iu,
      );
      await assert.rejects(
        prisma.folder.update({
          where: { id: ids.folderA },
          data: { deletionBatchId: ids.batchB },
        }),
        /foreign key|constraint/iu,
      );
      await assert.rejects(
        prisma.page.update({
          where: { id: ids.pageA },
          data: { deletionBatchId: ids.batchB },
        }),
        /foreign key|constraint/iu,
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('upsert_page tree deltas reject a NULL contentHash', {
  skip: baseDatabaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  await withFolderTestDatabase(baseDatabaseUrl, async ({ databaseUrl }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await assert.rejects(
        prisma.syncRevisionTreeDeltaRow.create({ data: {
          revisionId: 'revision_missing_hash',
          ordinal: 0,
          operation: 'upsert_page',
          pageId: 'page_missing_hash',
        } }),
        /check|constraint/iu,
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});

const seedNoActionRetentionGraph = async (prisma, suffix) => {
  const ids = Object.fromEntries([
    'user', 'space', 'change', 'folder', 'page', 'alias', 'batch',
  ].map((name) => [name, `${name}_${suffix}`]));
  await prisma.user.create({
    data: { id: ids.user, email: `${ids.user}@folder-retention.test` },
  });
  await prisma.space.create({
    data: { id: ids.space, name: 'Retention Space', slug: ids.space },
  });
  await prisma.changeSet.create({
    data: { id: ids.change, title: 'Folder source', spaceId: ids.space },
  });
  await prisma.folder.create({ data: {
    id: ids.folder,
    spaceId: ids.space,
    name: 'Retained Folder',
    nameKey: 'retained folder',
    path: 'pages/Retained Folder',
    pathKey: 'pages/retained folder',
    sourceChangeSetId: ids.change,
  } });
  await prisma.page.create({ data: {
    id: ids.page,
    title: 'Retained Page',
    slug: ids.page,
    spaceId: ids.space,
    authorId: ids.user,
    folderId: ids.folder,
    syncPath: 'pages/Retained Folder/Retained Page.md',
    syncPathKey: 'pages/retained folder/retained page.md',
  } });
  await prisma.pagePathAlias.create({ data: {
    id: ids.alias,
    spaceId: ids.space,
    pageId: ids.page,
    path: 'pages/Old Retained Page.md',
    pathKey: 'pages/old retained page.md',
  } });
  await prisma.contentDeletionBatch.create({ data: {
    id: ids.batch,
    spaceId: ids.space,
    rootFolderId: ids.folder,
    deletedByUserId: ids.user,
    deletedTreeRevision: 3n,
    folderCount: 1,
    pageCount: 1,
    impactHash: 'd'.repeat(64),
  } });
  await prisma.folder.update({
    where: { id: ids.folder },
    data: { deletionBatchId: ids.batch, deletedAt: new Date() },
  });
  await prisma.page.update({
    where: { id: ids.page },
    data: { deletionBatchId: ids.batch, deletedAt: new Date() },
  });
  return ids;
};

test('NO ACTION retains Folder placement, deletion batches, and source evidence on direct physical deletes', {
  skip: baseDatabaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  await withFolderTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const ids = await seedNoActionRetentionGraph(
        prisma,
        schemaName.replace('folder_test_', ''),
      );
      await assert.rejects(
        prisma.folder.delete({ where: { id: ids.folder } }),
        /foreign key|constraint/iu,
      );
      await assert.rejects(
        prisma.contentDeletionBatch.delete({ where: { id: ids.batch } }),
        /foreign key|constraint/iu,
      );
      await assert.rejects(
        prisma.changeSet.delete({ where: { id: ids.change } }),
        /foreign key|constraint/iu,
      );
      assert.equal(await prisma.folder.count({ where: { id: ids.folder } }), 1);
      assert.equal(await prisma.page.count({ where: { id: ids.page } }), 1);
      assert.equal(await prisma.contentDeletionBatch.count({ where: { id: ids.batch } }), 1);
      assert.equal(await prisma.changeSet.count({ where: { id: ids.change } }), 1);
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('whole-Space deletion cascades through the retained NO ACTION relation graph', {
  skip: baseDatabaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  await withFolderTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const ids = await seedNoActionRetentionGraph(
        prisma,
        schemaName.replace('folder_test_', ''),
      );
      await prisma.space.delete({ where: { id: ids.space } });
      assert.equal(await prisma.folder.count({ where: { spaceId: ids.space } }), 0);
      assert.equal(await prisma.page.count({ where: { spaceId: ids.space } }), 0);
      assert.equal(await prisma.pagePathAlias.count({ where: { spaceId: ids.space } }), 0);
      assert.equal(await prisma.contentDeletionBatch.count({ where: { spaceId: ids.space } }), 0);
      assert.equal(await prisma.changeSet.count({ where: { spaceId: ids.space } }), 0);
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('Folder migration enforces hierarchy, aliases, deletion batches, revisions, and cascades', {
  skip: baseDatabaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const before = await countFolderTestSchemas(baseDatabaseUrl);
  await withFolderTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = schemaName.replace('folder_test_', '');
    const ids = Object.fromEntries([
      'user', 'agent', 'space', 'otherSpace', 'root', 'otherRoot', 'child', 'otherChild',
      'page', 'otherPage', 'batch', 'revision',
    ].map((name) => [name, `${name}_${suffix}`]));
    try {
      const guards = await prisma.$queryRawUnsafe(
        `SELECT indexname AS name FROM pg_indexes
         WHERE schemaname = $1 AND indexname IN (
           'Folder_active_sibling_name_key', 'Folder_active_path_key',
           'Folder_spaceId_parentId_deletedAt_sortOrder_id_idx',
           'PagePathAlias_spaceId_pathKey_expiresAt_idx',
           'ContentDeletionBatch_spaceId_restoredAt_createdAt_idx',
           'Page_spaceId_folderId_deletedAt_sortOrder_id_idx',
           'SyncRevisionFolderRow_revisionId_sortOrder_folderId_idx',
           'SyncRevisionTreeDeltaRow_revisionId_folderId_key',
           'SyncRevisionTreeDeltaRow_revisionId_pageId_key'
         )
         UNION ALL
         SELECT conname AS name FROM pg_constraint
         WHERE connamespace = $1::regnamespace AND conname IN (
           'Folder_not_self_parent', 'Folder_non_empty_fields',
           'PagePathAlias_non_empty_path', 'ContentDeletionBatch_actor_check',
           'ContentDeletionBatch_counts_hash_check', 'SyncRevisionFolderRow_non_empty_fields',
           'SyncRevisionTreeDeltaRow_operation_check',
           'SyncRevisionTreeDeltaRow_target_check',
           'SyncRevisionTreeDeltaRow_previous_path_check',
           'SyncRevisionTreeDeltaRow_content_hash_check'
         ) ORDER BY name`,
        schemaName,
      );
      assert.deepEqual(guards.map((row) => row.name), [
        'ContentDeletionBatch_actor_check',
        'ContentDeletionBatch_counts_hash_check',
        'ContentDeletionBatch_spaceId_restoredAt_createdAt_idx',
        'Folder_active_path_key',
        'Folder_active_sibling_name_key',
        'Folder_non_empty_fields',
        'Folder_not_self_parent',
        'Folder_spaceId_parentId_deletedAt_sortOrder_id_idx',
        'PagePathAlias_non_empty_path',
        'PagePathAlias_spaceId_pathKey_expiresAt_idx',
        'Page_spaceId_folderId_deletedAt_sortOrder_id_idx',
        'SyncRevisionFolderRow_non_empty_fields',
        'SyncRevisionFolderRow_revisionId_sortOrder_folderId_idx',
        'SyncRevisionTreeDeltaRow_content_hash_check',
        'SyncRevisionTreeDeltaRow_operation_check',
        'SyncRevisionTreeDeltaRow_previous_path_check',
        'SyncRevisionTreeDeltaRow_revisionId_folderId_key',
        'SyncRevisionTreeDeltaRow_revisionId_pageId_key',
        'SyncRevisionTreeDeltaRow_target_check',
      ]);

      await prisma.user.create({
        data: { id: ids.user, email: `${ids.user}@folder.test` },
      });
      await prisma.agent.create({
        data: { id: ids.agent, name: 'Folder Agent', ownerId: ids.user },
      });
      await prisma.space.createMany({ data: [
        { id: ids.space, name: 'Folder Space', slug: ids.space },
        { id: ids.otherSpace, name: 'Other Space', slug: ids.otherSpace },
      ] });

      const foreignParentId = `foreign_parent_${suffix}`;
      await prisma.folder.create({ data: {
        id: foreignParentId,
        spaceId: ids.otherSpace,
        name: 'Foreign parent',
        nameKey: 'foreign parent',
        path: 'pages/Foreign parent',
        pathKey: 'pages/foreign parent',
      } });
      await assert.rejects(
        prisma.folder.create({ data: {
          spaceId: ids.space,
          parentId: foreignParentId,
          name: 'Cross-space child',
          nameKey: 'cross-space child',
          path: 'pages/Cross-space child',
          pathKey: 'pages/cross-space child',
        } }),
        /foreign key|constraint/iu,
      );

      const root = await prisma.folder.create({ data: {
        id: ids.root,
        spaceId: ids.space,
        name: 'Reports',
        nameKey: 'reports',
        path: 'pages/Reports',
        pathKey: 'pages/reports',
        createdByUserId: ids.user,
        lastModifiedByUserId: ids.user,
      } });
      const otherRoot = await prisma.folder.create({ data: {
        id: ids.otherRoot,
        spaceId: ids.space,
        name: 'Archive',
        nameKey: 'archive',
        path: 'pages/Archive',
        pathKey: 'pages/archive',
        createdByAgentId: ids.agent,
        lastModifiedByAgentId: ids.agent,
      } });
      await assert.rejects(
        prisma.folder.create({ data: {
          spaceId: ids.space,
          name: 'REPORTS',
          nameKey: 'reports',
          path: 'pages/Reports duplicate',
          pathKey: 'pages/reports duplicate',
        } }),
        /unique|constraint/iu,
      );
      await assert.rejects(
        prisma.folder.create({ data: {
          spaceId: ids.space,
          name: 'Different name',
          nameKey: 'different name',
          path: 'pages/Reports',
          pathKey: 'pages/reports',
        } }),
        /unique|constraint/iu,
      );
      await prisma.folder.createMany({ data: [
        {
          id: ids.child,
          spaceId: ids.space,
          parentId: root.id,
          name: 'Weekly',
          nameKey: 'weekly',
          path: 'pages/Reports/Weekly',
          pathKey: 'pages/reports/weekly',
        },
        {
          id: ids.otherChild,
          spaceId: ids.space,
          parentId: otherRoot.id,
          name: 'Weekly',
          nameKey: 'weekly',
          path: 'pages/Archive/Weekly',
          pathKey: 'pages/archive/weekly',
        },
      ] });
      const childWithParent = await prisma.folder.findUniqueOrThrow({
        where: { id: ids.child },
        include: { parent: true },
      });
      assert.equal(childWithParent.parent?.id, root.id);
      const rootWithChildren = await prisma.folder.findUniqueOrThrow({
        where: { id: root.id },
        include: { children: true },
      });
      assert.deepEqual(rootWithChildren.children.map((folder) => folder.id), [ids.child]);

      await assert.rejects(
        prisma.folder.create({ data: {
          spaceId: ids.space,
          parentId: root.id,
          name: 'WEEKLY',
          nameKey: 'weekly',
          path: 'pages/Reports/Weekly duplicate',
          pathKey: 'pages/reports/weekly duplicate',
        } }),
        /unique|constraint/iu,
      );
      await assert.rejects(
        prisma.folder.update({ where: { id: root.id }, data: { parentId: root.id } }),
        /check|constraint/iu,
      );
      const deletedSibling = await prisma.folder.create({ data: {
        spaceId: ids.space,
        parentId: root.id,
        name: 'Old',
        nameKey: 'old',
        path: 'pages/Reports/Old',
        pathKey: 'pages/reports/old',
        deletedAt: new Date('2026-01-01T00:00:00.000Z'),
      } });
      await prisma.folder.create({ data: {
        spaceId: ids.space,
        parentId: root.id,
        name: 'Old',
        nameKey: 'old',
        path: 'pages/Reports/Old',
        pathKey: 'pages/reports/old',
      } });
      assert.ok(deletedSibling.id);

      await prisma.page.createMany({ data: [
        {
          id: ids.page,
          title: 'Reports',
          slug: `reports-${suffix}`,
          spaceId: ids.space,
          authorId: ids.user,
          folderId: null,
          syncPath: 'pages/Reports.md',
          syncPathKey: 'pages/reports.md',
        },
        {
          id: ids.otherPage,
          title: 'Old Reports',
          slug: `old-reports-${suffix}`,
          spaceId: ids.space,
          authorId: ids.user,
          folderId: root.id,
          syncPath: 'pages/Reports/Old Reports.md',
          syncPathKey: 'pages/reports/old reports.md',
        },
      ] });
      assert.equal(root.path, 'pages/Reports');
      assert.equal((await prisma.page.findUniqueOrThrow({ where: { id: ids.page } })).syncPath, 'pages/Reports.md');

      await prisma.pagePathAlias.createMany({ data: [
        {
          spaceId: ids.space,
          pageId: ids.page,
          path: 'pages/Legacy.md',
          pathKey: 'pages/legacy.md',
        },
        {
          spaceId: ids.space,
          pageId: ids.otherPage,
          path: 'pages/Legacy.md',
          pathKey: 'pages/legacy.md',
        },
      ] });
      assert.equal(await prisma.pagePathAlias.count({
        where: { spaceId: ids.space, pathKey: 'pages/legacy.md' },
      }), 2);
      await assert.rejects(
        prisma.pagePathAlias.create({ data: {
          spaceId: ids.space,
          pageId: ids.page,
          path: 'pages/Legacy.md',
          pathKey: 'pages/legacy.md',
        } }),
        /unique|constraint/iu,
      );

      const deletionBatch = await prisma.contentDeletionBatch.create({ data: {
        id: ids.batch,
        spaceId: ids.space,
        rootFolderId: root.id,
        deletedByUserId: ids.user,
        deletedTreeRevision: 7n,
        folderCount: 2,
        pageCount: 1,
        impactHash: 'a'.repeat(64),
      } });
      await prisma.folder.update({
        where: { id: ids.child },
        data: { deletionBatchId: deletionBatch.id, deletedAt: new Date() },
      });
      await prisma.page.update({
        where: { id: ids.otherPage },
        data: { deletionBatchId: deletionBatch.id, deletedAt: new Date() },
      });
      const batchWithMembers = await prisma.contentDeletionBatch.findUniqueOrThrow({
        where: { id: deletionBatch.id },
        include: { rootFolder: true, folders: true, pages: true },
      });
      assert.equal(batchWithMembers.rootFolder.id, root.id);
      assert.deepEqual(batchWithMembers.folders.map((folder) => folder.id), [ids.child]);
      assert.deepEqual(batchWithMembers.pages.map((page) => page.id), [ids.otherPage]);
      for (const invalidActor of [
        { deletedByUserId: null, deletedByAgentId: null },
        { deletedByUserId: ids.user, deletedByAgentId: ids.agent },
      ]) {
        await assert.rejects(
          prisma.contentDeletionBatch.create({ data: {
            spaceId: ids.space,
            rootFolderId: otherRoot.id,
            ...invalidActor,
            deletedTreeRevision: 8n,
            folderCount: 1,
            pageCount: 0,
            impactHash: 'b'.repeat(64),
          } }),
          /check|constraint/iu,
        );
      }
      await assert.rejects(
        prisma.contentDeletionBatch.create({ data: {
          spaceId: ids.space,
          rootFolderId: otherRoot.id,
          deletedByAgentId: ids.agent,
          deletedTreeRevision: 8n,
          folderCount: -1,
          pageCount: 0,
          impactHash: 'not-a-sha256',
        } }),
        /check|constraint/iu,
      );

      await prisma.syncPageContentRow.create({ data: {
        contentHash: 'c'.repeat(64),
        body: '# Reports',
        byteLength: 9,
      } });
      await prisma.syncRevisionFolderRow.create({ data: {
        revisionId: ids.revision,
        folderId: root.id,
        parentFolderId: null,
        name: root.name,
        path: root.path,
        pathKey: root.pathKey,
        sortOrder: root.sortOrder,
        updatedAt: root.updatedAt,
      } });
      await prisma.syncRevisionPageRow.create({ data: {
        revisionId: ids.revision,
        pageId: ids.page,
        folderId: root.id,
        path: 'pages/Reports.md',
        pathKey: 'pages/reports.md',
        title: 'Reports',
        contentHash: 'c'.repeat(64),
        updatedAt: new Date(),
      } });
      await prisma.syncRevisionTreeDeltaRow.createMany({ data: [
        { revisionId: ids.revision, ordinal: 0, operation: 'upsert_folder', folderId: root.id },
        { revisionId: ids.revision, ordinal: 1, operation: 'archive_folder', folderId: ids.child, previousPath: 'pages/Reports/Weekly' },
        { revisionId: ids.revision, ordinal: 2, operation: 'upsert_page', pageId: ids.page, contentHash: 'c'.repeat(64) },
        { revisionId: ids.revision, ordinal: 3, operation: 'archive_page', pageId: ids.otherPage, previousPath: 'pages/Reports/Old Reports.md' },
      ] });
      assert.equal(await prisma.syncRevisionFolderRow.count({ where: { revisionId: ids.revision } }), 1);
      assert.equal((await prisma.syncRevisionPageRow.findUniqueOrThrow({
        where: { revisionId_pageId: { revisionId: ids.revision, pageId: ids.page } },
      })).folderId, root.id);
      assert.equal(await prisma.syncRevisionTreeDeltaRow.count({ where: { revisionId: ids.revision } }), 4);
      await assert.rejects(
        prisma.syncRevisionTreeDeltaRow.create({ data: {
          revisionId: ids.revision,
          ordinal: 4,
          operation: 'upsert_folder',
          folderId: otherRoot.id,
          contentHash: 'd'.repeat(64),
        } }),
        /check|constraint/iu,
      );

      await prisma.space.delete({ where: { id: ids.space } });
      assert.equal(await prisma.folder.count({ where: { spaceId: ids.space } }), 0);
      assert.equal(await prisma.pagePathAlias.count({ where: { spaceId: ids.space } }), 0);
      assert.equal(await prisma.contentDeletionBatch.count({ where: { spaceId: ids.space } }), 0);
      assert.equal(await prisma.page.count({ where: { spaceId: ids.space } }), 0);
    } finally {
      await prisma.$disconnect();
    }
  });
  assert.equal(await countFolderTestSchemas(baseDatabaseUrl), before);
});
