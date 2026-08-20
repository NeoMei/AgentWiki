import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL;
const psqlAvailable = spawnSync('psql', ['--version'], { encoding: 'utf8' }).status === 0;
const skip = !databaseUrl
  ? 'DATABASE_URL is not configured'
  : !psqlAvailable
    ? 'psql is unavailable'
    : false;

function postgresEnvironment(rawUrl) {
  const parsed = new URL(rawUrl);
  const env = { ...process.env };
  delete env.DATABASE_URL;
  env.PGHOST = parsed.hostname;
  env.PGPORT = parsed.port || '5432';
  env.PGDATABASE = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  env.PGUSER = decodeURIComponent(parsed.username);
  env.PGPASSWORD = decodeURIComponent(parsed.password);
  return env;
}

function runPsql(sql) {
  return spawnSync('psql', ['-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    env: postgresEnvironment(databaseUrl),
  });
}

function deploySchema(schema) {
  assert.equal(runPsql(`CREATE SCHEMA "${schema}"`).status, 0);
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  const deploy = spawnSync(
    'pnpm',
    ['--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url.href },
    },
  );
  assert.equal(
    deploy.status,
    0,
    `migrate deploy failed:\n${deploy.stdout}\n${deploy.stderr}`,
  );
  return url;
}

function loadPrisma(url) {
  const require = createRequire(resolve(root, 'apps/server/package.json'));
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ datasources: { db: { url: url.href } } });
}

function opaquePath(character) {
  return `pages/p-${character.repeat(64)}.md`;
}

function bodyHash(body) {
  return createHash('sha256').update(body).digest('hex');
}

