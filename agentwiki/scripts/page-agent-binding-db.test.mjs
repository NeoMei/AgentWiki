import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { withPageTemplateTestDatabase } from './page-template-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { AuthorizationService } = requireFromServer('./dist/core/authorization/authorization.service.js');
const { PageAgentBindingService } = requireFromServer(
  './dist/page-templates/page-agent-binding.service.js',
);

const baseDatabaseUrl = process.env.PAGE_TEMPLATE_TEST_DATABASE_URL;
if (!baseDatabaseUrl) throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL is required');

test('PageAgentBinding batch rolls back every binding and audit event on a later failure', {
  timeout: 120_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = `${schemaName.slice(-8)}_${randomUUID().slice(0, 8)}`;
    const humanId = `binding_human_${suffix}`;
    const agentOwnerId = `binding_owner_${suffix}`;
    const agentId = `binding_agent_${suffix}`;
    const spaceId = `binding_space_${suffix}`;
    const pageIds = [`binding_page_a_${suffix}`, `binding_page_b_${suffix}`];
    try {
      await prisma.user.createMany({ data: [
        { id: humanId, email: `${humanId}@example.test`, type: 'human' },
        { id: agentOwnerId, email: `${agentOwnerId}@example.test`, type: 'human' },
      ] });
      await prisma.space.create({ data: { id: spaceId, name: 'Binding rollback fixture', slug: spaceId } });
      await prisma.spaceMember.createMany({ data: [
        { userId: humanId, spaceId, role: 'editor' },
        { userId: agentOwnerId, spaceId, role: 'owner' },
      ] });
      await prisma.agent.create({ data: {
        id: agentId, ownerId: agentOwnerId, name: 'Offline compliant Agent', status: 'active',
      } });
      const grant = await prisma.agentGrant.create({ data: { agentId, spaceId, role: 'editor' } });
      await prisma.agentCredential.create({ data: {
        id: `binding_credential_${suffix}`,
        name: 'Valid but unused session credential',
        prefix: `binding_${suffix}`,
        keyHash: `binding_hash_${suffix}`,
        agentId,
        authorizationId: grant.id,
        lastUsedAt: null,
      } });
      await prisma.page.createMany({ data: pageIds.map((pageId, index) => ({
        id: pageId,
        title: `Binding page ${index + 1}`,
        slug: `binding-page-${index + 1}-${suffix}`,
        content: '',
        format: 'markdown',
        spaceId,
        authorId: humanId,
        syncPath: `pages/binding-page-${index + 1}-${suffix}.md`,
        syncPathKey: `pages/binding-page-${index + 1}-${suffix}.md`,
      })) });

      const interceptedPrisma = new Proxy(prisma, {
        get(target, property) {
          if (property !== '$transaction') {
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return (callback, options) => target.$transaction(async (tx) => {
            let eventCount = 0;
            const events = new Proxy(tx.pageAgentBindingEvent, {
              get(delegate, property) {
                if (property !== 'create') return Reflect.get(delegate, property);
                return async (...args) => {
                  eventCount += 1;
                  if (eventCount === 2) throw new Error('injected second binding audit failure');
                  return delegate.create(...args);
                };
              },
            });
            const intercepted = new Proxy(tx, {
              get(transaction, property) {
                return property === 'pageAgentBindingEvent'
                  ? events
                  : Reflect.get(transaction, property);
              },
            });
            return callback(intercepted);
          }, options);
        },
      });
      const contentTree = {
        async lockPageMutationSpace(tx, requestedSpaceId, expectedTreeRevision) {
          await tx.$executeRawUnsafe(
            'SELECT pg_advisory_xact_lock(hashtext($1))', requestedSpaceId,
          );
          const space = await tx.space.findUniqueOrThrow({ where: { id: requestedSpaceId } });
          assert.equal(space.contentTreeRevision, expectedTreeRevision);
          return tx;
        },
      };
      const service = new PageAgentBindingService(
        interceptedPrisma,
        new AuthorizationService(interceptedPrisma),
        contentTree,
      );
      await assert.rejects(service.setBindingsInScope(spaceId, {
        pageIds,
        expectedTreeRevision: 0n,
        edits: pageIds.map((pageId) => ({
          pageId,
          agentId,
          roleSlotKey: 'writer',
          expectedUpdatedAt: null,
        })),
      }, { userId: humanId, platformRole: 'user' }), /injected second binding audit failure/u);

      assert.equal(await prisma.pageAgentBinding.count({ where: { spaceId } }), 0);
      assert.equal(await prisma.pageAgentBindingEvent.count({ where: { spaceId } }), 0);
      assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 0n);
    } finally {
      await prisma.$disconnect();
    }
  });
});
