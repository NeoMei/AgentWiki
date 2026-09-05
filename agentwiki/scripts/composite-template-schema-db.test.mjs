import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { withPageTemplateTestDatabase } from './page-template-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const baseDatabaseUrl = process.env.PAGE_TEMPLATE_TEST_DATABASE_URL;

if (!baseDatabaseUrl) {
  throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL is required');
}

test('composite-template migration preserves legacy runs and enforces source and mapping invariants', {
  timeout: 120_000,
}, async () => {
  let legacySnapshot;
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = schemaName.replace('page_template_test_', '');
    const id = (prefix) => `${prefix}_${suffix}`;
    try {
      const oldBefore = await prisma.$queryRawUnsafe(
        `SELECT "templateId", "templateVersion", "templateSnapshot"
           FROM "${schemaName}"."CollaborationRun" WHERE "id" = $1`,
        id('old_run'),
      );
      assert.deepEqual(oldBefore, legacySnapshot);
      assert.equal(oldBefore[0].templateId, id('legacy_template'));

      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schemaName}"."CollaborationRun"
          ("id", "spaceId", "sourceKind", "templateId", "templateVersion", "templateSnapshot", "snapshotHash", "name", "inputs", "startedById", "updatedAt")
         VALUES ($1, $2, 'page_selection', NULL, 1, '{}'::jsonb, $3, 'Selection', '{}'::jsonb, $4, CURRENT_TIMESTAMP)`,
        id('selection_run'), id('space_a'), 'b'.repeat(64), id('user'),
      );

      const oldAfter = await prisma.$queryRawUnsafe(
        `SELECT "sourceKind", "templateId", "templateVersion", "templateSnapshot"
           FROM "${schemaName}"."CollaborationRun" WHERE "id" = $1`,
        id('old_run'),
      );
      assert.deepEqual(oldAfter, [{
        sourceKind: 'legacy',
        templateId: oldBefore[0].templateId,
        templateVersion: oldBefore[0].templateVersion,
        templateSnapshot: oldBefore[0].templateSnapshot,
      }]);

      await assert.rejects(
        prisma.$executeRawUnsafe(
          `INSERT INTO "${schemaName}"."CollaborationRun"
            ("id", "spaceId", "sourceKind", "templateId", "templateVersion", "templateSnapshot", "snapshotHash", "name", "inputs", "startedById", "updatedAt")
           VALUES ($1, $2, 'legacy', NULL, 1, '{}'::jsonb, $3, 'Invalid', '{}'::jsonb, $4, CURRENT_TIMESTAMP)`,
          id('invalid_run'), id('space_a'), 'c'.repeat(64), id('user'),
        ),
        /check|constraint/iu,
      );

      const tables = await prisma.$queryRawUnsafe(
        `SELECT tablename AS name FROM pg_tables
          WHERE schemaname = $1 AND tablename IN
            ('TemplateInstantiation', 'TemplateInstantiationNode', 'PageAgentBinding',
             'PageAgentBindingEvent', 'CollaborationArtifactChangeSetLink', 'TemplateEffectJob')
          ORDER BY tablename`,
        schemaName,
      );
      assert.deepEqual(tables.map((row) => row.name), [
        'CollaborationArtifactChangeSetLink',
        'PageAgentBinding',
        'PageAgentBindingEvent',
        'TemplateEffectJob',
        'TemplateInstantiation',
        'TemplateInstantiationNode',
      ]);

      const pageTemplate = await prisma.pageTemplate.create({
        data: {
          id: id('page_template'),
          scope: 'space',
          scopeKey: id('space_a'),
          spaceId: id('space_a'),
          stableKey: 'composite',
          category: 'planning',
          nameI18n: { en: 'Composite' },
          nameKey: 'composite',
          descriptionI18n: { en: '' },
          defaultTitleI18n: { en: 'Composite' },
          sourceLocale: 'en',
        },
      });
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `INSERT INTO "${schemaName}"."PageTemplateVersion"
            ("id", "templateId", "version", "contentI18n", "contentHash", "definition")
           VALUES ($1, $2, 99, '{}'::jsonb, $3, '{}'::jsonb)`,
          id('incomplete_definition'), pageTemplate.id, '9'.repeat(64),
        ),
        /check|constraint/iu,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `INSERT INTO "${schemaName}"."CollaborationRun"
            ("id", "spaceId", "sourceKind", "templateId", "templateVersion", "templateSnapshot", "snapshotHash", "name", "inputs", "startedById", "updatedAt")
           VALUES ($1, $2, 'page_selection', NULL, 1, 'null'::jsonb, $3, 'Invalid snapshot', '{}'::jsonb, $4, CURRENT_TIMESTAMP)`,
          id('json_null_snapshot'), id('space_a'), '8'.repeat(64), id('user'),
        ),
        /check|constraint/iu,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schemaName}"."PageTemplateVersion"
          ("id", "templateId", "version", "contentI18n", "contentHash", "definition", "schemaVersion", "definitionHash")
         VALUES ($1, $2, 1, '{}'::jsonb, $3, $4::jsonb, 1, $5)`,
        id('composite_version'), pageTemplate.id, 'd'.repeat(64),
        JSON.stringify({ schemaVersion: 1, kind: 'single_page', nodes: [], collaboration: null }),
        'e'.repeat(64),
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `UPDATE "${schemaName}"."PageTemplateVersion" SET "definition" = '{}'::jsonb WHERE "id" = $1`,
          id('composite_version'),
        ),
        /immutable|constraint/iu,
      );

      await prisma.agent.create({ data: { id: id('agent'), name: 'Agent', ownerId: id('user') } });
      await prisma.agentGrant.create({ data: {
        id: id('grant_b'), agentId: id('agent'), spaceId: id('space_b'), role: 'editor',
      } });
      await prisma.page.createMany({ data: [
        {
          id: id('page_a'), title: 'A', slug: id('page_a'), spaceId: id('space_a'),
          authorId: id('user'), syncPath: 'A.md', syncPathKey: 'a.md',
        },
        {
          id: id('page_b'), title: 'B', slug: id('page_b'), spaceId: id('space_b'),
          authorId: id('user'), syncPath: 'B.md', syncPathKey: 'b.md',
        },
      ] });
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schemaName}"."TemplateInstantiation"
          ("id", "spaceId", "compositeTemplateVersionId", "createdByUserId", "idempotencyKey", "requestHash", "treeRevision", "result", "updatedAt")
         VALUES ($1, $2, $3, $4, 'instantiate-1', $5, 0, '{}'::jsonb, CURRENT_TIMESTAMP)`,
        id('instantiation'), id('space_a'), id('composite_version'), id('user'), 'f'.repeat(64),
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schemaName}"."TemplateInstantiationNode"
          ("id", "instantiationId", "spaceId", "templateNodeId", "kind", "pageId")
         VALUES ($1, $2, $3, 'page', 'page', $4)`,
        id('mapping'), id('instantiation'), id('space_a'), id('page_a'),
      );

      await assert.rejects(
        prisma.$executeRawUnsafe(
          `INSERT INTO "${schemaName}"."TemplateInstantiationNode"
            ("id", "instantiationId", "spaceId", "templateNodeId", "kind", "folderId", "pageId")
           VALUES ($1, $2, $3, 'xor', 'page', NULL, NULL)`,
          id('invalid_xor'), id('instantiation'), id('space_a'),
        ),
        /check|constraint/iu,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `INSERT INTO "${schemaName}"."TemplateInstantiationNode"
            ("id", "instantiationId", "spaceId", "templateNodeId", "kind", "pageId")
           VALUES ($1, $2, $3, 'page', 'page', $4)`,
          id('duplicate_mapping'), id('instantiation'), id('space_a'), id('page_a'),
        ),
        /23505|already exists|unique|constraint/iu,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `INSERT INTO "${schemaName}"."TemplateInstantiationNode"
            ("id", "instantiationId", "spaceId", "templateNodeId", "kind", "pageId")
           VALUES ($1, $2, $3, 'cross-space', 'page', $4)`,
          id('cross_space_mapping'), id('instantiation'), id('space_a'), id('page_b'),
        ),
        /23503|grant in the Page Space|foreign key|constraint/iu,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `INSERT INTO "${schemaName}"."PageAgentBinding"
            ("id", "pageId", "spaceId", "agentId", "assignedByUserId", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
          id('cross_space_binding'), id('page_a'), id('space_a'), id('agent'), id('user'),
        ),
        /23503|grant in the Page Space|foreign key|constraint/iu,
      );
      await prisma.agentGrant.create({ data: {
        id: id('grant_a'), agentId: id('agent'), spaceId: id('space_a'), role: 'editor',
      } });
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schemaName}"."PageAgentBinding"
          ("id", "pageId", "spaceId", "agentId", "assignedByUserId", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        id('binding'), id('page_a'), id('space_a'), id('agent'), id('user'),
      );
      await prisma.agentGrant.delete({ where: { id: id('grant_a') } });
      const retainedBinding = await prisma.$queryRawUnsafe(
        `SELECT "agentId" FROM "${schemaName}"."PageAgentBinding" WHERE "id" = $1`,
        id('binding'),
      );
      assert.deepEqual(retainedBinding, [{ agentId: id('agent') }]);

      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schemaName}"."CollaborationRun"
          ("id", "spaceId", "sourceKind", "templateId", "compositeTemplateVersionId", "templateInstantiationId", "templateVersion", "templateSnapshot", "snapshotHash", "name", "inputs", "startedById", "updatedAt")
         VALUES ($1, $2, 'composite', NULL, $3, $4, 1, '{}'::jsonb, $5, 'Composite', '{}'::jsonb, $6, CURRENT_TIMESTAMP)`,
        id('composite_run'), id('space_a'), id('composite_version'), id('instantiation'),
        '1'.repeat(64), id('user'),
      );
      const taskInsert = (taskId, pageId, targetSpaceId) => prisma.$executeRawUnsafe(
        `INSERT INTO "${schemaName}"."CollaborationRunTask"
          ("id", "runId", "nodeId", "ordinal", "name", "objective", "roleSlotId", "assigneeAgentId",
           "outputContract", "requiredEvidence", "leaseSeconds", "maxExecutionSeconds", "targetPageId", "targetSpaceId", "updatedAt")
         VALUES ($1, $2, $1, 0, 'Task', 'Write', 'writer', $3, '{}'::jsonb, '[]'::jsonb, 300, 3600, $4, $5, CURRENT_TIMESTAMP)`,
        taskId, id('composite_run'), id('agent'), pageId, targetSpaceId,
      );
      await assert.rejects(
        taskInsert(id('half_target'), id('page_a'), null),
        /check|constraint/iu,
      );
      await assert.rejects(
        taskInsert(id('cross_target'), id('page_b'), id('space_b')),
        /foreign key|constraint/iu,
      );
      await taskInsert(id('valid_target'), id('page_a'), id('space_a'));
    } finally {
      await prisma.$disconnect();
    }
  }, {
    latestMigrationName: '20260905120000_composite_templates',
    beforeLatestMigration: async ({ databaseUrl, schemaName }) => {
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const suffix = schemaName.replace('page_template_test_', '');
      const id = (prefix) => `${prefix}_${suffix}`;
      try {
        await prisma.user.create({ data: { id: id('user'), email: `${id('user')}@composite.test` } });
        await prisma.space.createMany({ data: [
          { id: id('space_a'), name: 'A', slug: id('space_a') },
          { id: id('space_b'), name: 'B', slug: id('space_b') },
        ] });
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${schemaName}"."CollaborationTemplate"
            ("id", "spaceId", "scopeKey", "slug", "name", "version", "system", "definition", "updatedAt")
           VALUES ($1, $2, $2, 'legacy', 'Legacy', 1, false, '{}'::jsonb, CURRENT_TIMESTAMP)`,
          id('legacy_template'), id('space_a'),
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${schemaName}"."CollaborationRun"
            ("id", "spaceId", "templateId", "templateVersion", "templateSnapshot", "snapshotHash", "name", "inputs", "startedById", "updatedAt")
           VALUES ($1, $2, $3, 1, '{}'::jsonb, $4, 'Old run', '{}'::jsonb, $5, CURRENT_TIMESTAMP)`,
          id('old_run'), id('space_a'), id('legacy_template'), 'a'.repeat(64), id('user'),
        );
        legacySnapshot = await prisma.$queryRawUnsafe(
          `SELECT "templateId", "templateVersion", "templateSnapshot"
             FROM "${schemaName}"."CollaborationRun" WHERE "id" = $1`,
          id('old_run'),
        );
      } finally {
        await prisma.$disconnect();
      }
    },
  });
});
