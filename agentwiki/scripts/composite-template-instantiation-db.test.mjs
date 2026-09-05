import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { withPageTemplateTestDatabase } from './page-template-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { Test } = requireFromServer('@nestjs/testing');
const { PrismaClient } = requireFromServer('@prisma/client');
const { PrismaService } = requireFromServer('./dist/database/prisma.service.js');
const { AuthorizationService } = requireFromServer('./dist/core/authorization/authorization.service.js');
const { ContentTreeService } = requireFromServer('./dist/content-tree/content-tree.service.js');
const { ReadableSyncPathService } = requireFromServer('./dist/core/sync/readable-sync-path.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const { TemplateInstantiationService } = requireFromServer(
  './dist/page-templates/template-instantiation.service.js',
);
const baseDatabaseUrl = process.env.PAGE_TEMPLATE_TEST_DATABASE_URL;

if (!baseDatabaseUrl) throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL is required');

const definition = {
  schemaVersion: 1,
  kind: 'page_group',
  nodes: [
    { nodeId: 'root', parentNodeId: null, kind: 'folder', order: 0, nameI18n: { en: 'Project' } },
    { nodeId: 'intro', parentNodeId: 'root', kind: 'page', order: 0, titleI18n: { en: 'Intro' }, contentI18n: { en: '# Intro' }, roleSlotKey: null },
    { nodeId: 'plan', parentNodeId: 'root', kind: 'folder', order: 1, nameI18n: { en: 'Plan' } },
    { nodeId: 'tasks', parentNodeId: 'plan', kind: 'page', order: 0, titleI18n: { en: 'Tasks' }, contentI18n: { en: '# Tasks' }, roleSlotKey: null },
    { nodeId: 'risks', parentNodeId: 'plan', kind: 'page', order: 1, titleI18n: { en: 'Risks' }, contentI18n: { en: '# Risks' }, roleSlotKey: null },
  ],
  collaboration: null,
};

const definitionHash = createHash('sha256')
  .update(JSON.stringify(sortObject(definition)), 'utf8')
  .digest('hex');

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortObject(item)]));
  }
  return value;
}

async function createService(prisma, failAt) {
  let pageCreateCount = 0;
  const transactionPrisma = new Proxy(prisma, {
    get(target, property) {
      if (property !== '$transaction') {
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (callback, options) => target.$transaction(async (tx) => {
        const page = new Proxy(tx.page, {
          get(delegate, key) {
            if (key !== 'create') return Reflect.get(delegate, key);
            return async (...args) => {
              pageCreateCount += 1;
              if (failAt === pageCreateCount) throw new Error(`injected page.create failure ${failAt}`);
              return delegate.create(...args);
            };
          },
        });
        const intercepted = new Proxy(tx, {
          get(transaction, key) {
            return key === 'page' ? page : Reflect.get(transaction, key);
          },
        });
        return callback(intercepted);
      }, options);
    },
  });
  const revisionWriter = SpaceRevisionWriterService.legacyOnly(transactionPrisma);
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: PrismaService, useValue: transactionPrisma },
      { provide: SpaceRevisionWriterService, useValue: revisionWriter },
      ReadableSyncPathService,
      AuthorizationService,
      ContentTreeService,
      TemplateInstantiationService,
    ],
  }).compile();
  return { service: moduleRef.get(TemplateInstantiationService), close: () => moduleRef.close() };
}

async function createFixture(prisma, suffix) {
  const userId = `instantiate_user_${suffix}`;
  const spaceId = `instantiate_space_${suffix}`;
  const templateId = `instantiate_template_${suffix}`;
  await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, type: 'human' } });
  await prisma.space.create({ data: { id: spaceId, name: 'Instantiation fixture', slug: spaceId } });
  await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
  await prisma.pageTemplate.create({ data: {
    id: templateId, scope: 'system', scopeKey: 'system', stableKey: `fixture-${suffix}`,
    category: 'planning', displayOrder: 1,
    nameI18n: { en: 'Fixture' }, descriptionI18n: { en: '' },
    defaultTitleI18n: { en: 'Fixture' }, currentVersion: 1,
  } });
  await prisma.pageTemplateVersion.create({ data: {
    id: `instantiate_version_${suffix}`, templateId, version: 1,
    contentI18n: {}, contentHash: createHash('sha256').update('').digest('hex'),
    definition, schemaVersion: 1, definitionHash,
  } });
  return { userId, spaceId, templateId };
}

function request(idempotencyKey, overrides = {}) {
  return {
    templateVersion: 1, locale: 'en', targetParentFolderId: null,
    variables: {}, collaborationEnabled: false, expectedTreeRevision: 0n,
    idempotencyKey, ...overrides,
  };
}

async function counts(prisma, spaceId) {
  const [folders, pages, pageVersions, instances, mappings, bindings, runs, effects] = await Promise.all([
    prisma.folder.count({ where: { spaceId } }),
    prisma.page.count({ where: { spaceId } }),
    prisma.pageVersion.count({ where: { page: { spaceId } } }),
    prisma.templateInstantiation.count({ where: { spaceId } }),
    prisma.templateInstantiationNode.count({ where: { spaceId } }),
    prisma.pageAgentBinding.count({ where: { spaceId } }),
    prisma.collaborationRun.count({ where: { spaceId } }),
    prisma.templateEffectJob.count({ where: { spaceId } }),
  ]);
  return { folders, pages, pageVersions, instances, mappings, bindings, runs, effects };
}

