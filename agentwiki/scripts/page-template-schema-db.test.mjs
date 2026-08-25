import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  validatePageTemplateTestDatabaseUrl,
  withPageTemplateTestDatabase,
} from './page-template-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const baseDatabaseUrl = process.env.PAGE_TEMPLATE_TEST_DATABASE_URL;

test('page-template database URLs fail closed', () => {
  assert.throws(() => validatePageTemplateTestDatabaseUrl(undefined), /required/iu);
  assert.throws(
    () => validatePageTemplateTestDatabaseUrl('postgresql://localhost/agentwiki'),
    /test/iu,
  );
  assert.throws(
    () => validatePageTemplateTestDatabaseUrl('postgresql://localhost/agentwiki_test?schema=public'),
    /schema/iu,
  );
  assert.throws(
    () => validatePageTemplateTestDatabaseUrl('postgresql://localhost/agentwiki_test?schema='),
    /schema/iu,
  );
  for (const repeatedSchema of [
    'schema=page_template_test_one&schema=page_template_test_two',
    'schema=page_template_test_safe&schema=public',
    'schema=public&schema=page_template_test_safe',
    'schema=&schema=page_template_test_safe',
  ]) {
    assert.throws(
      () => validatePageTemplateTestDatabaseUrl(
        `postgresql://localhost/agentwiki_test?${repeatedSchema}`,
      ),
      /schema/iu,
    );
  }
  assert.doesNotThrow(
    () => validatePageTemplateTestDatabaseUrl('postgresql://localhost/agentwiki_test'),
  );
  assert.doesNotThrow(
    () => validatePageTemplateTestDatabaseUrl(
      'postgresql://localhost/agentwiki_test?schema=page_template_test_existing',
    ),
  );
});

