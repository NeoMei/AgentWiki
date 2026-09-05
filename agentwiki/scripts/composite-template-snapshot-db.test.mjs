import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { withPageTemplateTestDatabase } from './page-template-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { AuthorizationService } = requireFromServer('./dist/core/authorization/authorization.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const { MarkdownResourceService } = requireFromServer('./dist/markdown-resources/markdown-resource.service.js');
const { PageTemplateService } = requireFromServer('./dist/page-templates/page-template.service.js');
const { FolderTemplateSnapshotService } = requireFromServer(
  './dist/page-templates/folder-template-snapshot.service.js',
);

const baseDatabaseUrl = process.env.PAGE_TEMPLATE_TEST_DATABASE_URL;
if (!baseDatabaseUrl) throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL is required');

async function createServices(prisma) {
  const authorization = new AuthorizationService(prisma);
  const revisionWriter = SpaceRevisionWriterService.legacyOnly(prisma);
  const markdownResources = new MarkdownResourceService(prisma, authorization);
  const config = { get: (_key, fallback) => fallback };
  const pageTemplates = new PageTemplateService(prisma, authorization, config, revisionWriter);
  return {
    snapshots: new FolderTemplateSnapshotService(
      prisma, authorization, revisionWriter, markdownResources, pageTemplates,
    ),
    pageTemplates,
  };
}

function selection(overrides = {}) {
  return {
    excludedFolderIds: [], excludedPageIds: [], locale: 'zh-CN',
    source: { kind: 'structure_only' }, ...overrides,
  };
}

function saveInput(rootFolderId, snapshotSelection, sourceToken, overrides = {}) {
  return {
    rootFolderId,
    selection: snapshotSelection,
    sourceToken,
    acknowledgedWarnings: [],
    name: '  目录   快照  ',
    description: '数据库快照',
    defaultTitle: '目录快照',
    category: 'knowledge',
    locale: 'zh-CN',
    ...overrides,
  };
}

