import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { withPageTemplateTestDatabase } from './page-template-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { queryCurrentTemplateCatalog } = requireFromServer(
  './dist/page-templates/current-template-catalog-query.js',
);
const baseDatabaseUrl = process.env.PAGE_TEMPLATE_TEST_DATABASE_URL;

if (!baseDatabaseUrl) {
  throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL is required');
}

const compositeDefinition = {
  schemaVersion: 1,
  kind: 'page_group',
  nodes: [
    { nodeId: 'root', parentNodeId: null, kind: 'folder', order: 0, nameI18n: { en: 'Root' } },
    {
      nodeId: 'page', parentNodeId: 'root', kind: 'page', order: 0,
      titleI18n: { en: 'Page' }, contentI18n: { en: '' }, roleSlotKey: null,
    },
  ],
  collaboration: null,
};

test('catalog query filters exact current versions and literal search before bounded PostgreSQL paging', {
  timeout: 120_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = schemaName.replace('page_template_test_', '');
    const spaceId = `catalog_space_${suffix}`;
    const id = (prefix) => `${prefix}_${suffix}`;
    const literalName = String.raw`Literal 100%_done\path`;
    const archivedAt = new Date('2026-01-02T00:00:00.000Z');
    try {
      await prisma.space.create({
        data: { id: spaceId, name: 'Composite catalog query', slug: spaceId },
      });

      const archivedLegacy = Array.from({ length: 121 }, (_, index) => {
        const isLiteralMatch = index === 0;
        const name = isLiteralMatch ? literalName : `Archived ${String(index).padStart(3, '0')}`;
        return {
          id: id(`legacy_${index}`),
          scope: 'space',
          scopeKey: spaceId,
          spaceId,
          stableKey: `legacy-${index}`,
          category: 'knowledge',
          nameI18n: { 'zh-CN': name },
          nameKey: name.toLocaleLowerCase('en-US'),
          descriptionI18n: { 'zh-CN': '' },
          defaultTitleI18n: { 'zh-CN': name },
          sourceLocale: 'zh-CN',
          currentVersion: 1,
          archivedAt,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        };
      });
      const systemTemplate = {
        id: id('system'),
        scope: 'system',
        scopeKey: 'system',
        spaceId: null,
        stableKey: `system-${suffix}`,
        category: 'reporting',
        displayOrder: 1,
        nameI18n: { en: 'System 100%_English', 'zh-CN': '系统 100%_中文' },
        nameKey: null,
        descriptionI18n: { en: '', 'zh-CN': '' },
        defaultTitleI18n: { en: 'System', 'zh-CN': '系统' },
        sourceLocale: null,
        currentVersion: 1,
        archivedAt: null,
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      };
      const compositeTemplates = [
        {
          id: id('composite'), stableKey: 'composite', nameKey: 'composite', currentVersion: 1,
        },
        {
          id: id('switched'), stableKey: 'switched', nameKey: 'switched', currentVersion: 2,
        },
      ].map((template) => ({
        ...template,
        scope: 'space',
        scopeKey: spaceId,
        spaceId,
        category: 'planning',
        nameI18n: { en: template.stableKey },
        descriptionI18n: { en: '' },
        defaultTitleI18n: { en: template.stableKey },
        sourceLocale: 'en',
        archivedAt,
        updatedAt: new Date('2026-01-04T00:00:00.000Z'),
      }));

      await prisma.pageTemplate.createMany({
        data: [...archivedLegacy, systemTemplate, ...compositeTemplates],
      });
      const bulkyLegacyContent = { 'zh-CN': 'x'.repeat(4096) };
      await prisma.pageTemplateVersion.createMany({
        data: [
          ...archivedLegacy.map((template, index) => ({
            id: id(`legacy_version_${index}`),
            templateId: template.id,
            version: 1,
            contentI18n: bulkyLegacyContent,
            contentHash: 'a'.repeat(64),
          })),
          {
            id: id('system_version'), templateId: systemTemplate.id, version: 1,
            contentI18n: { en: 'System', 'zh-CN': '系统' }, contentHash: 'b'.repeat(64),
          },
          {
            id: id('composite_version'), templateId: id('composite'), version: 1,
            contentI18n: {}, contentHash: 'c'.repeat(64), definition: compositeDefinition,
            schemaVersion: 1, definitionHash: 'd'.repeat(64),
          },
          {
            id: id('switched_legacy_version'), templateId: id('switched'), version: 1,
            contentI18n: { en: 'Old legacy' }, contentHash: 'e'.repeat(64),
          },
          {
            id: id('switched_composite_version'), templateId: id('switched'), version: 2,
            contentI18n: {}, contentHash: 'f'.repeat(64), definition: compositeDefinition,
            schemaVersion: 1, definitionHash: '0'.repeat(64),
          },
        ],
      });

      const bounded = await queryCurrentTemplateCatalog(prisma, {
        mode: 'legacy', spaceId, locale: 'en', scope: 'space', archived: 'archived',
        skip: 110, take: 5,
      });
      assert.equal(bounded.total, 121);
      assert.equal(bounded.rows.length, 5);
      assert.equal(bounded.rows.every((row) => row.kind === 'single_page'), true);
      assert.equal(Object.hasOwn(bounded.rows[0], 'definition'), false);
      assert.equal(Object.hasOwn(bounded.rows[0], 'contentI18n'), false);

      const literal = await queryCurrentTemplateCatalog(prisma, {
        mode: 'legacy', spaceId, locale: 'en', scope: 'space', archived: 'archived',
        q: String.raw`100%_done\path`, skip: 0, take: 1,
      });
      assert.equal(literal.total, 1);
      assert.deepEqual(literal.rows.map((row) => row.id), [id('legacy_0')]);
      assert.equal(literal.rows[0].sourceLocale, 'zh-CN');
      assert.deepEqual(literal.rows[0].nameI18n, { 'zh-CN': literalName });

      for (const [locale, q] of [['en', '100%_english'], ['zh-CN', '100%_中文']]) {
        const localized = await queryCurrentTemplateCatalog(prisma, {
          mode: 'legacy', spaceId, locale, scope: 'system', archived: 'active',
          q, skip: 0, take: 10,
        });
        assert.equal(localized.total, 1);
        assert.deepEqual(localized.rows.map((row) => row.id), [systemTemplate.id]);
      }

      const composites = await queryCurrentTemplateCatalog(prisma, {
        mode: 'composite', spaceId, locale: 'en', scope: 'space', archived: 'archived',
        kind: 'page_group', supportsCollaboration: false, skip: 0, take: 10,
      });
      assert.equal(composites.total, 2);
      assert.equal(composites.rows.every((row) => row.kind === 'page_group'), true);
      assert.equal(composites.rows.every((row) => row.supportsCollaboration === false), true);
    } finally {
      await prisma.$disconnect();
    }
  });
});
