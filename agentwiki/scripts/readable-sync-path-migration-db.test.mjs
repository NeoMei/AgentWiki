import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  return new PrismaClient({
    datasources: { db: { url: url.href } },
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
}

function withApplicationName(url, applicationName) {
  const named = new URL(url.href);
  named.searchParams.set('application_name', applicationName);
  return named;
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function waitForCondition(check, description, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function withTimeout(promise, description, timeoutMs = 5_000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${description}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
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
    $transaction: (callback, options) => prisma.$transaction(async (tx) => {
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
    }, options),
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
          { knowledgeKey: 'page-d', title: `p-${'f'.repeat(64)}`, syncPath: opaquePath('e'), content: 'opaque title' },
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
      assert.equal(result.migrated, 3);
      assert.ok(result.revisionId);

      const after = await prisma.page.findMany({
        where: { spaceId: seeded.spaceId },
        orderBy: { knowledgeKey: 'asc' },
      });
      assert.deepEqual(
        after.map((page) => page.syncPath),
        [
          'pages/吃饭睡觉.md',
          'pages/吃饭睡觉 (2).md',
          'custom/Keep.md',
          `pages/p-${'f'.repeat(64)} (2).md`,
        ],
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
      assert.equal(versions.length, 3);
      assert.deepEqual(
        versions.map((version) => version.syncPath),
        [opaquePath('a'), opaquePath('b'), opaquePath('e')],
      );

      const revision = await prisma.spaceKnowledgeRevision.findUnique({
        where: { id: result.revisionId },
      });
      assert.equal(revision.origin, 'migration');
      assert.equal(revision.migrationBatchId, batchId);
      const deltaRows = await prisma.syncRevisionDeltaRow.findMany({
        where: { revisionId: result.revisionId },
        orderBy: { ordinal: 'asc' },
      });
      assert.deepEqual(
        deltaRows.map((row) => row.operation),
        ['upsert', 'upsert', 'upsert', 'upsert'],
      );
      const revisionRows = await prisma.syncRevisionPageRow.findMany({
        where: { revisionId: result.revisionId },
        orderBy: { pageId: 'asc' },
      });
      assert.deepEqual(
        revisionRows.map((row) => row.path),
        [
          'pages/吃饭睡觉.md',
          'pages/吃饭睡觉 (2).md',
          'custom/Keep.md',
          `pages/p-${'f'.repeat(64)} (2).md`,
        ],
      );

      const second = await migrateReadablePathsForSpace(prisma, seeded.spaceId, batchId);
      assert.deepEqual(second, { migrated: 0, revisionId: result.revisionId });
      assert.equal(await prisma.pageVersion.count({ where: { migrationBatchId: batchId } }), 3);
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

test('web create and readable migration wait before allocating the same title', { skip, timeout: 25_000 }, async () => {
  const schema = `readable_paths_concurrency_${randomUUID().replaceAll('-', '')}`;
  const quoted = `"${schema}"`;
  let blockerPrisma;
  let pagePrisma;
  let migrationPrisma;
  let blockerOutcome;
  let pageOutcome;
  let migrationOutcome;
  let releaseBlocker = () => {};
  let blockerApplication;
  let pageApplication;
  let migrationApplication;
  let allocatorPrototype;
  let originalAllocate;
  try {
    const url = deploySchema(schema);
    const prisma = loadPrisma(url);
    try {
      const seeded = await seedSpace(prisma, {
        name: 'ConcurrentReadable',
        pages: [{
          knowledgeKey: 'migration-page',
          title: '标题',
          syncPath: opaquePath('f'),
          content: 'migration body',
        }],
      });
      const [
        { PageService },
        { ReadableSyncPathService },
        { SpaceRevisionWriterService },
      ] = await Promise.all([
        import(pathToFileURL(resolve(root, 'apps/server/dist/core/page/page.service.js')).href),
        import(pathToFileURL(resolve(root, 'apps/server/dist/core/sync/readable-sync-path.service.js')).href),
        import(pathToFileURL(resolve(root, 'apps/server/dist/core/sync/space-revision-writer.service.js')).href),
      ]);
      const runId = randomUUID().replaceAll('-', '');
      blockerApplication = `fix2_blocker_${runId}`;
      pageApplication = `fix2_page_${runId}`;
      migrationApplication = `fix2_migration_${runId}`;
      blockerPrisma = loadPrisma(withApplicationName(url, blockerApplication));
      pagePrisma = loadPrisma(withApplicationName(url, pageApplication));
      migrationPrisma = loadPrisma(withApplicationName(url, migrationApplication));
      const allocatorContext = new AsyncLocalStorage();
      const allocatorCalls = [];
      allocatorPrototype = ReadableSyncPathService.prototype;
      originalAllocate = ReadableSyncPathService.prototype.allocate;
      ReadableSyncPathService.prototype.allocate = async function (...args) {
        allocatorCalls.push(allocatorContext.getStore() ?? 'unknown');
        return originalAllocate.apply(this, args);
      };
      const writer = new SpaceRevisionWriterService(pagePrisma);
      const allocator = new ReadableSyncPathService();
      const pageService = new PageService(
        pagePrisma,
        { indexPage: async () => ({ lexicalIndexed: true, semanticIndexed: false }) },
        writer,
        allocator,
      );
      const batchId = `readable-sync-path-v1:${seeded.spaceId}`;
      const { migrateReadablePathsForSpace } = await import('./migrate-readable-sync-paths.mjs');
      const blockerRelease = deferred();
      releaseBlocker = blockerRelease.resolve;
      let blockerHasLock = false;
      let blockerFailure;

      blockerOutcome = blockerPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          seeded.spaceId,
        );
        blockerHasLock = true;
        await blockerRelease.promise;
      }, { maxWait: 10_000, timeout: 20_000 });
      blockerOutcome.catch((error) => {
        blockerFailure = error;
      });
      await waitForCondition(
        () => {
          if (blockerFailure) throw blockerFailure;
          return blockerHasLock ? true : null;
        },
        'the external advisory-lock blocker',
      );

      pageOutcome = allocatorContext.run(
        'page',
        () => pageService.create(
          { spaceId: seeded.spaceId, title: '标题', content: 'web body' },
          seeded.userId,
        ),
      );
      migrationOutcome = allocatorContext.run(
        'migration',
        () => migrateReadablePathsForSpace(
          migrationPrisma,
          seeded.spaceId,
          batchId,
        ),
      );

      const waitingEntries = await waitForCondition(async () => {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT application_name, wait_event_type, wait_event
             FROM pg_stat_activity
            WHERE application_name IN ($1, $2)
              AND wait_event_type = 'Lock'
              AND wait_event = 'advisory'`,
          pageApplication,
          migrationApplication,
        );
        return new Set(rows.map((row) => row.application_name)).size === 2
          ? rows
          : null;
      }, 'both real entries to wait on the shared advisory lock');
      assert.deepEqual(
        new Set(waitingEntries.map((row) => row.application_name)),
        new Set([pageApplication, migrationApplication]),
      );
      assert.equal(
        allocatorCalls.length,
        0,
        'both entries must still be waiting before their first allocator call',
      );

      releaseBlocker();
      await blockerOutcome;
      const outcomes = await Promise.allSettled([pageOutcome, migrationOutcome]);

      assert.equal(
        outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
        2,
        outcomes.map((outcome) => outcome.status === 'rejected'
          ? `${outcome.reason?.code ?? 'unknown'}:${outcome.reason?.message ?? outcome.reason}`
          : 'fulfilled').join('\n'),
      );
      assert.equal(
        outcomes.some((outcome) => outcome.status === 'rejected' && outcome.reason?.code === 'P2002'),
        false,
      );
      assert.deepEqual(
        allocatorCalls.slice().sort(),
        ['migration', 'page'],
        'each real entry must call the actual allocator after the blocker is released',
      );
      const pages = await prisma.page.findMany({
        where: { spaceId: seeded.spaceId },
        select: { syncPath: true, syncPathKey: true },
      });
      assert.deepEqual(
        new Set(pages.map((page) => page.syncPath)),
        new Set(['pages/标题.md', 'pages/标题 (2).md']),
      );
      assert.equal(new Set(pages.map((page) => page.syncPathKey)).size, 2);
    } finally {
      if (allocatorPrototype && originalAllocate) {
        allocatorPrototype.allocate = originalAllocate;
      }
      releaseBlocker();
      const applications = [
        blockerApplication,
        pageApplication,
        migrationApplication,
      ].filter(Boolean);
      if (applications.length === 3) {
        await withTimeout(
          prisma.$queryRawUnsafe(
            `SELECT pg_terminate_backend(pid)
               FROM pg_stat_activity
              WHERE application_name IN ($1, $2, $3)
                AND pid <> pg_backend_pid()`,
            ...applications,
          ),
          'named contention-test backend termination',
        ).catch(() => undefined);
      }
      await withTimeout(
        Promise.allSettled([
          blockerOutcome,
          pageOutcome,
          migrationOutcome,
        ].filter(Boolean)),
        'contention-test outcomes to settle',
      ).catch(() => undefined);
      await withTimeout(
        Promise.allSettled([
          blockerPrisma?.$disconnect(),
          pagePrisma?.$disconnect(),
          migrationPrisma?.$disconnect(),
        ].filter(Boolean)),
        'contention-test Prisma clients to disconnect',
      ).catch(() => undefined);
      await withTimeout(
        prisma.$disconnect(),
        'contention-test control Prisma client to disconnect',
      ).catch(() => undefined);
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
