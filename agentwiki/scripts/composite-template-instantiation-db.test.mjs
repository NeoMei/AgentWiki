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
const { CompositeTemplateCatalogService } = requireFromServer(
  './dist/page-templates/composite-template-catalog.service.js',
);
const { PageTemplateService } = requireFromServer('./dist/page-templates/page-template.service.js');
const { PageAgentBindingService } = requireFromServer('./dist/page-templates/page-agent-binding.service.js');
const { FolderTemplateSnapshotService } = requireFromServer('./dist/page-templates/folder-template-snapshot.service.js');
const { ExistingRunOrchestrationService } = requireFromServer('./dist/page-templates/existing-run-orchestration.service.js');
const { MarkdownResourceService } = requireFromServer('./dist/markdown-resources/markdown-resource.service.js');
const { RunExpansionService } = requireFromServer('./dist/collaboration-workflows/run-expansion.service.js');
const { CollaborationEventsService } = requireFromServer('./dist/collaboration-workflows/collaboration-events.service.js');
const { RunEventStore } = requireFromServer('./dist/collaboration-workflows/run-event.store.js');
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

const collaborationDefinition = {
  schemaVersion: 1,
  kind: 'single_page',
  nodes: [{
    nodeId: 'page', parentNodeId: null, kind: 'page', order: 0,
    titleI18n: { en: 'Draft' }, contentI18n: { en: '# Draft' }, roleSlotKey: 'writer',
  }],
  collaboration: {
    workflow: {
      schemaVersion: 1,
      inputs: [{ key: 'brief', label: 'Brief', type: 'long_text', required: true }],
      roleSlots: [{ id: 'writer', name: 'Writer', required: true, description: 'Writes' }],
      nodes: [
        {
          kind: 'agent_task', id: 'draft', name: 'Draft', roleSlotId: 'writer', objective: 'Draft Page',
          inputKeys: ['brief'], upstreamArtifacts: [], output: { key: 'draft-output', kind: 'markdown' },
          evidenceRequired: [], humanAcceptance: true, leaseSeconds: 300, maxExecutionSeconds: 3600,
          retryBudget: 1, repairBudget: 1, skippable: false,
          todos: [{ id: 'write', name: 'Write', required: true, evidenceKinds: [] }],
        },
        {
          kind: 'human_review', id: 'review-draft', name: 'Review', artifactTaskId: 'draft',
          minimumRole: 'editor', reviewerUserIds: [], approvalCriteria: ['Accurate'],
          revisionTaskId: 'draft', allowTerminate: true,
        },
      ],
      dependencies: [{ from: 'draft', to: 'review-draft', mode: 'all' }],
      terminalNodeIds: ['review-draft'],
    },
    taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'page' }],
  },
};

const collaborationGroupDefinition = {
  ...collaborationDefinition,
  kind: 'page_group',
  nodes: [
    { nodeId: 'root', parentNodeId: null, kind: 'folder', order: 0, nameI18n: { en: 'Project' } },
    { ...collaborationDefinition.nodes[0], parentNodeId: 'root' },
  ],
};

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
            if (key === 'page') return page;
            if (key === 'collaborationRunTask' && failAt === 'run-expansion') {
              return new Proxy(transaction.collaborationRunTask, {
                get(delegate, operation) {
                  if (operation !== 'createMany') return Reflect.get(delegate, operation);
                  return async () => { throw new Error('injected run expansion failure'); };
                },
              });
            }
            return Reflect.get(transaction, key);
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
      { provide: PageTemplateService, useValue: {} },
      { provide: MarkdownResourceService, useValue: { resolveReferencedAttachmentsBatch: async () => [] } },
      CompositeTemplateCatalogService,
      PageAgentBindingService,
      FolderTemplateSnapshotService,
      { provide: CollaborationEventsService, useValue: { publishCurrentRun: async () => undefined } },
      RunEventStore,
      RunExpansionService,
      TemplateInstantiationService,
      ExistingRunOrchestrationService,
    ],
  }).compile();
  return {
    service: moduleRef.get(TemplateInstantiationService),
    runExpansion: moduleRef.get(RunExpansionService),
    pageBindings: moduleRef.get(PageAgentBindingService),
    existingRuns: moduleRef.get(ExistingRunOrchestrationService),
    close: () => moduleRef.close(),
  };
}