async function seedSpace(prisma, { name, pages }) {
  const spaceId = randomUUID();
  const userId = randomUUID();
  await prisma.space.create({
    data: { id: spaceId, name, slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}` },
  });
  await prisma.user.create({
    data: { id: userId, email: `${randomUUID()}@migration.test`, type: 'human' },
  });
  for (const [index, page] of pages.entries()) {
    await prisma.page.create({
      data: {
        id: randomUUID(),
        knowledgeKey: page.knowledgeKey,
        title: page.title,
        slug: `${name.toLowerCase()}-${index}`,
        content: page.content,
        format: 'markdown',
        spaceId,
        authorId: userId,
        syncPath: page.syncPath,
        syncPathKey: page.syncPath.toLocaleLowerCase('und'),
        lastModifiedByUserId: userId,
        lastModifiedAt: new Date(),
      },
    });
  }
  return { spaceId, userId };
}

function failOnSecondPageUpdate(prisma) {
  return {
    $transaction: (callback) => prisma.$transaction(async (tx) => {
      let updates = 0;
      const page = new Proxy(tx.page, {
        get(target, property, receiver) {
          if (property !== 'update') return Reflect.get(target, property, receiver);
          return async (args) => {
            updates += 1;
            if (updates === 2) throw new Error('forced migration update failure');
            return target.update(args);
          };
        },
      });
      const wrapped = new Proxy(tx, {
        get(target, property, receiver) {
          return property === 'page' ? page : Reflect.get(target, property, receiver);
        },
      });
      return callback(wrapped);
    }),
  };
}

test('opaque-path migration is readable, idempotent, and atomic', { skip }, async () => {
  const schema = `readable_paths_${randomUUID().replaceAll('-', '')}`;
  const quoted = `"${schema}"`;
  try {
    const url = deploySchema(schema);
    const prisma = loadPrisma(url);
    try {
      const seeded = await seedSpace(prisma, {
        name: 'Readable',
        pages: [
          { knowledgeKey: 'page-a', title: '吃饭睡觉', syncPath: opaquePath('a'), content: '# 吃饭睡觉' },
          { knowledgeKey: 'page-b', title: '吃饭睡觉', syncPath: opaquePath('b'), content: '正文' },
          { knowledgeKey: 'page-c', title: 'Keep', syncPath: 'custom/Keep.md', content: 'keep' },
        ],
      });
      const before = await prisma.page.findMany({
        where: { spaceId: seeded.spaceId },
        orderBy: { knowledgeKey: 'asc' },
      });
      const identity = before.map((page) => ({
        knowledgeKey: page.knowledgeKey,
        title: page.title,
        content: page.content,
        hash: bodyHash(page.content),
      }));
      const batchId = `readable-sync-path-v1:${seeded.spaceId}`;
      const { migrateReadablePathsForSpace } = await import('./migrate-readable-sync-paths.mjs');

      const result = await migrateReadablePathsForSpace(prisma, seeded.spaceId, batchId);
      assert.equal(result.migrated, 2);
      assert.ok(result.revisionId);

      const after = await prisma.page.findMany({
        where: { spaceId: seeded.spaceId },
        orderBy: { knowledgeKey: 'asc' },
      });
      assert.deepEqual(
        after.map((page) => page.syncPath),
        ['pages/吃饭睡觉.md', 'pages/吃饭睡觉 (2).md', 'custom/Keep.md'],
      );
      assert.deepEqual(
        after.map((page) => ({
          knowledgeKey: page.knowledgeKey,
          title: page.title,
          content: page.content,
          hash: bodyHash(page.content),
        })),
        identity,
      );

      const versions = await prisma.pageVersion.findMany({
        where: { migrationBatchId: batchId },
        orderBy: { page: { knowledgeKey: 'asc' } },
      });
      assert.equal(versions.length, 2);
      assert.deepEqual(versions.map((version) => version.syncPath), [opaquePath('a'), opaquePath('b')]);

      const revision = await prisma.spaceKnowledgeRevision.findUnique({
        where: { id: result.revisionId },
      });
      assert.equal(revision.origin, 'migration');
      assert.equal(revision.migrationBatchId, batchId);
      const deltaRows = await prisma.syncRevisionDeltaRow.findMany({
        where: { revisionId: result.revisionId },
        orderBy: { ordinal: 'asc' },
      });
      assert.deepEqual(deltaRows.map((row) => row.operation), ['upsert', 'upsert']);
      const revisionRows = await prisma.syncRevisionPageRow.findMany({
        where: { revisionId: result.revisionId },
        orderBy: { pageId: 'asc' },
      });
      assert.deepEqual(
        revisionRows.map((row) => row.path),
        ['pages/吃饭睡觉.md', 'pages/吃饭睡觉 (2).md'],
      );

      const second = await migrateReadablePathsForSpace(prisma, seeded.spaceId, batchId);
      assert.deepEqual(second, { migrated: 0, revisionId: null });
      assert.equal(await prisma.pageVersion.count({ where: { migrationBatchId: batchId } }), 2);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId: seeded.spaceId } }), 1);

      const rollback = await seedSpace(prisma, {
        name: 'Rollback',
        pages: [
          { knowledgeKey: 'rollback-a', title: 'One', syncPath: opaquePath('c'), content: 'one' },
          { knowledgeKey: 'rollback-b', title: 'Two', syncPath: opaquePath('d'), content: 'two' },
        ],
      });
      const rollbackBefore = await prisma.page.findMany({
        where: { spaceId: rollback.spaceId },
        orderBy: { knowledgeKey: 'asc' },
      });
      const rollbackBatch = `readable-sync-path-v1:${rollback.spaceId}`;
      await assert.rejects(
        () => migrateReadablePathsForSpace(
          failOnSecondPageUpdate(prisma),
          rollback.spaceId,
          rollbackBatch,
        ),
        /forced migration update failure/,
      );
      const rollbackAfter = await prisma.page.findMany({
        where: { spaceId: rollback.spaceId },
        orderBy: { knowledgeKey: 'asc' },
      });
      assert.deepEqual(
        rollbackAfter.map((page) => page.syncPath),
        rollbackBefore.map((page) => page.syncPath),
      );
      assert.equal(await prisma.pageVersion.count({ where: { migrationBatchId: rollbackBatch } }), 0);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId: rollback.spaceId } }), 0);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
