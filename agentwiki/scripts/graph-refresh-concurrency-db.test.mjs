import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');

const databaseUrl = process.env.DATABASE_URL;

test('graph coordination primitives serialize locks and atomically skip competing claims', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
  timeout: 30_000,
}, async () => {
  const first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomUUID();
  const userId = `graph-user-${suffix}`;
  const spaceId = `graph-space-${suffix}`;
  const sourcePageId = `graph-source-${suffix}`;
  const targetPageId = `graph-target-${suffix}`;

  try {
    await first.user.create({ data: { id: userId, email: `${suffix}@graph.test` } });
    await first.space.create({ data: { id: spaceId, name: 'Graph DB test', slug: `graph-${suffix}` } });
    await first.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
    await first.page.createMany({ data: [
      {
        id: sourcePageId, title: 'Source', slug: `source-${suffix}`, spaceId, authorId: userId,
        syncPath: `pages/source-${suffix}.md`, syncPathKey: `source-${suffix}`,
      },
      {
        id: targetPageId, title: 'Target', slug: `target-${suffix}`, spaceId, authorId: userId,
        syncPath: `pages/target-${suffix}.md`, syncPathKey: `target-${suffix}`,
      },
    ] });
    await first.spaceGraphState.create({ data: { spaceId } });

    const now = new Date();
    const claims = await Promise.all([
      first.spaceGraphState.updateMany({
        where: { spaceId, lastLlmRunAt: null },
        data: { lastLlmRunAt: now },
      }),
      second.spaceGraphState.updateMany({
        where: { spaceId, lastLlmRunAt: null },
        data: { lastLlmRunAt: now },
      }),
    ]);
    assert.deepEqual(claims.map((claim) => claim.count).sort(), [0, 1]);

    const relationData = {
      sourcePageId,
      targetPageId,
      relation: 'extends',
      strength: 1,
      confidence: 0.8,
    };
    const automatic = await first.knowledgeRelation.createMany({
      data: { id: randomUUID(), ...relationData, origin: 'auto_llm' },
      skipDuplicates: true,
    });
    assert.equal(automatic.count, 1);
    await second.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${spaceId} FOR UPDATE`;
      const existing = await tx.knowledgeRelation.findUnique({
        where: { sourcePageId_targetPageId_relation: {
          sourcePageId, targetPageId, relation: relationData.relation,
        } },
      });
      assert.equal(existing.origin, 'auto_llm');
      await tx.knowledgeRelation.update({ where: { id: existing.id }, data: { origin: 'compiled' } });
    });
    const automaticRetry = await first.knowledgeRelation.createMany({
      data: { id: randomUUID(), ...relationData, origin: 'auto_llm' },
      skipDuplicates: true,
    });
    assert.equal(automaticRetry.count, 0);
    const winner = await first.knowledgeRelation.findUnique({
      where: { sourcePageId_targetPageId_relation: {
        sourcePageId, targetPageId, relation: relationData.relation,
      } },
    });
    assert.equal(winner.origin, 'compiled');

    let releaseLock;
    let reportLocked;
    const locked = new Promise((resolve) => { reportLocked = resolve; });
    const release = new Promise((resolve) => { releaseLock = resolve; });
    const holder = first.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${spaceId} FOR UPDATE`;
      reportLocked();
      await release;
    }, { timeout: 5_000 });
    await locked;

    let waiterFinished = false;
    const waiter = second.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${spaceId} FOR UPDATE`;
      waiterFinished = true;
    }, { timeout: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(waiterFinished, false);
    releaseLock();
    await Promise.all([holder, waiter]);
    assert.equal(waiterFinished, true);
  } finally {
    await first.space.deleteMany({ where: { id: spaceId } });
    await first.user.deleteMany({ where: { id: userId } });
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  }
});
