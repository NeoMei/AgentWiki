import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { withCollaborationTestDatabase } from './collaboration-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient, Prisma } = requireFromServer('@prisma/client');

const baseDatabaseUrl = process.env.DATABASE_URL;

test('relation coordination primitives survive concurrent manual, auto, and refresh writers', {
  skip: baseDatabaseUrl ? false : 'DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => withCollaborationTestDatabase(baseDatabaseUrl, async ({ databaseUrl }) => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomUUID();
  const userId = `relation-u-${suffix}`;
  const spaceId = `relation-s-${suffix}`;
  const sourcePageId = `relation-src-${suffix}`;
  const targetPageId = `relation-tgt-${suffix}`;

  async function createRelationLike(relation) {
    return prisma.$transaction(async (tx) => {
      await tx.spaceGraphState.upsert({ where: { spaceId }, create: { spaceId }, update: {} });
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${spaceId} FOR UPDATE`);
      const existing = await tx.knowledgeRelation.findUnique({
        where: {
          sourcePageId_targetPageId_relation: { sourcePageId, targetPageId, relation },
        },
      });
      if (existing?.origin.startsWith('auto_')) {
        return tx.knowledgeRelation.update({
          where: { id: existing.id },
          data: { origin: 'manual', lastModifiedAt: new Date() },
        });
      }
      return tx.knowledgeRelation.create({
        data: { relation, sourcePageId, targetPageId },
      });
    });
  }

  try {
    await prisma.user.create({ data: { id: userId, email: `${suffix}@relation.test` } });
    await prisma.space.create({ data: { id: spaceId, name: 'Relation DB test', slug: `relation-${suffix}` } });
    await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
    await prisma.page.createMany({ data: [
      {
        id: sourcePageId, title: 'Source', slug: `rsrc-${suffix}`, spaceId, authorId: userId,
        syncPath: `pages/rsrc-${suffix}.md`, syncPathKey: `rsrc-${suffix}`,
      },
      {
        id: targetPageId, title: 'Target', slug: `rtgt-${suffix}`, spaceId, authorId: userId,
        syncPath: `pages/rtgt-${suffix}.md`, syncPathKey: `rtgt-${suffix}`,
      },
    ] });

    const manualResults = await Promise.allSettled(
      Array.from({ length: 8 }, () => createRelationLike('supports')),
    );
    const manualRows = await prisma.knowledgeRelation.count({
      where: { sourcePageId, targetPageId, relation: 'supports' },
    });
    assert.equal(manualRows, 1, 'concurrent identical manual creates must leave exactly one row');
    const manualFailures = manualResults
      .filter((result) => result.status === 'rejected')
      .map((result) => String(result.reason?.code ?? result.reason));
    assert.ok(
      manualFailures.every((code) => code.includes('P2002')),
      `unexpected manual race failures: ${JSON.stringify(manualFailures)}`,
    );

    const autoResults = await Promise.allSettled(Array.from({ length: 8 }, () =>
      prisma.knowledgeRelation.createMany({
        data: {
          id: randomUUID(), sourcePageId, targetPageId, relation: 'extends',
          origin: 'auto_llm', strength: 0.7, confidence: 0.8,
        },
        skipDuplicates: true,
      })));
    const autoRows = await prisma.knowledgeRelation.count({
      where: { sourcePageId, targetPageId, relation: 'extends' },
    });
    assert.equal(autoRows, 1, 'concurrent skip-duplicates proposals must leave exactly one row');
    assert.deepEqual(autoResults.map((result) => result.status), Array.from({ length: 8 }, () => 'fulfilled'));

    await Promise.allSettled([
      ...Array.from({ length: 4 }, () =>
        prisma.knowledgeRelation.createMany({
          data: {
            id: randomUUID(), sourcePageId, targetPageId, relation: 'related_to',
            origin: 'auto_llm', strength: 0.7,
          },
          skipDuplicates: true,
        })),
      ...Array.from({ length: 4 }, () => createRelationLike('related_to')),
    ]);
    const mixedRows = await prisma.knowledgeRelation.count({
      where: { sourcePageId, targetPageId, relation: 'related_to' },
    });
    assert.equal(mixedRows, 1, 'mixed auto/manual writers must converge on exactly one row');

    const refreshLike = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${spaceId} FOR UPDATE`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await tx.spaceGraphState.update({
        where: { spaceId },
        data: { lastContentHash: `stress-${Date.now()}` },
      });
    });
    const interleaved = await Promise.allSettled([
      refreshLike,
      ...Array.from({ length: 3 }, () => createRelationLike('supports')),
    ]);
    const hardFailures = interleaved
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
      .filter((reason) => !String(reason?.code ?? reason).includes('P2002'));
    assert.deepEqual(hardFailures, [], 'refresh and relation writers must not deadlock or time out');
  } finally {
    await prisma.knowledgeRelation.deleteMany({
      where: { OR: [{ sourcePageId }, { targetPageId }] },
    });
    await prisma.spaceGraphState.deleteMany({ where: { spaceId } });
    await prisma.page.deleteMany({ where: { spaceId } });
    await prisma.spaceMember.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
}));
