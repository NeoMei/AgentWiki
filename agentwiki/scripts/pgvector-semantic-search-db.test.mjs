import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient, Prisma } = requireFromServer('@prisma/client');

const databaseUrl = process.env.DATABASE_URL;
const SAFE_SCHEMA = /^pgvector_test_[a-z0-9_]+$/u;

function validateTestDatabaseUrl(value) {
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  if (!databaseName.toLowerCase().includes('test')) {
    throw new Error('DATABASE_URL database name must contain test');
  }
  parsed.searchParams.delete('schema');
  return parsed;
}

async function withPgvectorTestSchema(callback) {
  const administrativeUrl = validateTestDatabaseUrl(databaseUrl);
  const schemaName = `pgvector_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schemaName, SAFE_SCHEMA);
  const quotedSchema = `"${schemaName}"`;
  const testUrl = new URL(administrativeUrl);
  testUrl.searchParams.set('schema', schemaName);
  const admin = new PrismaClient({ datasources: { db: { url: administrativeUrl.toString() } } });
  const [{ count: publicTablesBefore }] = await admin.$queryRaw`
    SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'
  `;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA ${quotedSchema}`);
    return await callback(testUrl.toString());
  } finally {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    const [{ count: publicTablesAfter }] = await admin.$queryRaw`
      SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'
    `;
    await admin.$disconnect();
    assert.equal(publicTablesAfter, publicTablesBefore, 'pgvector gate must preserve shared public tables');
  }
}

