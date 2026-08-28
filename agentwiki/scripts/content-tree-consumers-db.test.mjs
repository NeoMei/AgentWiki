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
const {
  canonicalBytes,
  comparePushChanges,
  confirmationHash,
  contentHash,
  pathKey,
  scopesForAgentAccessRole,
} = requireFromServer('@neomei/agentwiki-sync-protocol');
const { AuthorizationService } = requireFromServer('./dist/core/authorization/authorization.service.js');
const { PageService } = requireFromServer('./dist/core/page/page.service.js');
const { ReadableSyncPathService } = requireFromServer('./dist/core/sync/readable-sync-path.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const { ContentTreeService } = requireFromServer('./dist/content-tree/content-tree.service.js');
const { PageTemplateService } = requireFromServer('./dist/page-templates/page-template.service.js');
const { ReviewService } = requireFromServer('./dist/review/review.service.js');
const { PushSessionService } = requireFromServer('./dist/integrations/obsidian/push-session.service.js');
const { KnowledgeSubmissionService } = requireFromServer('./dist/knowledge-pipeline/knowledge-submission.service.js');
const { SourceService } = requireFromServer('./dist/knowledge-pipeline/source.service.js');
const { McpService } = requireFromServer('./dist/mcp/mcp.service.js');

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
    assert.equal(error?.businessCode ?? error?.syncCode ?? error?.code, expectedCode);
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
      const pushes = new PushSessionService(
        prisma, {}, contentTree, search, undefined, graph,
      );
      const knowledgeSubmissions = new KnowledgeSubmissionService(
        prisma, reviews, authorization, writer,
      );
      const sources = new SourceService(
        prisma, config, reviews, authorization, writer,
      );
      const audit = { record: async () => undefined };
      const mcp = new McpService(
        config, authorization, {}, pages, {}, search, sources, reviews,
        {}, {}, audit, prisma, {}, {},
      );
      const suffix = schemaName.slice('folder_test_'.length);
      const userId = `consumer-user-${suffix}`;
      const principal = { userId, platformRole: 'user' };
      let serial = 0;
      let moveState;

      const holdNextContentTreeLock = () => {
        const original = writer.lockContentTreeSpace;
        let first = true;
        let acquiredResolve;
        let releaseResolve;
        const acquired = new Promise((resolve) => { acquiredResolve = resolve; });
        const released = new Promise((resolve) => { releaseResolve = resolve; });
        writer.lockContentTreeSpace = async (...args) => {
          const locked = await original.call(writer, ...args);
          if (first) {
            first = false;
            acquiredResolve();
            await released;
          }
          return locked;
        };
        return {
          acquired,
          release: () => releaseResolve(),
          restore: () => { writer.lockContentTreeSpace = original; },
        };
      };

      const assertPending = async (promise, message) => {
        const state = await Promise.race([
          promise.then(() => 'settled', () => 'settled'),
          new Promise((resolve) => setTimeout(() => resolve('pending'), 40)),
        ]);
        assert.equal(state, 'pending', message);
      };

      const devicePrincipal = {
        userId,
        platformRole: 'user',
        credentialId: `consumer-credential-${suffix}`,
        credentialFamilyId: `consumer-family-${suffix}`,
      };

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

      const stagePush = async (spaceId, label, changes) => {
        const head = await prisma.spaceKnowledgeRevision.findFirst({
          where: { spaceId }, orderBy: { sequence: 'desc' },
        });
        const baseRevision = head?.id ?? '0';
        const manifestChanges = [];
        for (const change of changes) {
          manifestChanges.push(change.operation === 'archive'
            ? {
              operation: 'archive', pageId: change.pageId,
              previousPath: change.previousPath,
            }
            : {
              operation: 'upsert', pageId: change.pageId, path: change.path,
              title: change.title, contentHash: await contentHash(change.body),
            });
        }
        const manifest = {
          protocolVersion: '1',
          spaceId,
          baseRevision,
          changes: [...manifestChanges].sort(comparePushChanges),
        };
        const hash = await confirmationHash(manifest);
        const sessionId = `${label}-${serial}-${suffix}`;
        const batchId = `batch-${label}-${serial}-${suffix}`;
        await prisma.pushSession.create({ data: {
          id: sessionId,
          credentialFamilyId: devicePrincipal.credentialFamilyId,
          credentialId: devicePrincipal.credentialId,
          userId,
          spaceId,
          baseRevisionId: baseRevision,
          idempotencyKey: sessionId,
          status: 'ready_to_finalize',
          capabilitiesHash: 'not-used-by-finalize',
          confirmationHash: hash,
          confirmationByteLength: canonicalBytes(manifest).byteLength,
          changeCount: changes.length,
          totalBodyBytes: BigInt(changes.reduce((total, change) => (
            total + (change.operation === 'upsert'
              ? new TextEncoder().encode(change.body).byteLength
              : 0)
          ), 0)),
          receivedBatchCount: 1,
          receivedChangeCount: changes.length,
          receivedBodyBytes: BigInt(changes.reduce((total, change) => (
            total + (change.operation === 'upsert'
              ? new TextEncoder().encode(change.body).byteLength
              : 0)
          ), 0)),
          expiresAt: new Date(Date.now() + 60_000),
        } });
        await prisma.pushSessionBatch.create({ data: {
          id: batchId, sessionId, batchIndex: 0,
          batchHash: `hash-${label}-${serial}-${suffix}`,
          receipt: `receipt-${label}-${serial}-${suffix}`,
        } });
        const changeRows = [];
        for (let ordinal = 0; ordinal < changes.length; ordinal += 1) {
          const change = changes[ordinal];
          changeRows.push({
            id: `change-${label}-${ordinal}-${serial}-${suffix}`,
            sessionId,
            batchId,
            ordinal,
            operation: change.operation,
            pageId: change.pageId,
            path: change.operation === 'upsert' ? change.path : null,
            title: change.operation === 'upsert' ? change.title : null,
            body: change.operation === 'upsert' ? change.body : null,
            contentHash: change.operation === 'upsert'
              ? await contentHash(change.body)
              : null,
            previousPath: change.operation === 'archive' ? change.previousPath : null,
          });
        }
        await prisma.pushSessionChange.createMany({ data: changeRows });
        return { sessionId, hash, baseRevision };
      };

      try {
        await prisma.user.create({ data: {
          id: userId,
          email: `${userId}@content-tree-consumers.test`,
          type: 'human',
          platformRole: 'user',
        } });
        await prisma.humanDeviceCredentialFamily.create({ data: {
          id: devicePrincipal.credentialFamilyId,
          userId,
          deviceId: `consumer-device-${suffix}`,
          vaultId: `consumer-vault-${suffix}`,
        } });
        await prisma.humanDeviceCredential.create({ data: {
          id: devicePrincipal.credentialId,
          credentialFamilyId: devicePrincipal.credentialFamilyId,
          userId,
          deviceId: `consumer-device-${suffix}`,
          vaultId: `consumer-vault-${suffix}`,
          deviceName: 'Content tree consumer gate',
          credentialHash: `consumer-credential-hash-${suffix}`,
          status: 'active',
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

        await t.test('Page archive uses caller Page/tree CAS and rolls every audit write back when stale', async () => {
          const spaceId = await createSpace('page-archive');
          const folder = await seedFolder(spaceId, 'Archive');
          const created = await pages.create({
            title: 'Archive me', content: '# Archive me', spaceId,
            folderId: folder.id, expectedTreeRevision: '0',
          }, principal);
          const current = await prisma.page.findUniqueOrThrow({ where: { id: created.id } });
          const stableVersions = await prisma.pageVersion.count({ where: { pageId: created.id } });
          await expectCode(
            pages.remove(created.id, current.updatedAt.toISOString(), '0'),
            'CONTENT_TREE_CONFLICT',
          );
          assert.equal(await prisma.pageVersion.count({ where: { pageId: created.id } }), stableVersions);
          assert.equal((await prisma.page.findUniqueOrThrow({ where: { id: created.id } })).deletedAt, null);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);

          await pages.remove(created.id, current.updatedAt.toISOString(), '1');
          const archived = await prisma.page.findUniqueOrThrow({ where: { id: created.id } });
          assert.ok(archived.deletedAt);
          assert.equal(archived.folderId, folder.id);
          assert.equal(archived.parentId, null);
          assert.equal((await prisma.pageVersion.findFirstOrThrow({
            where: { pageId: created.id }, orderBy: { createdAt: 'desc' },
          })).folderId, folder.id);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 2n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 2);
        });

        await t.test('legacy Page reorder remains fail-closed with the migration flag enabled', async () => {
          const spaceId = await createSpace('legacy-reorder');
          const folder = await seedFolder(spaceId, 'Stable');
          const created = await pages.create({
            title: 'Stable page', spaceId, folderId: folder.id, expectedTreeRevision: '0',
          }, principal);
          const before = await prisma.page.findUniqueOrThrow({ where: { id: created.id } });
          const previous = process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
          process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = 'true';
          try {
            await expectCode(pages.reorder(spaceId, [{
              id: created.id, parentId: null, sortOrder: 99,
            }]), 'PAGE_PARENT_DEPRECATED');
          } finally {
            if (previous === undefined) delete process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
            else process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = previous;
          }
          const after = await prisma.page.findUniqueOrThrow({ where: { id: created.id } });
          assert.equal(after.parentId, null);
          assert.equal(after.folderId, before.folderId);
          assert.equal(after.sortOrder, before.sortOrder);
          assert.equal(after.syncPath, before.syncPath);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);
        });

        await t.test('Obsidian v1 finalize atomically creates, moves, archives, and restores Folder-aware Pages', async () => {
          const spaceId = await createSpace('obsidian-finalize');
          const projectFolder = await seedFolder(spaceId, 'Project');
          const archiveFolder = await seedFolder(spaceId, 'Archive');
          const knowledgeKey = `obsidian-page-${suffix}`;
          const finalize = async (label, changes) => {
            const staged = await stagePush(spaceId, label, changes);
            return pushes.finalize(
              devicePrincipal, spaceId, staged.sessionId, staged.hash,
            );
          };

          const createdResult = await finalize('obsidian-create', [{
            operation: 'upsert', pageId: knowledgeKey,
            path: 'pages/Project/Obsidian.md', title: 'Obsidian', body: '# Obsidian',
          }]);
          let persisted = await prisma.page.findUniqueOrThrow({ where: { knowledgeKey } });
          assert.equal(persisted.parentId, null);
          assert.equal(persisted.folderId, projectFolder.id);
          assert.equal(persisted.syncPath, 'pages/Project/Obsidian.md');
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);
          assert.equal((await prisma.spaceKnowledgeRevision.findUniqueOrThrow({
            where: { id: createdResult.revision },
          })).origin, 'obsidian_sync');

          await finalize('obsidian-move', [{
            operation: 'upsert', pageId: knowledgeKey,
            path: 'pages/Archive/Obsidian renamed.md',
            title: 'Obsidian renamed', body: '# Obsidian renamed',
          }]);
          persisted = await prisma.page.findUniqueOrThrow({ where: { knowledgeKey } });
          assert.equal(persisted.parentId, null);
          assert.equal(persisted.folderId, archiveFolder.id);
          assert.equal(persisted.syncPath, 'pages/Archive/Obsidian renamed.md');
          assert.equal((await prisma.pagePathAlias.findFirstOrThrow({
            where: { pageId: persisted.id, pathKey: pathKey('pages/Project/Obsidian.md') },
          })).path, 'pages/Project/Obsidian.md');
          assert.equal((await prisma.pageVersion.findFirstOrThrow({
            where: { pageId: persisted.id }, orderBy: { createdAt: 'desc' },
          })).folderId, projectFolder.id);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 2n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 2);

          await finalize('obsidian-archive', [{
            operation: 'archive', pageId: knowledgeKey,
            previousPath: 'pages/Archive/Obsidian renamed.md',
          }]);
          persisted = await prisma.page.findUniqueOrThrow({ where: { knowledgeKey } });
          assert.ok(persisted.deletedAt);
          assert.equal(persisted.folderId, archiveFolder.id);
          assert.equal((await prisma.pageVersion.findFirstOrThrow({
            where: { pageId: persisted.id }, orderBy: { createdAt: 'desc' },
          })).folderId, archiveFolder.id);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 3n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 3);

          const restoredResult = await finalize('obsidian-restore', [{
            operation: 'upsert', pageId: knowledgeKey,
            path: 'pages/Archive/Obsidian renamed.md',
            title: 'Obsidian renamed', body: '# Restored',
          }]);
          persisted = await prisma.page.findUniqueOrThrow({ where: { knowledgeKey } });
          assert.equal(persisted.deletedAt, null);
          assert.equal(persisted.parentId, null);
          assert.equal(persisted.folderId, archiveFolder.id);
          assert.equal(persisted.syncPath, 'pages/Archive/Obsidian renamed.md');
          const versions = await prisma.pageVersion.findMany({ where: { pageId: persisted.id } });
          assert.ok(versions.length >= 3);
          assert.ok(versions.every((version) => version.folderId !== null));
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 4n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 4);
          assert.equal((await prisma.syncRevisionPageRow.findFirstOrThrow({
            where: { revisionId: restoredResult.revision, pageId: knowledgeKey },
          })).folderId, archiveFolder.id);

          const stablePageCount = await prisma.page.count({ where: { spaceId } });
          const stableVersionCount = await prisma.pageVersion.count({ where: { pageId: persisted.id } });
          const stableAliasCount = await prisma.pagePathAlias.count({ where: { pageId: persisted.id } });
          const rejected = await stagePush(spaceId, 'obsidian-reject', [{
            operation: 'upsert', pageId: `obsidian-rejected-${suffix}`,
            path: 'pages/Missing/Rejected.md', title: 'Rejected', body: '# Rejected',
          }]);
          await expectCode(
            pushes.finalize(devicePrincipal, spaceId, rejected.sessionId, rejected.hash),
            'PAYLOAD_INVALID',
          );
          assert.equal((await prisma.pushSession.findUniqueOrThrow({
            where: { id: rejected.sessionId },
          })).status, 'ready_to_finalize');
          assert.equal(await prisma.page.count({ where: { spaceId } }), stablePageCount);
          assert.equal(await prisma.pageVersion.count({ where: { pageId: persisted.id } }), stableVersionCount);
          assert.equal(await prisma.pagePathAlias.count({ where: { pageId: persisted.id } }), stableAliasCount);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 4n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 4);
        });

        await t.test('real Obsidian ChangeSets revert create, update, and archive with complete Page snapshots', async () => {
          const finalize = async (spaceId, label, changes) => {
            const staged = await stagePush(spaceId, label, changes);
            return pushes.finalize(
              devicePrincipal, spaceId, staged.sessionId, staged.hash,
            );
          };
          const revisionState = async (spaceId) => ({
            tree: (await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision,
            sync: await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }),
          });

          const createSpaceId = await createSpace('obsidian-revert-create');
          const createFolder = await seedFolder(createSpaceId, 'Created');
          const createKnowledgeKey = `obsidian-revert-created-${suffix}`;
          const createdResult = await finalize(createSpaceId, 'obsidian-revert-create', [{
            operation: 'upsert',
            pageId: createKnowledgeKey,
            path: 'pages/Created/Created by Obsidian.md',
            title: 'Created by Obsidian',
            body: '# Created by Obsidian',
          }]);
          assert.ok(createdResult.changeSetId);
          let createdPage = await prisma.page.findUniqueOrThrow({
            where: { knowledgeKey: createKnowledgeKey },
          });
          assert.equal(createdPage.folderId, createFolder.id);
          assert.equal(createdPage.syncPath, 'pages/Created/Created by Obsidian.md');
          assert.equal(createdPage.content, '# Created by Obsidian');
          assert.equal(createdPage.sourceChangeSetId, createdResult.changeSetId);
          assert.equal(createdPage.lastChangeSetId, createdResult.changeSetId);
          assert.deepEqual(await revisionState(createSpaceId), { tree: 1n, sync: 1 });

          await reviews.revert(createdResult.changeSetId, '1');
          createdPage = await prisma.page.findUniqueOrThrow({ where: { id: createdPage.id } });
          assert.ok(createdPage.deletedAt);
          assert.equal(createdPage.folderId, createFolder.id);
          assert.equal(createdPage.syncPath, 'pages/Created/Created by Obsidian.md');
          assert.equal(createdPage.sourceChangeSetId, createdResult.changeSetId);
          assert.equal(createdPage.lastChangeSetId, createdResult.changeSetId);
          const createdRevertVersion = await prisma.pageVersion.findFirstOrThrow({
            where: { pageId: createdPage.id }, orderBy: { createdAt: 'desc' },
          });
          assert.equal(createdRevertVersion.folderId, createFolder.id);
          assert.equal(createdRevertVersion.syncPath, 'pages/Created/Created by Obsidian.md');
          assert.equal(createdRevertVersion.content, '# Created by Obsidian');
          assert.equal(createdRevertVersion.slug, createdPage.slug);
          assert.equal(await prisma.pagePathAlias.count({ where: { pageId: createdPage.id } }), 0);
          assert.deepEqual(await revisionState(createSpaceId), { tree: 2n, sync: 2 });
          assert.equal((await prisma.changeSet.findUniqueOrThrow({
            where: { id: createdResult.changeSetId },
          })).status, 'reverted');

          const updateSpaceId = await createSpace('obsidian-revert-update');
          const updateOldFolder = await seedFolder(updateSpaceId, 'Old');
          const updateNewFolder = await seedFolder(updateSpaceId, 'New');
          const updateCreated = await pages.create({
            title: 'Original title', content: '# Original body', spaceId: updateSpaceId,
            folderId: updateOldFolder.id, expectedTreeRevision: '0',
          }, principal);
          const updateBefore = await prisma.page.findUniqueOrThrow({
            where: { id: updateCreated.id },
          });
          const updateResult = await finalize(updateSpaceId, 'obsidian-revert-update', [{
            operation: 'upsert',
            pageId: updateBefore.knowledgeKey,
            path: 'pages/New/Renamed by Obsidian.md',
            title: 'Renamed by Obsidian',
            body: '# Updated body',
          }]);
          let updatedPage = await prisma.page.findUniqueOrThrow({ where: { id: updateBefore.id } });
          assert.equal(updatedPage.folderId, updateNewFolder.id);
          assert.equal(updatedPage.syncPath, 'pages/New/Renamed by Obsidian.md');
          assert.equal(updatedPage.content, '# Updated body');
          assert.equal(updatedPage.sourceChangeSetId, updateBefore.sourceChangeSetId);
          assert.equal(updatedPage.lastChangeSetId, updateResult.changeSetId);
          const updateSnapshot = await prisma.pageVersion.findFirstOrThrow({
            where: { pageId: updateBefore.id }, orderBy: { createdAt: 'desc' },
          });
          assert.equal(updateSnapshot.slug, updateBefore.slug);
          assert.equal(updateSnapshot.folderId, updateOldFolder.id);
          assert.equal(updateSnapshot.syncPath, updateBefore.syncPath);
          assert.deepEqual(await revisionState(updateSpaceId), { tree: 2n, sync: 2 });

          const stalePageState = {
            title: updatedPage.title,
            content: updatedPage.content,
            folderId: updatedPage.folderId,
            syncPath: updatedPage.syncPath,
            sourceChangeSetId: updatedPage.sourceChangeSetId,
            lastChangeSetId: updatedPage.lastChangeSetId,
          };
          const staleAliases = await prisma.pagePathAlias.findMany({
            where: { pageId: updatedPage.id }, orderBy: { path: 'asc' },
          });
          const staleVersions = await prisma.pageVersion.count({ where: { pageId: updatedPage.id } });
          await expectCode(reviews.revert(updateResult.changeSetId, '1'), 'CONTENT_TREE_CONFLICT');
          updatedPage = await prisma.page.findUniqueOrThrow({ where: { id: updatedPage.id } });
          assert.deepEqual({
            title: updatedPage.title,
            content: updatedPage.content,
            folderId: updatedPage.folderId,
            syncPath: updatedPage.syncPath,
            sourceChangeSetId: updatedPage.sourceChangeSetId,
            lastChangeSetId: updatedPage.lastChangeSetId,
          }, stalePageState);
          assert.deepEqual(await prisma.pagePathAlias.findMany({
            where: { pageId: updatedPage.id }, orderBy: { path: 'asc' },
          }), staleAliases);
          assert.equal(await prisma.pageVersion.count({ where: { pageId: updatedPage.id } }), staleVersions);
          assert.deepEqual(await revisionState(updateSpaceId), { tree: 2n, sync: 2 });
          assert.equal((await prisma.changeSet.findUniqueOrThrow({
            where: { id: updateResult.changeSetId },
          })).status, 'published');

          await reviews.revert(updateResult.changeSetId, '2');
          updatedPage = await prisma.page.findUniqueOrThrow({ where: { id: updatedPage.id } });
          assert.equal(updatedPage.title, updateBefore.title);
          assert.equal(updatedPage.slug, updateBefore.slug);
          assert.equal(updatedPage.content, updateBefore.content);
          assert.equal(updatedPage.format, updateBefore.format);
          assert.equal(updatedPage.folderId, updateOldFolder.id);
          assert.equal(updatedPage.parentId, null);
          assert.equal(updatedPage.syncPath, updateBefore.syncPath);
          assert.equal(updatedPage.deletedAt, null);
          assert.equal(updatedPage.sourceChangeSetId, updateBefore.sourceChangeSetId);
          assert.equal(updatedPage.lastChangeSetId, updateBefore.lastChangeSetId);
          const updateAliases = (await prisma.pagePathAlias.findMany({
            where: { pageId: updatedPage.id }, orderBy: { path: 'asc' },
          })).map((alias) => alias.path);
          assert.deepEqual(updateAliases, [
            'pages/New/Renamed by Obsidian.md',
            'pages/Old/Original title.md',
          ]);
          assert.deepEqual(await revisionState(updateSpaceId), { tree: 3n, sync: 3 });

          const archiveSpaceId = await createSpace('obsidian-revert-archive');
          const archiveFolder = await seedFolder(archiveSpaceId, 'Archive');
          const archiveCreated = await pages.create({
            title: 'Archive original', content: '# Archive original', spaceId: archiveSpaceId,
            folderId: archiveFolder.id, expectedTreeRevision: '0',
          }, principal);
          const archiveBefore = await prisma.page.findUniqueOrThrow({
            where: { id: archiveCreated.id },
          });
          const archiveResult = await finalize(archiveSpaceId, 'obsidian-revert-archive', [{
            operation: 'archive',
            pageId: archiveBefore.knowledgeKey,
            previousPath: archiveBefore.syncPath,
          }]);
          let archivedPage = await prisma.page.findUniqueOrThrow({ where: { id: archiveBefore.id } });
          assert.ok(archivedPage.deletedAt);
          assert.equal(archivedPage.folderId, archiveFolder.id);
          assert.equal(archivedPage.sourceChangeSetId, archiveBefore.sourceChangeSetId);
          assert.equal(archivedPage.lastChangeSetId, archiveResult.changeSetId);
          assert.deepEqual(await revisionState(archiveSpaceId), { tree: 2n, sync: 2 });

          await reviews.revert(archiveResult.changeSetId, '2');
          archivedPage = await prisma.page.findUniqueOrThrow({ where: { id: archivedPage.id } });
          assert.equal(archivedPage.deletedAt, null);
          assert.equal(archivedPage.title, archiveBefore.title);
          assert.equal(archivedPage.content, archiveBefore.content);
          assert.equal(archivedPage.folderId, archiveFolder.id);
          assert.equal(archivedPage.syncPath, archiveBefore.syncPath);
          assert.equal(archivedPage.sourceChangeSetId, archiveBefore.sourceChangeSetId);
          assert.equal(archivedPage.lastChangeSetId, archiveBefore.lastChangeSetId);
          assert.equal(await prisma.pagePathAlias.count({ where: { pageId: archivedPage.id } }), 0);
          assert.deepEqual(await revisionState(archiveSpaceId), { tree: 3n, sync: 3 });

          const restoredSpaceId = await createSpace('obsidian-revert-restored-archive');
          const restoredOldFolder = await seedFolder(restoredSpaceId, 'Original');
          const restoredNewFolder = await seedFolder(restoredSpaceId, 'Restored');
          const restoredCreated = await pages.create({
            title: 'Archived before restore', content: '# Archived before restore', spaceId: restoredSpaceId,
            folderId: restoredOldFolder.id, expectedTreeRevision: '0',
          }, principal);
          const restoredArchiveResult = await finalize(restoredSpaceId, 'obsidian-restored-archive', [{
            operation: 'archive',
            pageId: restoredCreated.knowledgeKey,
            previousPath: restoredCreated.syncPath,
          }]);
          const restoredBefore = await prisma.page.findUniqueOrThrow({ where: { id: restoredCreated.id } });
          assert.ok(restoredBefore.deletedAt);
          assert.equal(restoredBefore.lastChangeSetId, restoredArchiveResult.changeSetId);
          const restoredResult = await finalize(restoredSpaceId, 'obsidian-restored-upsert', [{
            operation: 'upsert',
            pageId: restoredCreated.knowledgeKey,
            path: 'pages/Restored/Active after restore.md',
            title: 'Active after restore',
            body: '# Active after restore',
          }]);
          let restoredPage = await prisma.page.findUniqueOrThrow({ where: { id: restoredCreated.id } });
          assert.equal(restoredPage.deletedAt, null);
          assert.equal(restoredPage.folderId, restoredNewFolder.id);
          assert.equal(restoredPage.syncPath, 'pages/Restored/Active after restore.md');
          assert.equal(restoredPage.sourceChangeSetId, restoredBefore.sourceChangeSetId);
          assert.equal(restoredPage.lastChangeSetId, restoredResult.changeSetId);
          const restoredChangeSet = await prisma.changeSet.findUniqueOrThrow({
            where: { id: restoredResult.changeSetId }, include: { items: true },
          });
          assert.equal(restoredChangeSet.items.length, 1);
          assert.equal(restoredChangeSet.items[0].type, 'update_page');
          assert.equal(restoredChangeSet.items[0].payload.before.restoredFromArchive, true);
          assert.equal(restoredChangeSet.items[0].payload.before.slug, restoredBefore.slug);
          assert.equal(restoredChangeSet.items[0].payload.before.folderId, restoredOldFolder.id);
          assert.equal(restoredChangeSet.items[0].payload.before.syncPath, restoredBefore.syncPath);
          assert.equal(restoredChangeSet.items[0].payload.before.deletedAt, restoredBefore.deletedAt.toISOString());
          assert.equal(restoredChangeSet.items[0].payload.before.sourceChangeSetId, restoredBefore.sourceChangeSetId);
          assert.equal(restoredChangeSet.items[0].payload.before.lastChangeSetId, restoredBefore.lastChangeSetId);
          assert.deepEqual(await revisionState(restoredSpaceId), { tree: 3n, sync: 3 });

          const restoredStaleState = restoredPage;
          const restoredStaleVersions = await prisma.pageVersion.count({ where: { pageId: restoredPage.id } });
          const restoredStaleAliases = await prisma.pagePathAlias.findMany({
            where: { pageId: restoredPage.id }, orderBy: { path: 'asc' },
          });
          await expectCode(reviews.revert(restoredResult.changeSetId, '2'), 'CONTENT_TREE_CONFLICT');
          assert.deepEqual(await prisma.page.findUniqueOrThrow({ where: { id: restoredPage.id } }), restoredStaleState);
          assert.equal(await prisma.pageVersion.count({ where: { pageId: restoredPage.id } }), restoredStaleVersions);
          assert.deepEqual(await prisma.pagePathAlias.findMany({
            where: { pageId: restoredPage.id }, orderBy: { path: 'asc' },
          }), restoredStaleAliases);
          assert.equal((await prisma.changeSet.findUniqueOrThrow({
            where: { id: restoredResult.changeSetId },
          })).status, 'published');

          await reviews.revert(restoredResult.changeSetId, '3');
          restoredPage = await prisma.page.findUniqueOrThrow({ where: { id: restoredPage.id } });
          assert.equal(restoredPage.title, restoredBefore.title);
          assert.equal(restoredPage.slug, restoredBefore.slug);
          assert.equal(restoredPage.content, restoredBefore.content);
          assert.equal(restoredPage.folderId, restoredOldFolder.id);
          assert.equal(restoredPage.parentId, null);
          assert.equal(restoredPage.syncPath, restoredBefore.syncPath);
          assert.equal(restoredPage.deletedAt?.toISOString(), restoredBefore.deletedAt.toISOString());
          assert.equal(restoredPage.deletionBatchId, restoredBefore.deletionBatchId);
          assert.equal(restoredPage.sourceChangeSetId, restoredBefore.sourceChangeSetId);
          assert.equal(restoredPage.lastChangeSetId, restoredBefore.lastChangeSetId);
          assert.equal((await prisma.pagePathAlias.findFirstOrThrow({
            where: { pageId: restoredPage.id, pathKey: pathKey('pages/Restored/Active after restore.md') },
          })).path, 'pages/Restored/Active after restore.md');
          assert.equal(await prisma.pagePathAlias.count({
            where: { pageId: restoredPage.id, pathKey: pathKey(restoredBefore.syncPath) },
          }), 1);
          const restoredRevertVersion = await prisma.pageVersion.findFirstOrThrow({
            where: { pageId: restoredPage.id }, orderBy: { createdAt: 'desc' },
          });
          assert.equal(restoredRevertVersion.folderId, restoredNewFolder.id);
          assert.equal(restoredRevertVersion.syncPath, 'pages/Restored/Active after restore.md');
          assert.deepEqual(await revisionState(restoredSpaceId), { tree: 4n, sync: 4 });

          const collisionSpaceId = await createSpace('obsidian-revert-collision');
          const collisionOldFolder = await seedFolder(collisionSpaceId, 'Old');
          const collisionNewFolder = await seedFolder(collisionSpaceId, 'New');
          const collisionCreated = await pages.create({
            title: 'Collision original', content: '# Original', spaceId: collisionSpaceId,
            folderId: collisionOldFolder.id, expectedTreeRevision: '0',
          }, principal);
          const collisionBefore = await prisma.page.findUniqueOrThrow({
            where: { id: collisionCreated.id },
          });
          await finalize(collisionSpaceId, 'obsidian-revert-collision-archive', [{
            operation: 'archive',
            pageId: collisionBefore.knowledgeKey,
            previousPath: collisionBefore.syncPath,
          }]);
          const collisionResult = await finalize(collisionSpaceId, 'obsidian-revert-collision-restore', [{
            operation: 'upsert',
            pageId: collisionBefore.knowledgeKey,
            path: 'pages/New/Collision moved.md',
            title: 'Collision moved',
            body: '# Moved',
          }]);
          await pages.create({
            title: 'Collision original', content: '# Blocker', spaceId: collisionSpaceId,
            folderId: collisionOldFolder.id, expectedTreeRevision: '3',
          }, principal);
          const collisionPage = await prisma.page.findUniqueOrThrow({
            where: { id: collisionBefore.id },
          });
          const collisionVersions = await prisma.pageVersion.count({
            where: { pageId: collisionBefore.id },
          });
          const collisionAliases = await prisma.pagePathAlias.findMany({
            where: { pageId: collisionBefore.id }, orderBy: { path: 'asc' },
          });
          await expectCode(reviews.revert(collisionResult.changeSetId, '4'), 'CONTENT_TREE_CONFLICT');
          assert.deepEqual(await prisma.page.findUniqueOrThrow({
            where: { id: collisionBefore.id },
          }), collisionPage);
          assert.equal(await prisma.pageVersion.count({ where: { pageId: collisionBefore.id } }), collisionVersions);
          assert.deepEqual(await prisma.pagePathAlias.findMany({
            where: { pageId: collisionBefore.id }, orderBy: { path: 'asc' },
          }), collisionAliases);
          assert.equal((await prisma.changeSet.findUniqueOrThrow({
            where: { id: collisionResult.changeSetId },
          })).status, 'published');
          assert.deepEqual(await revisionState(collisionSpaceId), { tree: 4n, sync: 4 });
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

        await t.test('real KnowledgeSubmission producer captures tree CAS and publishes through Review', async () => {
          const spaceId = await createSpace('knowledge-producer');
          const bundle = {
            schemaVersion: 'knowledge-bundle@1',
            recipeVersion: 'folder-test',
            spaceId,
            baseRevision: '0',
            pages: [{
              pageId: `knowledge-produced-${suffix}`,
              spaceId,
              path: '/knowledge-produced.md',
              title: 'Knowledge produced',
              body: '# Knowledge produced',
              artifactIds: ['artifact-knowledge'],
              contentHash: 'knowledge-content-hash',
              updatedAt: new Date().toISOString(),
            }],
            memories: [],
            relations: [],
            provenance: [],
            deletions: [],
          };
          const submission = await knowledgeSubmissions.submit(
            spaceId,
            principal,
            Buffer.from(JSON.stringify(bundle)),
            `knowledge-producer-${suffix}`,
            true,
          );
          assert.equal(submission.status, 'pending_review');
          assert.ok(submission.changeSetId);
          const produced = await prisma.changeSet.findUniqueOrThrow({
            where: { id: submission.changeSetId }, include: { items: true },
          });
          const structuralItems = produced.items.filter((item) => (
            item.type === 'create_page' || item.type === 'update_page' || item.type === 'archive_page'
          ));
          assert.equal(structuralItems.length, 1);
          assert.ok(structuralItems.every((item) => item.payload.expectedTreeRevision === '0'));

          await reviews.reviewPublish(produced.id, userId);
          const page = await prisma.page.findFirstOrThrow({
            where: { spaceId, knowledgeKey: `knowledge-produced-${suffix}` },
          });
          assert.equal(page.folderId, null);
          assert.equal(page.parentId, null);
          assert.equal(page.content, '# Knowledge produced');
          assert.equal(page.sourceChangeSetId, produced.id);
          assert.equal(page.lastChangeSetId, produced.id);
          assert.equal((await prisma.space.findUniqueOrThrow({
            where: { id: spaceId },
          })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);
          assert.ok((await prisma.knowledgeSubmission.findUniqueOrThrow({
            where: { id: submission.submissionId },
          })).appliedRevisionId);

          const latestRevision = await prisma.spaceKnowledgeRevision.findFirstOrThrow({
            where: { spaceId }, orderBy: { sequence: 'desc' },
          });
          const staleBundle = {
            ...bundle,
            baseRevision: latestRevision.id,
            pages: [{
              ...bundle.pages[0],
              pageId: `knowledge-stale-${suffix}`,
              path: '/knowledge-stale.md',
              title: 'Knowledge stale',
              body: '# Knowledge stale',
              contentHash: 'knowledge-stale-content-hash',
            }],
          };
          const lockGate = holdNextContentTreeLock();
          let staleSubmission;
          try {
            const proposalPromise = knowledgeSubmissions.submit(
              spaceId,
              principal,
              Buffer.from(JSON.stringify(staleBundle)),
              `knowledge-stale-${suffix}`,
              true,
            );
            await lockGate.acquired;
            const concurrentMutation = contentTree.createFolder({
              spaceId,
              parentId: null,
              name: 'Knowledge concurrent',
              expectedTreeRevision: 1n,
              actor: { userId },
            });
            await assertPending(
              concurrentMutation,
              'Knowledge proposal lock must serialize a concurrent structural mutation',
            );
            lockGate.release();
            [staleSubmission] = await Promise.all([proposalPromise, concurrentMutation]);
          } finally {
            lockGate.release();
            lockGate.restore();
          }
          const staleProduced = await prisma.changeSet.findUniqueOrThrow({
            where: { id: staleSubmission.changeSetId }, include: { items: true },
          });
          const staleStructural = staleProduced.items.filter((item) => (
            item.type === 'create_page' || item.type === 'update_page' || item.type === 'archive_page'
          ));
          assert.equal(staleStructural.length, 1);
          assert.equal(staleStructural[0].payload.expectedTreeRevision, '1');
          await expectCode(reviews.reviewPublish(staleProduced.id, userId), 'CONTENT_TREE_CONFLICT');
          assert.equal(await prisma.page.count({ where: { spaceId, title: 'Knowledge stale' } }), 0);
          assert.equal((await prisma.changeSet.findUniqueOrThrow({
            where: { id: staleProduced.id },
          })).status, 'approved');
          assert.ok(staleProduced.items.every((item) => item.status === 'pending'));
          assert.ok((await prisma.changeItem.findMany({
            where: { changeSetId: staleProduced.id },
          })).every((item) => item.status === 'accepted'));
          assert.equal((await prisma.space.findUniqueOrThrow({
            where: { id: spaceId },
          })).contentTreeRevision, 2n);
        });

        await t.test('real Source ingestion producer captures tree CAS and publishes through Review', async () => {
          const spaceId = await createSpace('source-producer');
          const source = await sources.create(spaceId, principal, {
            type: 'text',
            name: 'Source produced',
            content: '# Source produced',
          });
          const run = await sources.createRun(
            source.id,
            principal,
            `source-producer-${suffix}`,
          );
          await prisma.ingestRun.update({
            where: { id: run.id },
            data: {
              status: 'reserved',
              stage: 'reserved',
              leaseOwner: `source-worker-${suffix}`,
              leaseExpiresAt: new Date(Date.now() + 60_000),
            },
          });
          await sources.processRun(run.id, `source-worker-${suffix}`);
          const produced = await prisma.changeSet.findUniqueOrThrow({
            where: { runId: run.id }, include: { items: true },
          });
          const structuralItems = produced.items.filter((item) => (
            item.type === 'create_page' || item.type === 'update_page' || item.type === 'archive_page'
          ));
          assert.equal(structuralItems.length, 1);
          assert.ok(structuralItems.every((item) => item.payload.expectedTreeRevision === '0'));
          assert.equal((await prisma.ingestRun.findUniqueOrThrow({
            where: { id: run.id },
          })).status, 'completed');

          await reviews.reviewPublish(produced.id, userId);
          const page = await prisma.page.findFirstOrThrow({
            where: { spaceId, sourceId: source.id },
          });
          assert.equal(page.folderId, null);
          assert.equal(page.parentId, null);
          assert.equal(page.content, '# Source produced');
          assert.equal(page.sourceChangeSetId, produced.id);
          assert.equal(page.lastChangeSetId, produced.id);
          assert.equal((await prisma.space.findUniqueOrThrow({
            where: { id: spaceId },
          })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);

          const staleSource = await sources.create(spaceId, principal, {
            type: 'text',
            name: 'Source stale',
            content: '# Source stale',
          });
          const staleRun = await sources.createRun(
            staleSource.id,
            principal,
            `source-stale-${suffix}`,
          );
          await prisma.ingestRun.update({
            where: { id: staleRun.id },
            data: {
              status: 'reserved',
              stage: 'reserved',
              leaseOwner: `source-stale-worker-${suffix}`,
              leaseExpiresAt: new Date(Date.now() + 60_000),
            },
          });
          const lockGate = holdNextContentTreeLock();
          try {
            const proposalPromise = sources.processRun(
              staleRun.id,
              `source-stale-worker-${suffix}`,
            );
            await lockGate.acquired;
            const concurrentMutation = contentTree.createFolder({
              spaceId,
              parentId: null,
              name: 'Source concurrent',
              expectedTreeRevision: 1n,
              actor: { userId },
            });
            await assertPending(
              concurrentMutation,
              'Source proposal lock must serialize a concurrent structural mutation',
            );
            lockGate.release();
            await Promise.all([proposalPromise, concurrentMutation]);
          } finally {
            lockGate.release();
            lockGate.restore();
          }
          const staleProduced = await prisma.changeSet.findUniqueOrThrow({
            where: { runId: staleRun.id }, include: { items: true },
          });
          const staleStructural = staleProduced.items.filter((item) => (
            item.type === 'create_page' || item.type === 'update_page' || item.type === 'archive_page'
          ));
          assert.equal(staleStructural.length, 1);
          assert.equal(staleStructural[0].payload.expectedTreeRevision, '1');
          await expectCode(reviews.reviewPublish(staleProduced.id, userId), 'CONTENT_TREE_CONFLICT');
          assert.equal(await prisma.page.count({ where: { spaceId, title: 'Source stale' } }), 0);
          assert.equal((await prisma.changeSet.findUniqueOrThrow({
            where: { id: staleProduced.id },
          })).status, 'approved');
          assert.ok(staleProduced.items.every((item) => item.status === 'pending'));
          assert.ok((await prisma.changeItem.findMany({
            where: { changeSetId: staleProduced.id },
          })).every((item) => item.status === 'accepted'));
          assert.equal((await prisma.space.findUniqueOrThrow({
            where: { id: spaceId },
          })).contentTreeRevision, 2n);
        });

        await t.test('real MCP propose_page persists caller tree CAS, publishes, and rejects an old proposal after a concurrent tree change', async () => {
          const spaceId = await createSpace('mcp-producer');
          const agentId = `mcp-agent-${suffix}`;
          const grantId = `mcp-grant-${suffix}`;
          const credentialId = `mcp-credential-${suffix}`;
          await prisma.agent.create({ data: {
            id: agentId,
            name: 'Folder producer agent',
            ownerId: userId,
            status: 'active',
            approvalMode: 'always-review',
          } });
          await prisma.agentGrant.create({ data: {
            id: grantId,
            agentId,
            spaceId,
            role: 'editor',
          } });
          await prisma.agentCredential.create({ data: {
            id: credentialId,
            name: 'Folder producer credential',
            prefix: `folder_${suffix.slice(0, 8)}`,
            keyHash: `folder-producer-key-${suffix}`,
            agentId,
            authorizationId: grantId,
          } });
          const agentPrincipal = {
            userId,
            platformRole: 'user',
            agentId,
            credentialId,
            authorizationId: grantId,
            authorizationSpaceId: spaceId,
            agentRole: 'editor',
            scopes: scopesForAgentAccessRole('editor'),
          };
          const tools = mcp.createServer(agentPrincipal)._registeredTools;

          await tools.propose_page.handler({
            spaceId,
            title: 'MCP produced',
            content: '# MCP produced',
            expectedTreeRevision: '0',
          });
          const publishedProposal = await prisma.changeSet.findFirstOrThrow({
            where: { spaceId, createdByAgentId: agentId, title: 'Proposed page: MCP produced' },
            include: { items: true },
          });
          assert.equal(publishedProposal.items.length, 1);
          assert.equal(publishedProposal.items[0].payload.expectedTreeRevision, '0');
          await reviews.reviewPublish(publishedProposal.id, userId);
          const publishedPage = await prisma.page.findFirstOrThrow({
            where: { spaceId, title: 'MCP produced' },
          });
          assert.equal(publishedPage.folderId, null);
          assert.equal(publishedPage.parentId, null);
          assert.equal(publishedPage.sourceChangeSetId, publishedProposal.id);
          assert.equal(publishedPage.lastChangeSetId, publishedProposal.id);
          assert.equal((await prisma.space.findUniqueOrThrow({
            where: { id: spaceId },
          })).contentTreeRevision, 1n);

          await tools.propose_page.handler({
            spaceId,
            title: 'MCP stale',
            content: '# MCP stale',
            expectedTreeRevision: '1',
          });
          const staleProposal = await prisma.changeSet.findFirstOrThrow({
            where: { spaceId, createdByAgentId: agentId, title: 'Proposed page: MCP stale' },
            include: { items: true },
          });
          assert.equal(staleProposal.items[0].payload.expectedTreeRevision, '1');
          await contentTree.createFolder({
            spaceId,
            parentId: null,
            name: 'Concurrent folder',
            expectedTreeRevision: 1n,
            actor: { userId },
          });
          await expectCode(
            reviews.reviewPublish(staleProposal.id, userId),
            'CONTENT_TREE_CONFLICT',
          );
          assert.equal(await prisma.page.count({ where: { spaceId, title: 'MCP stale' } }), 0);
          assert.equal((await prisma.changeSet.findUniqueOrThrow({
            where: { id: staleProposal.id },
          })).status, 'approved');
          assert.equal((await prisma.changeItem.findUniqueOrThrow({
            where: { id: staleProposal.items[0].id },
          })).status, 'accepted');
          assert.equal((await prisma.space.findUniqueOrThrow({
            where: { id: spaceId },
          })).contentTreeRevision, 2n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 2);
        });

        await t.test('Review revert commits once and rolls back stale, path-collision, and deleted-Folder targets', async () => {
          const createReviewPage = async (spaceId, folderId, title, expectedTreeRevision) => {
            const changeSet = await prisma.changeSet.create({ data: {
              title: `Create ${title}`,
              status: 'approved',
              spaceId,
              createdByUserId: userId,
              items: { create: {
                type: 'create_page', status: 'accepted',
                payload: {
                  title, content: `# ${title}`, folderId,
                  expectedTreeRevision: String(expectedTreeRevision),
                },
              } },
            } });
            await reviews.publish(changeSet.id);
            return {
              changeSet,
              page: await prisma.page.findFirstOrThrow({ where: { spaceId, title } }),
            };
          };
          const publishReviewMove = async (spaceId, page, folderId, title, expectedTreeRevision) => {
            const changeSet = await prisma.changeSet.create({ data: {
              title: `Move ${page.title}`,
              status: 'approved',
              spaceId,
              createdByUserId: userId,
              items: { create: {
                type: 'update_page', status: 'accepted',
                payload: {
                  pageId: page.id,
                  expectedUpdatedAt: page.updatedAt.toISOString(),
                  expectedTreeRevision: String(expectedTreeRevision),
                  changes: { title, folderId },
                },
              } },
            } });
            await reviews.publish(changeSet.id);
            return {
              changeSet,
              page: await prisma.page.findUniqueOrThrow({ where: { id: page.id } }),
            };
          };

          const successSpaceId = await createSpace('review-revert-success');
          const successFolder = await seedFolder(successSpaceId, 'Reviewed');
          const success = await createReviewPage(successSpaceId, successFolder.id, 'Revert success', 0);
          await reviews.revert(success.changeSet.id, '1');
          const successPage = await prisma.page.findUniqueOrThrow({ where: { id: success.page.id } });
          assert.ok(successPage.deletedAt);
          assert.equal(successPage.parentId, null);
          assert.equal(successPage.folderId, successFolder.id);
          assert.equal((await prisma.changeSet.findUniqueOrThrow({ where: { id: success.changeSet.id } })).status, 'reverted');
          assert.equal((await prisma.pageVersion.findFirstOrThrow({
            where: { pageId: success.page.id }, orderBy: { createdAt: 'desc' },
          })).folderId, successFolder.id);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: successSpaceId } })).contentTreeRevision, 2n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId: successSpaceId } }), 2);

          const stale = await createReviewPage(successSpaceId, successFolder.id, 'Stale revert', 2);
          const staleVersionCount = await prisma.pageVersion.count({ where: { pageId: stale.page.id } });
          await expectCode(reviews.revert(stale.changeSet.id, '2'), 'CONTENT_TREE_CONFLICT');
          assert.equal((await prisma.changeSet.findUniqueOrThrow({ where: { id: stale.changeSet.id } })).status, 'published');
          assert.equal((await prisma.page.findUniqueOrThrow({ where: { id: stale.page.id } })).deletedAt, null);
          assert.equal(await prisma.pageVersion.count({ where: { pageId: stale.page.id } }), staleVersionCount);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: successSpaceId } })).contentTreeRevision, 3n);

          const collisionSpaceId = await createSpace('review-revert-collision');
          const oldFolder = await seedFolder(collisionSpaceId, 'Old');
          const newFolder = await seedFolder(collisionSpaceId, 'New');
          const collisionBase = await pages.create({
            title: 'Collision target', spaceId: collisionSpaceId,
            folderId: oldFolder.id, expectedTreeRevision: '0',
          }, principal);
          const collisionBefore = await prisma.page.findUniqueOrThrow({ where: { id: collisionBase.id } });
          const collisionMove = await publishReviewMove(
            collisionSpaceId, collisionBefore, newFolder.id, 'Moved target', 1,
          );
          await prisma.page.create({ data: {
            id: `collision-blocker-${suffix}`,
            knowledgeKey: `collision-blocker-key-${suffix}`,
            title: 'Collision target',
            slug: `collision-blocker-${suffix}`,
            content: '# blocker',
            format: 'markdown',
            authorId: userId,
            spaceId: collisionSpaceId,
            parentId: null,
            folderId: oldFolder.id,
            syncPath: 'pages/Old/Collision target.md',
            syncPathKey: pathKey('pages/Old/Collision target.md'),
          } });
          const collisionVersionCount = await prisma.pageVersion.count({ where: { pageId: collisionBase.id } });
          const collisionAliasCount = await prisma.pagePathAlias.count({ where: { pageId: collisionBase.id } });
          await expectCode(reviews.revert(collisionMove.changeSet.id, '2'), 'CONTENT_TREE_CONFLICT');
          const collisionAfter = await prisma.page.findUniqueOrThrow({ where: { id: collisionBase.id } });
          assert.equal(collisionAfter.title, 'Moved target');
          assert.equal(collisionAfter.folderId, newFolder.id);
          assert.equal((await prisma.changeSet.findUniqueOrThrow({ where: { id: collisionMove.changeSet.id } })).status, 'published');
          assert.equal(await prisma.pageVersion.count({ where: { pageId: collisionBase.id } }), collisionVersionCount);
          assert.equal(await prisma.pagePathAlias.count({ where: { pageId: collisionBase.id } }), collisionAliasCount);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: collisionSpaceId } })).contentTreeRevision, 2n);

          const deletedTargetSpaceId = await createSpace('review-revert-deleted-target');
          const deletedFolder = await seedFolder(deletedTargetSpaceId, 'Deleted');
          const activeFolder = await seedFolder(deletedTargetSpaceId, 'Active');
          const deletedBase = await pages.create({
            title: 'Deleted target', spaceId: deletedTargetSpaceId,
            folderId: deletedFolder.id, expectedTreeRevision: '0',
          }, principal);
          const deletedBefore = await prisma.page.findUniqueOrThrow({ where: { id: deletedBase.id } });
          const deletedMove = await publishReviewMove(
            deletedTargetSpaceId, deletedBefore, activeFolder.id, 'Still active', 1,
          );
          const impact = await contentTree.deleteImpact({
            spaceId: deletedTargetSpaceId, folderId: deletedFolder.id,
          });
          await contentTree.deleteFolder({
            spaceId: deletedTargetSpaceId,
            folderId: deletedFolder.id,
            expectedTreeRevision: impact.treeRevision,
            expectedUpdatedAt: impact.rootUpdatedAt,
            expectedImpactHash: impact.impactHash,
            actor: { userId },
          });
          const deletedVersionCount = await prisma.pageVersion.count({ where: { pageId: deletedBase.id } });
          const deletedAliasCount = await prisma.pagePathAlias.count({ where: { pageId: deletedBase.id } });
          await expectCode(reviews.revert(deletedMove.changeSet.id, '3'), 'FOLDER_NOT_FOUND');
          const deletedAfter = await prisma.page.findUniqueOrThrow({ where: { id: deletedBase.id } });
          assert.equal(deletedAfter.title, 'Still active');
          assert.equal(deletedAfter.folderId, activeFolder.id);
          assert.equal((await prisma.changeSet.findUniqueOrThrow({ where: { id: deletedMove.changeSet.id } })).status, 'published');
          assert.equal(await prisma.pageVersion.count({ where: { pageId: deletedBase.id } }), deletedVersionCount);
          assert.equal(await prisma.pagePathAlias.count({ where: { pageId: deletedBase.id } }), deletedAliasCount);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: deletedTargetSpaceId } })).contentTreeRevision, 3n);
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