test('composite instantiation is atomic, idempotent, stale-safe, and permission-safe in PostgreSQL', {
  timeout: 120_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const rollbackFixture = await createFixture(prisma, `${schemaName.slice(-8)}_rollback`);
      const rollbackBefore = await counts(prisma, rollbackFixture.spaceId);
      const rollbackSpaceBefore = await prisma.space.findUniqueOrThrow({ where: { id: rollbackFixture.spaceId } });
      const failing = await createService(prisma, 3);
      try {
        await assert.rejects(
          failing.service.instantiate(
            rollbackFixture.spaceId,
            rollbackFixture.templateId,
            request('rollback-0001'),
            { userId: rollbackFixture.userId, platformRole: 'user' },
          ),
          /injected page\.create failure 3/u,
        );
      } finally {
        await failing.close();
      }
      assert.deepEqual(await counts(prisma, rollbackFixture.spaceId), rollbackBefore);
      assert.equal(
        (await prisma.space.findUniqueOrThrow({ where: { id: rollbackFixture.spaceId } })).contentTreeRevision,
        rollbackSpaceBefore.contentTreeRevision,
      );

      const successFixture = await createFixture(prisma, `${schemaName.slice(-8)}_success`);
      const before = await prisma.space.findUniqueOrThrow({ where: { id: successFixture.spaceId } });
      const working = await createService(prisma, null);
      try {
        const payload = request('success-0001');
        const result = await working.service.instantiate(
          successFixture.spaceId, successFixture.templateId, payload,
          { userId: successFixture.userId, platformRole: 'user' },
        );
        const after = await prisma.space.findUniqueOrThrow({ where: { id: successFixture.spaceId } });
        assert.equal(after.contentTreeRevision, before.contentTreeRevision + 1n);
        assert.equal(result.pageIds.length, 3);
        assert.equal(result.runId, null);
        const createdPages = await prisma.page.findMany({
          where: { id: { in: result.pageIds } },
          include: { versions: true },
        });
        assert.equal(createdPages.length, 3);
        for (const page of createdPages) {
          assert.equal(page.versions.length, 1);
          assert.deepEqual(
            {
              title: page.versions[0].title, content: page.versions[0].content,
              authorId: page.versions[0].authorId, slug: page.versions[0].slug,
              format: page.versions[0].format, parentId: page.versions[0].parentId,
              folderId: page.versions[0].folderId, syncPath: page.versions[0].syncPath,
              syncPathKey: page.versions[0].syncPathKey,
            },
            {
              title: page.title, content: page.content,
              authorId: page.authorId, slug: page.slug,
              format: page.format, parentId: page.parentId,
              folderId: page.folderId, syncPath: page.syncPath,
              syncPathKey: page.syncPathKey,
            },
          );
        }
        const intro = createdPages.find((page) => page.title === 'Intro');
        const plan = await prisma.folder.findFirstOrThrow({
          where: { spaceId: successFixture.spaceId, name: 'Plan' },
        });
        assert.ok(intro);
        assert.equal(intro.sortOrder, 0);
        assert.equal(plan.sortOrder, 1);
        assert.deepEqual(await counts(prisma, successFixture.spaceId), {
          folders: 2, pages: 3, pageVersions: 3, instances: 1,
          mappings: 5, bindings: 0, runs: 0, effects: 4,
        });

        const replay = await working.service.instantiate(
          successFixture.spaceId, successFixture.templateId, payload,
          { userId: successFixture.userId, platformRole: 'user' },
        );
        assert.deepEqual(replay, result);
        assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: successFixture.spaceId } })).contentTreeRevision, 1n);
        await assert.rejects(
          working.service.instantiate(
            successFixture.spaceId, successFixture.templateId,
            request('success-0001', { rootName: 'Different' }),
            { userId: successFixture.userId, platformRole: 'user' },
          ),
          (error) => error.businessCode === 'PAGE_TEMPLATE_INSTANTIATION_IDEMPOTENCY_CONFLICT',
        );
        await assert.rejects(
          working.service.instantiate(
            successFixture.spaceId, successFixture.templateId,
            request('fresh-but-stale-0001'),
            { userId: successFixture.userId, platformRole: 'user' },
          ),
          (error) => error.code === 'CONTENT_TREE_CONFLICT',
        );

        await prisma.spaceMember.delete({
          where: { userId_spaceId: { userId: successFixture.userId, spaceId: successFixture.spaceId } },
        });
        await assert.rejects(
          working.service.instantiate(
            successFixture.spaceId, successFixture.templateId, payload,
            { userId: successFixture.userId, platformRole: 'user' },
          ),
          (error) => error.businessCode === 'SPACE_ACCESS_DENIED',
        );
      } finally {
        await working.close();
      }
    } finally {
      await prisma.$disconnect();
    }
  });
});