async function createFixture(prisma, suffix, templateDefinition = definition) {
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
    definition: templateDefinition, schemaVersion: 1,
    definitionHash: createHash('sha256').update(JSON.stringify(sortObject(templateDefinition)), 'utf8').digest('hex'),
  } });
  return { userId, spaceId, templateId };
}

async function prepareAgent(prisma, fixture, suffix) {
  const agentId = `instantiate_agent_${suffix}`;
  await prisma.agent.create({ data: {
    id: agentId, name: 'Writer Agent', ownerId: fixture.userId, status: 'active',
  } });
  const grant = await prisma.agentGrant.create({ data: {
    id: `instantiate_grant_${suffix}`, agentId, spaceId: fixture.spaceId, role: 'editor',
  } });
  await prisma.agentCredential.create({ data: {
    id: `instantiate_credential_${suffix}`, name: 'Fixture credential', prefix: `fix_${suffix.slice(-8)}`,
    keyHash: createHash('sha256').update(`credential-${suffix}`).digest('hex'),
    agentId, authorizationId: grant.id,
  } });
  return agentId;
}

async function createLegacyFixture(prisma, suffix) {
  const userId = `legacy_user_${suffix}`;
  const spaceId = `legacy_space_${suffix}`;
  const templateId = `legacy_template_${suffix}`;
  const versionId = `legacy_version_${suffix}`;
  const contentI18n = { 'zh-CN': '# 不可变旧正文', en: '# Immutable legacy body' };
  await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, type: 'human' } });
  await prisma.space.create({ data: { id: spaceId, name: 'Legacy instantiation fixture', slug: spaceId } });
  await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
  await prisma.pageTemplate.create({ data: {
    id: templateId, scope: 'system', scopeKey: 'system', stableKey: `legacy-fixture-${suffix}`,
    category: 'knowledge', displayOrder: 2,
    nameI18n: { 'zh-CN': '旧模板', en: 'Legacy template' },
    descriptionI18n: { 'zh-CN': '', en: '' },
    defaultTitleI18n: { 'zh-CN': '旧模板页面', en: 'Legacy page' }, currentVersion: 1,
  } });
  await prisma.pageTemplateVersion.create({ data: {
    id: versionId, templateId, version: 1, contentI18n,
    contentHash: createHash('sha256').update(contentI18n.en).digest('hex'),
  } });
  return { userId, spaceId, templateId, versionId, contentI18n };
}

function request(idempotencyKey, overrides = {}) {
  return {
    templateVersion: 1, locale: 'en', targetParentFolderId: null,
    variables: {}, collaborationEnabled: false, expectedTreeRevision: 0n,
    idempotencyKey, ...overrides,
  };
}