test('page-template migration enforces scope, provenance tuples, and immutable references', {
  skip: baseDatabaseUrl ? false : 'PAGE_TEMPLATE_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    assert.match(schemaName, /^page_template_test_[a-z0-9_]+$/u);
    assert.notEqual(schemaName, 'public');
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = schemaName.replace('page_template_test_', '');
    try {
      const constraints = await prisma.$queryRawUnsafe(
        `SELECT conname AS name FROM pg_constraint
         WHERE connamespace = $1::regnamespace AND conname IN (
           'PageTemplate_scope_check', 'PageTemplate_current_version_check',
           'PageTemplateVersion_version_check', 'Page_template_source_tuple_check',
           'Page_sourceTemplate_version_fkey'
         ) ORDER BY conname`,
        schemaName,
      );
      assert.deepEqual(constraints.map((row) => row.name), [
        'PageTemplateVersion_version_check',
        'PageTemplate_current_version_check',
        'PageTemplate_scope_check',
        'Page_sourceTemplate_version_fkey',
        'Page_template_source_tuple_check',
      ]);

      const userId = `user_${suffix}`;
      const spaceId = `space_${suffix}`;
      const sourcePageId = `source_${suffix}`;
      const createdPageId = `created_${suffix}`;
      await prisma.user.create({
        data: { id: userId, email: `${userId}@page-template.test` },
      });
      await prisma.space.create({ data: { id: spaceId, name: 'Template Space', slug: spaceId } });
      await prisma.page.createMany({
        data: [
          {
            id: sourcePageId,
            title: 'Source',
            slug: 'source',
            spaceId,
            authorId: userId,
            syncPath: 'pages/Source.md',
            syncPathKey: 'pages/source.md',
          },
          {
            id: createdPageId,
            title: 'Created',
            slug: 'created',
            spaceId,
            authorId: userId,
            syncPath: 'pages/Created.md',
            syncPathKey: 'pages/created.md',
          },
        ],
      });
      const template = await prisma.pageTemplate.create({
        data: {
          scope: 'space',
          scopeKey: spaceId,
          spaceId,
          stableKey: 'weekly',
          category: 'reporting',
          nameI18n: { en: 'Weekly' },
          nameKey: 'weekly',
          descriptionI18n: { en: '' },
          defaultTitleI18n: { en: 'Weekly' },
          sourceLocale: 'en',
          createdById: userId,
          updatedById: userId,
        },
      });
      const versionOne = await prisma.pageTemplateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          contentI18n: { en: '# Weekly' },
          contentHash: 'a'.repeat(64),
          sourcePageId,
          createdById: userId,
        },
      });
      await prisma.page.update({
        where: { id: createdPageId },
        data: {
          sourceTemplateId: template.id,
          sourceTemplateVersion: 1,
          sourceTemplateLocale: 'en',
        },
      });

      await assert.rejects(
        prisma.pageTemplate.update({
          where: { id: template.id },
          data: { currentVersion: 0 },
        }),
        /check|constraint/iu,
      );
      await assert.rejects(
        prisma.pageTemplateVersion.create({
          data: {
            templateId: template.id,
            version: 0,
            contentI18n: { en: '# Invalid version' },
            contentHash: '0'.repeat(64),
          },
        }),
        /check|constraint/iu,
      );

      const immutableVersionMutations = [
        ['id', { id: `mutated_version_${suffix}` }],
        ['contentHash', { contentHash: 'd'.repeat(64) }],
        ['contentI18n', { contentI18n: { en: '# Mutated' } }],
        ['version', { version: 9 }],
        ['templateId', { templateId: `missing_template_${suffix}` }],
        ['createdAt', { createdAt: new Date('2026-01-01T00:00:00.000Z') }],
      ];
      for (const [field, data] of immutableVersionMutations) {
        await assert.rejects(
          prisma.pageTemplateVersion.update({
            where: { id: versionOne.id },
            data,
          }),
          /immutable|constraint/iu,
          `PageTemplateVersion ${field} update must be rejected`,
        );
      }

      const clearedSource = await prisma.pageTemplateVersion.update({
        where: { id: versionOne.id },
        data: { sourcePageId: null },
        select: { sourcePageId: true },
      });
      assert.equal(clearedSource.sourcePageId, null);
      await assert.rejects(
        prisma.pageTemplateVersion.update({
          where: { id: versionOne.id },
          data: { sourcePageId },
        }),
        /may only be cleared|constraint/iu,
      );
      const clearedCreator = await prisma.pageTemplateVersion.update({
        where: { id: versionOne.id },
        data: { createdById: null },
        select: { createdById: true },
      });
      assert.equal(clearedCreator.createdById, null);
      await assert.rejects(
        prisma.pageTemplateVersion.update({
          where: { id: versionOne.id },
          data: { createdById: userId },
        }),
        /may only be cleared|constraint/iu,
      );

      await assert.rejects(
        prisma.$executeRawUnsafe(
          `UPDATE "${schemaName}"."Page" SET "sourceTemplateVersion" = NULL WHERE "id" = $1`,
          createdPageId,
        ),
        /check|constraint/iu,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `UPDATE "${schemaName}"."Page" SET "sourceTemplateLocale" = 'fr' WHERE "id" = $1`,
          createdPageId,
        ),
        /check|constraint/iu,
      );
      await assert.rejects(
        prisma.page.update({
          where: { id: createdPageId },
          data: {
            sourceTemplateId: template.id,
            sourceTemplateVersion: 99,
            sourceTemplateLocale: 'en',
          },
        }),
        /foreign key|constraint/iu,
      );
      await assert.rejects(
        prisma.pageTemplateVersion.delete({
          where: { templateId_version: { templateId: template.id, version: 1 } },
        }),
        /foreign key|constraint/iu,
      );
      await assert.rejects(
        prisma.pageTemplate.create({
          data: {
            scope: 'system',
            scopeKey: spaceId,
            spaceId,
            stableKey: 'invalid',
            category: 'other',
            displayOrder: 1,
            nameI18n: { en: 'Invalid' },
            descriptionI18n: { en: '' },
            defaultTitleI18n: { en: 'Invalid' },
          },
        }),
        /check|constraint/iu,
      );

      let releaseConcurrentVersions;
      const concurrentVersionsReady = new Promise((resolve) => {
        releaseConcurrentVersions = resolve;
      });
      let concurrentVersionReaders = 0;
      const advanceToVersionTwo = (contentHash) => prisma.$transaction(async (transaction) => {
        const current = await transaction.pageTemplate.findUniqueOrThrow({
          where: { id: template.id },
          select: { currentVersion: true },
        });
        assert.equal(current.currentVersion, 1);
        concurrentVersionReaders += 1;
        if (concurrentVersionReaders === 2) releaseConcurrentVersions();
        await concurrentVersionsReady;
        await transaction.pageTemplateVersion.create({
          data: {
            templateId: template.id,
            version: 2,
            contentI18n: { en: '# Weekly v2' },
            contentHash,
            sourcePageId,
            createdById: userId,
          },
        });
        const advanced = await transaction.pageTemplate.updateMany({
          where: { id: template.id, currentVersion: 1 },
          data: { currentVersion: 2 },
        });
        assert.equal(advanced.count, 1);
      }, { isolationLevel: 'Serializable' });

      const concurrentAdvances = await Promise.allSettled([
        advanceToVersionTwo('b'.repeat(64)),
        advanceToVersionTwo('c'.repeat(64)),
      ]);
      assert.equal(
        concurrentAdvances.filter(({ status }) => status === 'fulfilled').length,
        1,
      );
      assert.equal(
        concurrentAdvances.filter(({ status }) => status === 'rejected').length,
        1,
      );
      const rejectedAdvance = concurrentAdvances.find(({ status }) => status === 'rejected');
      assert.match(
        [
          rejectedAdvance?.reason?.code,
          rejectedAdvance?.reason?.message,
          rejectedAdvance?.reason?.meta?.message,
        ].filter(Boolean).join('\n'),
        /P2002|P2034|unique constraint|serializ/iu,
      );
      const persistedTemplate = await prisma.pageTemplate.findUniqueOrThrow({
        where: { id: template.id },
        select: { currentVersion: true },
      });
      const persistedVersions = await prisma.pageTemplateVersion.findMany({
        where: { templateId: template.id },
        orderBy: { version: 'asc' },
        select: { version: true },
      });
      assert.equal(persistedTemplate.currentVersion, 2);
      assert.deepEqual(persistedVersions, [{ version: 1 }, { version: 2 }]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