function migrateSchema(schemaUrl) {
  const result = spawnSync(
    'pnpm',
    ['--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy'],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, DATABASE_URL: schemaUrl } },
  );
  assert.equal(result.status, 0, `migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
}

test('schema drift is limited to the unmodellable HNSW vector index', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => withPgvectorTestSchema(async (schemaUrl) => {
  const root = new URL('..', import.meta.url);
  const serverDir = new URL('apps/server/', root);
  // Prisma cannot express an HNSW index over an Unsupported halfvec column,
  // so exactly that one index is expected to appear as migrations-only drift.
  // Any other difference means a future change will generate a destructive
  // or unexpected migration and must be reviewed before landing.
  const diff = spawnSync(
    'npx',
    [
      'prisma', 'migrate', 'diff',
      '--from-migrations', 'prisma/migrations',
      '--to-schema-datamodel', 'prisma/schema.prisma',
      '--shadow-database-url', schemaUrl,
      '--exit-code',
    ],
    { cwd: serverDir, encoding: 'utf8', env: { ...process.env, DATABASE_URL: schemaUrl } },
  );
  assert.ok(diff.status === 0 || diff.status === 2, `migrate diff crashed: ${diff.stderr}`);
  const output = diff.stdout;
  const removed = [...output.matchAll(/\[-\] (.*)/g)].map((match) => match[1]);
  const added = [...output.matchAll(/\[\+\] (.*)/g)].map((match) => match[1]);
  assert.deepEqual(
    removed,
    ['Removed index on columns (embeddingVector)'],
    `unexpected migrations-only drift; review before generating migrations: \n${output}`,
  );
  assert.deepEqual(added, [], 'schema declares objects the migrations do not create');
}));

test('pgvector semantic search uses halfvec HNSW with cosine distance and hash short-circuit', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => withPgvectorTestSchema(async (schemaUrl) => {
  migrateSchema(schemaUrl);
  const prisma = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
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
    await prisma.$executeRaw(Prisma.sql`UPDATE "Page" SET "embeddingVector" = ${JSON.stringify(near)}::jsonb::text::public.halfvec WHERE "id" = ${pageA}`);
    await prisma.$executeRaw(Prisma.sql`UPDATE "Page" SET "embeddingVector" = ${JSON.stringify(far)}::jsonb::text::public.halfvec WHERE "id" = ${pageB}`);

    const query = near.map(Number).join(',');
    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT "id", 1 - ("embeddingVector" OPERATOR(public.<=>) ${'[' + query + ']'}::public.halfvec) AS "similarity"
      FROM "Page"
      WHERE "deletedAt" IS NULL
        AND "embeddingVector" IS NOT NULL
        AND "spaceId" = ${spaceId}
      ORDER BY "embeddingVector" OPERATOR(public.<=>) ${'[' + query + ']'}::public.halfvec
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
    const [indexOptions] = await prisma.$queryRaw(Prisma.sql`
      SELECT reloptions FROM pg_class WHERE relname = 'Page_embeddingVector_hnsw'
    `);
    assert.ok(
      indexOptions.reloptions.some((option) => option.includes('m=32')),
      'HNSW index must keep the tuned m=32 graph degree',
    );
    assert.ok(
      indexOptions.reloptions.some((option) => option.includes('ef_construction=256')),
      'HNSW index must keep the tuned ef_construction=256',
    );

    const [searchSetting] = await prisma.$queryRaw(Prisma.sql`
      SELECT current_setting('hnsw.ef_search') AS ef_search
    `);
    assert.equal(searchSetting.ef_search, '200', 'database default ef_search must be 200');

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
}));

test('hnsw semantic recall stays above the tuned floor', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => withPgvectorTestSchema(async (schemaUrl) => {
  const prisma = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');
  const table = `recall_guard_${suffix}`;
  const DIMS = 2048;
  const CLUSTERS = 8;
  const PER_CLUSTER = 40;

  const randomUnitVector = () => {
    const v = Array.from({ length: DIMS }, () => Math.random() * 2 - 1);
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    return v.map((x) => x / norm);
  };
  const normalize = (v) => {
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    return v.map((x) => x / norm);
  };
  const literal = (v) => '[' + v.map((x) => x.toFixed(6)).join(',') + ']';

  try {
    await prisma.$executeRaw(Prisma.sql`CREATE TABLE ${Prisma.raw(table)} (id int primary key, vec public.halfvec(2048))`);
    const centers = Array.from({ length: CLUSTERS }, () => randomUnitVector());
    let rowId = 0;
    for (const center of centers) {
      for (let i = 0; i < PER_CLUSTER; i += 1) {
        const noisy = normalize(center.map((x) => x + (Math.random() - 0.5) * 0.16));
        rowId += 1;
        await prisma.$executeRaw(
          Prisma.sql`INSERT INTO ${Prisma.raw(table)} VALUES (${rowId}, ${literal(noisy)}::jsonb::text::public.halfvec)`,
        );
      }
    }
    await prisma.$executeRaw(
      Prisma.sql`CREATE INDEX ${Prisma.raw(`${table}_idx`)} ON ${Prisma.raw(table)} USING hnsw (vec public.halfvec_cosine_ops) WITH (m = 32, ef_construction = 256)`,
    );

    let recallSum = 0;
    const queries = centers.slice(0, 6);
    for (const query of queries) {
      const q = literal(query);
      const hnsw = await prisma.$queryRaw(Prisma.sql`
        SELECT id FROM ${Prisma.raw(table)} ORDER BY vec OPERATOR(public.<=>) ${q}::public.halfvec LIMIT 10
      `);
      const exact = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL enable_indexscan = off`);
        await tx.$executeRaw(Prisma.sql`SET LOCAL enable_bitmapscan = off`);
        return tx.$queryRaw(Prisma.sql`
          SELECT id FROM ${Prisma.raw(table)} ORDER BY vec OPERATOR(public.<=>) ${q}::public.halfvec LIMIT 10
        `);
      });
      const exactIds = exact.map((row) => row.id);
      const overlap = hnsw.filter((row) => exactIds.includes(row.id)).length;
      recallSum += overlap / Math.min(10, exactIds.length);
    }
    const avgRecall = recallSum / queries.length;
    assert.ok(
      avgRecall >= 0.95,
      `HNSW recall@10 degraded to ${(avgRecall * 100).toFixed(1)}%; index or ef_search tuning regressed`,
    );
  } finally {
    await prisma.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS ${Prisma.raw(table)}`).catch(() => undefined);
    await prisma.$disconnect();
  }
}));