function collaborationRequest(idempotencyKey, agentId, overrides = {}) {
  return request(idempotencyKey, {
    collaborationEnabled: true,
    collaborationInputs: { brief: 'Write from the current Page' },
    roleBindings: [{ kind: 'task_default', nodeId: 'draft', roleSlotId: 'writer', agentId }],
    enabledTaskNodeIds: ['draft'],
    ...overrides,
  });
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

      const collaborationRollback = await createFixture(
        prisma, `${schemaName.slice(-8)}_collab_rollback`, collaborationDefinition,
      );
      const rollbackAgent = await prepareAgent(prisma, collaborationRollback, `${schemaName.slice(-8)}_rollback`);
      const collaborationBefore = await counts(prisma, collaborationRollback.spaceId);
      const collaborationSpaceBefore = await prisma.space.findUniqueOrThrow({ where: { id: collaborationRollback.spaceId } });
      const failingExpansion = await createService(prisma, 'run-expansion');
      try {
        await assert.rejects(
          failingExpansion.service.instantiate(
            collaborationRollback.spaceId,
            collaborationRollback.templateId,
            collaborationRequest('collaboration-rollback-0001', rollbackAgent),
            { userId: collaborationRollback.userId, platformRole: 'user' },
          ),
          /injected run expansion failure/u,
        );
      } finally {
        await failingExpansion.close();
      }
      assert.deepEqual(await counts(prisma, collaborationRollback.spaceId), collaborationBefore);
      assert.equal(
        (await prisma.space.findUniqueOrThrow({ where: { id: collaborationRollback.spaceId } })).contentTreeRevision,
        collaborationSpaceBefore.contentTreeRevision,
      );

      const collaborationSuccess = await createFixture(
        prisma, `${schemaName.slice(-8)}_collab_success`, collaborationDefinition,
      );
      const successAgent = await prepareAgent(prisma, collaborationSuccess, `${schemaName.slice(-8)}_success`);
      const collaborationService = await createService(prisma, null);
      try {
        const result = await collaborationService.service.instantiate(
          collaborationSuccess.spaceId,
          collaborationSuccess.templateId,
          collaborationRequest('collaboration-success-0001', successAgent),
          { userId: collaborationSuccess.userId, platformRole: 'user' },
        );
        assert.ok(result.runId);
        const createdRun = await prisma.collaborationRun.findUniqueOrThrow({
          where: { id: result.runId }, include: { roleBindings: true, tasks: true },
        });
        assert.equal(createdRun.sourceKind, 'composite');
        assert.equal(createdRun.templateId, null);
        assert.equal(createdRun.roleBindings.length, 1);
        assert.equal(createdRun.roleBindings[0].agentId, successAgent);
        assert.equal(createdRun.tasks.length, 1);
        assert.equal(createdRun.tasks[0].targetPageId, result.pageIds[0]);
        assert.equal(createdRun.tasks[0].basePageVersionId === null, false);
        const collaborationEffect = await prisma.templateEffectJob.findUniqueOrThrow({
          where: {
            instantiationId_effectKey: {
              instantiationId: result.instantiationId,
              effectKey: `collaboration-run:${result.runId}`,
            },
          },
        });
        assert.equal(collaborationEffect.kind, 'collaboration_run');
        assert.deepEqual(collaborationEffect.payload, { runId: result.runId });
        assert.equal(await prisma.pageAgentBinding.count({ where: { spaceId: collaborationSuccess.spaceId } }), 1);
        assert.equal(
          (await prisma.space.findUniqueOrThrow({ where: { id: collaborationSuccess.spaceId } })).contentTreeRevision,
          1n,
        );

        const replacementAgent = await prepareAgent(
          prisma, collaborationSuccess, `${schemaName.slice(-8)}_replacement`,
        );
        const originalBinding = await prisma.pageAgentBinding.findUniqueOrThrow({
          where: { pageId: result.pageIds[0] },
        });
        await collaborationService.pageBindings.setBindingsInScope(
          collaborationSuccess.spaceId,
          {
            pageIds: [result.pageIds[0]],
            expectedTreeRevision: 1n,
            edits: [{
              pageId: result.pageIds[0], agentId: replacementAgent, roleSlotKey: 'writer',
              expectedUpdatedAt: originalBinding.updatedAt.toISOString(),
            }],
          },
          { userId: collaborationSuccess.userId, platformRole: 'user' },
        );
        const frozenTask = await prisma.collaborationRunTask.findUniqueOrThrow({
          where: { id: createdRun.tasks[0].id },
        });
        assert.equal(
          (await prisma.pageAgentBinding.findUniqueOrThrow({ where: { pageId: result.pageIds[0] } })).agentId,
          replacementAgent,
        );
        assert.equal(frozenTask.assigneeAgentId, successAgent);

        const secondPrisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
        const secondService = await createService(secondPrisma, null);
        try {
          const existingPageInput = {
            spaceId: collaborationSuccess.spaceId,
            name: 'Run existing Page again',
            pageIds: [result.pageIds[0]],
            expectedTreeRevision: 1n,
            idempotencyKey: 'existing-page-double-client-1',
          };
          const runsBefore = await prisma.collaborationRun.count({ where: { spaceId: collaborationSuccess.spaceId } });
          const [leftRunId, rightRunId] = await Promise.all([
            collaborationService.runExpansion.createPageSelection(
              existingPageInput, { userId: collaborationSuccess.userId, platformRole: 'user' },
            ),
            secondService.runExpansion.createPageSelection(
              existingPageInput, { userId: collaborationSuccess.userId, platformRole: 'user' },
            ),
          ]);
          assert.equal(leftRunId, rightRunId);
          assert.equal(
            await prisma.collaborationRun.count({ where: { spaceId: collaborationSuccess.spaceId } }),
            runsBefore + 1,
          );
        } finally {
          await secondService.close();
          await secondPrisma.$disconnect();
        }
      } finally {
        await collaborationService.close();
      }

      const overrideFixture = await createFixture(
        prisma, `${schemaName.slice(-8)}_collab_override`, collaborationDefinition,
      );
      const defaultAgent = await prepareAgent(prisma, overrideFixture, `${schemaName.slice(-8)}_default`);
      const runAgent = await prepareAgent(prisma, overrideFixture, `${schemaName.slice(-8)}_run`);
      const overrideService = await createService(prisma, null);
      try {
        const result = await overrideService.service.instantiate(
          overrideFixture.spaceId,
          overrideFixture.templateId,
          collaborationRequest('collaboration-override-0001', defaultAgent, {
            roleBindings: [
              { kind: 'task_default', nodeId: 'draft', roleSlotId: 'writer', agentId: defaultAgent },
              { kind: 'role_override', roleSlotId: 'writer', agentId: runAgent },
            ],
          }),
          { userId: overrideFixture.userId, platformRole: 'user' },
        );
        const [pageBinding, run] = await Promise.all([
          prisma.pageAgentBinding.findUniqueOrThrow({ where: { pageId: result.pageIds[0] } }),
          prisma.collaborationRun.findUniqueOrThrow({
            where: { id: result.runId }, include: { roleBindings: true, tasks: true },
          }),
        ]);
        assert.equal(pageBinding.agentId, defaultAgent);
        assert.equal(run.roleBindings.length, 1);
        assert.equal(run.roleBindings[0].agentId, runAgent);
        assert.equal(run.tasks.length, 1);
        assert.equal(run.tasks[0].assigneeAgentId, runAgent);
      } finally {
        await overrideService.close();
      }

      const nextRunFixture = await createFixture(
        prisma, `${schemaName.slice(-8)}_next_run`, collaborationGroupDefinition,
      );
      const nextRunAgent = await prepareAgent(
        prisma, nextRunFixture, `${schemaName.slice(-8)}_next_run`,
      );
      const nextRunService = await createService(prisma, null);
      try {
        const initial = await nextRunService.service.instantiate(
          nextRunFixture.spaceId,
          nextRunFixture.templateId,
          collaborationRequest('next-run-initial-0001', nextRunAgent),
          { userId: nextRunFixture.userId, platformRole: 'user' },
        );
        const originalInstance = await prisma.templateInstantiation.findUniqueOrThrow({
          where: { id: initial.instantiationId },
        });
        const originalBinding = await prisma.pageAgentBinding.findUniqueOrThrow({
          where: { pageId: initial.pageIds[0] },
        });
        const preview = await nextRunService.existingRuns.preview(
          nextRunFixture.spaceId,
          initial.rootFolderId,
          {
            source: { kind: 'template_instantiation', sourceInstantiationId: initial.instantiationId },
            pageIds: initial.pageIds,
            collaborationInputs: { brief: 'Continue exact source' },
            bindings: [],
          },
          { userId: nextRunFixture.userId, platformRole: 'user' },
        );
        assert.deepEqual(preview.pageIds, initial.pageIds);
        const latePageId = `late_child_${schemaName.slice(-8)}`;
        await prisma.page.create({ data: {
          id: latePageId,
          title: 'Late child', slug: `late-child-${schemaName.slice(-8)}`,
          content: '# Late', format: 'markdown', spaceId: nextRunFixture.spaceId,
          authorId: nextRunFixture.userId, folderId: initial.rootFolderId,
          syncPath: `pages/Project/late-${schemaName.slice(-8)}.md`,
          syncPathKey: `pages/project/late-${schemaName.slice(-8)}.md`,
        } });
        const originalCounts = await counts(prisma, nextRunFixture.spaceId);
        assert.equal(preview.pageIds.includes(`late_child_${schemaName.slice(-8)}`), false);

        const secondPrisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
        const secondNextRunService = await createService(secondPrisma, null);
        try {
          const runsBeforeNext = await prisma.collaborationRun.count({
            where: { spaceId: nextRunFixture.spaceId },
          });
          const payload = {
            source: { kind: 'template_instantiation', sourceInstantiationId: initial.instantiationId },
            pageIds: initial.pageIds,
            collaborationInputs: { brief: 'Continue exact source' },
            bindings: [],
            name: 'Existing group next Run',
            expectedTreeRevision: 1n,
            idempotencyKey: 'next-run-double-client-0001',
          };
          const [left, right] = await Promise.all([
            nextRunService.existingRuns.start(
              nextRunFixture.spaceId, initial.rootFolderId, payload,
              { userId: nextRunFixture.userId, platformRole: 'user' },
            ),
            secondNextRunService.existingRuns.start(
              nextRunFixture.spaceId, initial.rootFolderId, payload,
              { userId: nextRunFixture.userId, platformRole: 'user' },
            ),
          ]);
          assert.equal(left.runId, right.runId);
          assert.equal(await prisma.collaborationRun.count({
            where: { spaceId: nextRunFixture.spaceId },
          }), runsBeforeNext + 1);
          const nextRun = await prisma.collaborationRun.findUniqueOrThrow({
            where: { id: left.runId }, include: { tasks: true },
          });
          assert.equal(nextRun.templateInstantiationId, null);
          assert.equal(nextRun.compositeTemplateVersionId, originalInstance.compositeTemplateVersionId);
          assert.equal(nextRun.tasks.some((task) => task.targetPageId === latePageId), false);
          assert.equal(await prisma.folder.count({ where: { spaceId: nextRunFixture.spaceId } }), originalCounts.folders);
          assert.equal(await prisma.page.count({ where: { spaceId: nextRunFixture.spaceId } }), originalCounts.pages);
          assert.equal(await prisma.templateInstantiation.count({ where: { spaceId: nextRunFixture.spaceId } }), originalCounts.instances);
          assert.deepEqual(
            (await prisma.templateInstantiation.findUniqueOrThrow({ where: { id: initial.instantiationId } })).result,
            originalInstance.result,
          );
          const event = await prisma.collaborationRunEvent.findFirstOrThrow({
            where: { runId: left.runId, operation: 'create_existing_page_group_run' },
          });
          assert.equal(event.metadata.sourceInstantiationId, initial.instantiationId);
        } finally {
          await secondNextRunService.close();
          await secondPrisma.$disconnect();
        }

        const replacementAgent = await prepareAgent(
          prisma, nextRunFixture, `${schemaName.slice(-8)}_next_replacement`,
        );
        const eventsBefore = await prisma.pageAgentBindingEvent.count({
          where: { spaceId: nextRunFixture.spaceId },
        });
        const runsBeforeFailure = await prisma.collaborationRun.count({
          where: { spaceId: nextRunFixture.spaceId },
        });
        const rollbackPayload = {
          source: { kind: 'template_instantiation', sourceInstantiationId: initial.instantiationId },
          pageIds: initial.pageIds,
          collaborationInputs: { brief: 'Rollback binding and Run' },
          bindings: [],
          bindingEdits: [{
            pageId: initial.pageIds[0], agentId: replacementAgent, roleSlotKey: 'writer',
            expectedUpdatedAt: originalBinding.updatedAt.toISOString(),
          }],
          name: 'Injected failure', expectedTreeRevision: 1n,
          idempotencyKey: 'next-run-rollback-0001',
        };
        const failingNextRunService = await createService(prisma, 'run-expansion');
        try {
          await assert.rejects(failingNextRunService.existingRuns.start(
            nextRunFixture.spaceId,
            initial.rootFolderId,
            rollbackPayload,
            { userId: nextRunFixture.userId, platformRole: 'user' },
          ), /injected run expansion failure/u);
        } finally {
          await failingNextRunService.close();
        }
        assert.equal(
          (await prisma.pageAgentBinding.findUniqueOrThrow({ where: { pageId: initial.pageIds[0] } })).agentId,
          nextRunAgent,
        );
        assert.equal(await prisma.pageAgentBindingEvent.count({
          where: { spaceId: nextRunFixture.spaceId },
        }), eventsBefore);
        assert.equal(await prisma.collaborationRun.count({
          where: { spaceId: nextRunFixture.spaceId },
        }), runsBeforeFailure);
        const retried = await nextRunService.existingRuns.start(
          nextRunFixture.spaceId,
          initial.rootFolderId,
          rollbackPayload,
          { userId: nextRunFixture.userId, platformRole: 'user' },
        );
        assert.ok(retried.runId);
        assert.equal(
          (await prisma.pageAgentBinding.findUniqueOrThrow({ where: { pageId: initial.pageIds[0] } })).agentId,
          replacementAgent,
        );
        assert.equal(await prisma.pageAgentBindingEvent.count({
          where: { spaceId: nextRunFixture.spaceId },
        }), eventsBefore + 1);
        assert.equal(await prisma.collaborationRun.count({
          where: { spaceId: nextRunFixture.spaceId },
        }), runsBeforeFailure + 1);
      } finally {
        await nextRunService.close();
      }

      const legacyFixture = await createLegacyFixture(prisma, `${schemaName.slice(-8)}_legacy`);
      const legacyVersionBefore = await prisma.pageTemplateVersion.findUniqueOrThrow({
        where: { id: legacyFixture.versionId },
      });
      const legacyService = await createService(prisma, null);
      try {
        const original = await legacyService.service.instantiate(
          legacyFixture.spaceId, legacyFixture.templateId,
          request('legacy-0001', { locale: 'zh-CN' }),
          { userId: legacyFixture.userId, platformRole: 'user' },
        );
        const originalPage = await prisma.page.findUniqueOrThrow({ where: { id: original.pageIds[0] } });
        assert.equal(original.rootFolderId, null);
        assert.equal(originalPage.title, '旧模板页面');
        assert.equal(originalPage.content, '# 不可变旧正文');
        assert.equal(originalPage.sourceTemplateLocale, 'zh-CN');

        const renamed = await legacyService.service.instantiate(
          legacyFixture.spaceId, legacyFixture.templateId,
          request('legacy-0002', {
            locale: 'en', rootName: 'Renamed legacy page', expectedTreeRevision: 1n,
          }),
          { userId: legacyFixture.userId, platformRole: 'user' },
        );
        const renamedPage = await prisma.page.findUniqueOrThrow({ where: { id: renamed.pageIds[0] } });
        assert.equal(renamedPage.title, 'Renamed legacy page');
        assert.equal(renamedPage.content, '# Immutable legacy body');
        assert.equal(renamedPage.sourceTemplateLocale, 'en');
        const legacyVersionAfter = await prisma.pageTemplateVersion.findUniqueOrThrow({
          where: { id: legacyFixture.versionId },
        });
        assert.deepEqual(legacyVersionAfter, legacyVersionBefore);
        assert.deepEqual(legacyVersionAfter.contentI18n, legacyFixture.contentI18n);
        assert.equal(legacyVersionAfter.definition, null);
      } finally {
        await legacyService.close();
      }
    } finally {
      await prisma.$disconnect();
    }
  });
});
