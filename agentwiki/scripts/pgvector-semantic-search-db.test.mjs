import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient, Prisma } = requireFromServer('@prisma/client');

const databaseUrl = process.env.DATABASE_URL;

test('pgvector semantic search uses halfvec HNSW with cosine distance and hash short-circuit', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomUUID();
  const userId = `pgv-u-${suffix}`;
  const spaceId = `pgv-s-${suffix}`;
  const pageA = `pgv-a-${suffix}`;
  const pageB = `pgv-b-${suffix}`;

  try {
    await prisma.user.create({ data: { id: userId, email: `${suffix}@pgv.test` } });
    await prisma.space.create({ data: { id: spaceId, name: 'pgvector', slug: `pgv-${suffix}` } });
    await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });

    const near = Array.from({ length: 2048 }, (_, i) => (i % 2 === 0 ? 0.9 : 0.1));
    const far = Array.from({ length: 2048 }, (_, i) => (i % 2 === 0 ? 0.1 : 0.9));
    await prisma.page.createMany({ data: [
      { id: pageA, title: 'Near concept', slug: 'near-' + suffix, content: 'body', spaceId, authorId: userId, syncPath: 'pages/near-' + suffix + '.md', syncPathKey: 'near-' + suffix },
      { id: pageB, title: 'Far concept', slug: 'far-' + suffix, content: 'body', spaceId, authorId: userId, syncPath: 'pages/far-' + suffix + '.md', syncPathKey: 'far-' + suffix },
    ] });
    await prisma.$executeRaw(Prisma.sql`UPDATE "Page" SET "embeddingVector" = ${JSON.stringify(near)}::jsonb::text::halfvec WHERE "id" = ${pageA}`);
    await prisma.$executeRaw(Prisma.sql`UPDATE "Page" SET "embeddingVector" = ${JSON.stringify(far)}::jsonb::text::halfvec WHERE "id" = ${pageB}`);

    const query = near.map(Number).join(',');
    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT "id", 1 - ("embeddingVector" <=> ${'[' + query + ']'}::halfvec) AS "similarity"
      FROM "Page"
      WHERE "deletedAt" IS NULL
        AND "embeddingVector" IS NOT NULL
        AND "spaceId" = ${spaceId}
      ORDER BY "embeddingVector" <=> ${'[' + query + ']'}::halfvec
      LIMIT 2
    `);
    assert.equal(rows[0].id, pageA);
    assert.ok(rows[0].similarity > 0.9, 'near page should exceed 0.9 similarity');
    assert.equal(rows[1].id, pageB);
    assert.ok(rows[1].similarity < rows[0].similarity, 'results must be cosine ordered');

    const [index] = await prisma.$queryRaw(Prisma.sql`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'Page_embeddingVector_hnsw'
    `);
    assert.ok(index, 'HNSW index must exist');
    assert.match(index.indexdef, /USING hnsw/);
    assert.match(index.indexdef, /halfvec_cosine_ops/);

    const [dims] = await prisma.$queryRaw(Prisma.sql`
      SELECT atttypmod AS dims FROM pg_attribute
      WHERE attrelid = '"Page"'::regclass AND attname = 'embeddingVector'
    `);
    assert.equal(dims.dims, 2048, 'embeddingVector must be halfvec(2048)');
  } finally {
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "Page" WHERE "spaceId" = ${spaceId}`);
    await prisma.spaceMember.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