test('folder snapshot detects body-only changes, prunes full subtrees, and persists immutable localized templates', {
  timeout: 120_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = `${schemaName.slice(-8)}_${randomUUID().slice(0, 8)}`;
    const id = (prefix) => `${prefix}_${suffix}`;
    const userId = id('snapshot_user');
    const spaceId = id('snapshot_space');
    const rootId = id('root');
    const keptFolderId = id('kept_folder');
    const excludedFolderId = id('excluded_folder');
    const excludedChildId = id('excluded_child');
    const rootPageId = id('root_page');
    const keptPageId = id('kept_page');
    const excludedPageId = id('excluded_page');
    const excludedGrandchildPageId = id('excluded_grandchild_page');
    const principal = { userId, platformRole: 'user' };
    try {
      await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, type: 'human' } });
      await prisma.space.create({ data: { id: spaceId, name: 'Snapshot DB fixture', slug: spaceId } });
      await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
      await prisma.folder.createMany({ data: [
        { id: rootId, spaceId, parentId: null, name: '根目录', nameKey: 'root', path: 'pages/根目录', pathKey: 'pages/root', sortOrder: 0 },
        { id: keptFolderId, spaceId, parentId: rootId, name: '保留', nameKey: 'keep', path: 'pages/根目录/保留', pathKey: 'pages/root/keep', sortOrder: 0 },
        { id: excludedFolderId, spaceId, parentId: rootId, name: '排除', nameKey: 'excluded', path: 'pages/根目录/排除', pathKey: 'pages/root/excluded', sortOrder: 1 },
        { id: excludedChildId, spaceId, parentId: excludedFolderId, name: '排除子目录', nameKey: 'excluded-child', path: 'pages/根目录/排除/排除子目录', pathKey: 'pages/root/excluded/excluded-child', sortOrder: 0 },
      ] });
      await prisma.page.createMany({ data: [
        { id: rootPageId, title: '根页', slug: id('root-page'), content: '# 根页\n当前正文', format: 'markdown', spaceId, authorId: userId, folderId: rootId, syncPath: 'pages/根目录/根页.md', syncPathKey: 'pages/root/root-page.md', sortOrder: 0 },
        { id: keptPageId, title: '保留页', slug: id('kept-page'), content: '# 保留', format: 'markdown', spaceId, authorId: userId, folderId: keptFolderId, syncPath: 'pages/根目录/保留/保留页.md', syncPathKey: 'pages/root/keep/kept.md', sortOrder: 0 },
        { id: excludedPageId, title: '排除页', slug: id('excluded-page'), content: '# 排除', format: 'markdown', spaceId, authorId: userId, folderId: excludedFolderId, syncPath: 'pages/根目录/排除/排除页.md', syncPathKey: 'pages/root/excluded/page.md', sortOrder: 0 },
        { id: excludedGrandchildPageId, title: '排除孙页', slug: id('excluded-grandchild-page'), content: '# 排除孙页', format: 'markdown', spaceId, authorId: userId, folderId: excludedChildId, syncPath: 'pages/根目录/排除/排除子目录/排除孙页.md', syncPathKey: 'pages/root/excluded/child/page.md', sortOrder: 0 },
      ] });
      await prisma.pageVersion.create({ data: {
        id: id('old_before_image'), pageId: rootPageId, title: '根页', content: '# 旧正文',
        authorId: userId, slug: id('root-page'), format: 'markdown', folderId: rootId,
        syncPath: 'pages/根目录/根页.md', syncPathKey: 'pages/root/root-page.md',
      } });

      const { snapshots: service, pageTemplates } = await createServices(prisma);
      const baseSelection = selection();
      const preview = await service.preview(spaceId, rootId, baseSelection, principal);
      assert.equal(preview.sourceToken.treeRevision, '0');
      assert.equal(preview.sourceToken.pages.find((item) => item.pageId === rootPageId).matchingPageVersionId, null);
      assert.equal(preview.definition.nodes.find((node) => node.kind === 'page' && node.titleI18n['zh-CN'] === '根页').contentI18n['zh-CN'], '# 根页\n当前正文');

      await prisma.page.update({ where: { id: rootPageId }, data: { content: '# 根页\n正文-only改变' } });
      assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 0n);
      await assert.rejects(
        service.save(spaceId, saveInput(rootId, baseSelection, preview.sourceToken), principal),
        (error) => error.businessCode === 'SOURCE_CHANGED',
      );

      const prunedSelection = selection({ excludedFolderIds: [excludedFolderId] });
      const pruned = await service.preview(spaceId, rootId, prunedSelection, principal);
      const serialized = JSON.stringify(pruned.definition);
      assert.doesNotMatch(serialized, /排除页|排除孙页|排除子目录/u);
      assert.ok(pruned.definition.nodes.every((node) => node.parentNodeId === null
        || pruned.definition.nodes.some((parent) => parent.nodeId === node.parentNodeId)));

      const created = await service.save(
        spaceId, saveInput(rootId, prunedSelection, pruned.sourceToken), principal,
      );
      assert.equal(created.name, '目录 快照');
      assert.equal(created.sourceLocale, 'zh-CN');
      assert.equal(created.currentVersion, 1);
      assert.equal(created.definition.nodes.find((node) => node.kind === 'page'
        && node.titleI18n['zh-CN'] === '根页').contentI18n['zh-CN'], '# 根页\n正文-only改变');
      const storedVersion = await prisma.pageTemplateVersion.findFirstOrThrow({
        where: { templateId: created.id, version: 1 },
      });
      await assert.rejects(
        prisma.pageTemplateVersion.update({
          where: { id: storedVersion.id }, data: { definitionHash: 'f'.repeat(64) },
        }),
        /immutable|constraint/iu,
      );
      const archived = await pageTemplates.archive(
        spaceId, created.id, { expectedUpdatedAt: String(created.updatedAt) }, principal,
      );
      assert.ok(archived.archivedAt);
      const restored = await pageTemplates.restore(
        spaceId, created.id, { expectedUpdatedAt: String(archived.updatedAt) }, principal,
      );
      assert.equal(restored.archivedAt, null);
      assert.equal(restored.currentVersion, 1);
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('folder snapshot creation reuses active-template quota and archived templates do not consume it', {
  timeout: 120_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = `${schemaName.slice(-8)}_${randomUUID().slice(0, 8)}`;
    const id = (prefix) => `${prefix}_${suffix}`;
    const userId = id('quota_user');
    const spaceId = id('quota_space');
    const rootId = id('quota_root');
    const pageId = id('quota_page');
    const principal = { userId, platformRole: 'user' };
    try {
      await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, type: 'human' } });
      await prisma.space.create({ data: { id: spaceId, name: 'Snapshot quota fixture', slug: spaceId } });
      await prisma.spaceMember.create({ data: { userId, spaceId, role: 'admin' } });
      await prisma.folder.create({ data: {
        id: rootId, spaceId, name: 'Root', nameKey: 'root', path: 'pages/Root', pathKey: 'pages/root',
      } });
      await prisma.page.create({ data: {
        id: pageId, title: 'Page', slug: id('page'), content: '# Page', format: 'markdown',
        spaceId, authorId: userId, folderId: rootId, syncPath: 'pages/Root/Page.md', syncPathKey: 'pages/root/page.md',
      } });
      await prisma.pageTemplate.createMany({ data: Array.from({ length: 101 }, (_, index) => ({
        id: id(`quota_template_${index}`), scope: 'space', scopeKey: spaceId, spaceId,
        stableKey: `quota-${index}`, category: 'knowledge', nameI18n: { en: `Quota ${index}` },
        nameKey: `quota ${index}`, descriptionI18n: { en: '' }, defaultTitleI18n: { en: 'Quota' },
        sourceLocale: 'en', archivedAt: index === 100 ? new Date('2026-09-05T00:00:00.000Z') : null,
      })) });

      const { snapshots: service } = await createServices(prisma);
      const snapshotSelection = selection({ locale: 'en' });
      const preview = await service.preview(spaceId, rootId, snapshotSelection, principal);
      await assert.rejects(
        service.save(spaceId, saveInput(rootId, snapshotSelection, preview.sourceToken, {
          name: 'Quota overflow', defaultTitle: 'Quota', locale: 'en',
        }), principal),
        (error) => error.businessCode === 'PAGE_TEMPLATE_QUOTA_EXCEEDED',
      );
      await prisma.pageTemplate.update({
        where: { id: id('quota_template_0') }, data: { archivedAt: new Date('2026-09-05T01:00:00.000Z') },
      });
      const created = await service.save(spaceId, saveInput(rootId, snapshotSelection, preview.sourceToken, {
        name: 'Quota available', defaultTitle: 'Quota', locale: 'en',
      }), principal);
      assert.equal(created.currentVersion, 1);
      assert.equal(created.sourceLocale, 'en');
    } finally {
      await prisma.$disconnect();
    }
  });
});
