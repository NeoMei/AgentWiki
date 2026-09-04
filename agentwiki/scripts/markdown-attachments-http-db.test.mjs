import assert from 'node:assert/strict';
import { Blob } from 'node:buffer';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  validateMarkdownTestDatabaseUrl,
  withMarkdownTestDatabase,
} from './markdown-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { FormData } = globalThis;
const baseDatabaseUrl = process.env.MARKDOWN_TEST_DATABASE_URL;
const dedicatedGate = process.env.MARKDOWN_ATTACHMENTS_DEDICATED_GATE === '1';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const RACE_PNG = Buffer.concat([PNG, Buffer.from('race-content')]);

if (dedicatedGate && !baseDatabaseUrl) {
  throw new Error(
    'MARKDOWN_TEST_DATABASE_URL is required for the dedicated Markdown attachment gate',
  );
}

test('HTTP harness cleanup attempts every resource and preserves the primary failure', async () => {
  const calls = [];
  const cleanupErrors = await cleanupAttachmentHarnessResources({
    app: {},
    prisma: {},
    port: 43210,
    storageRoot: '/tmp/agentwiki-attachment-test-injected',
  }, {
    closeApp: async () => { calls.push('app.close'); throw new Error('app close failed'); },
    disconnectPrisma: async () => {
      calls.push('prisma.disconnect');
      throw new Error('disconnect failed');
    },
    releasePort: async () => { calls.push('port.release'); throw new Error('port failed'); },
    removeRoot: async () => { calls.push('root.remove'); throw new Error('remove failed'); },
    verifyRootRemoved: async () => { calls.push('root.verify'); throw new Error('verify failed'); },
  });

  assert.deepEqual(calls, [
    'app.close',
    'prisma.disconnect',
    'port.release',
    'root.remove',
    'root.verify',
  ]);
  assert.equal(cleanupErrors.length, 5);
  const primary = new Error('primary HTTP assertion failed');
  assert.equal(errorWithCleanup(primary, cleanupErrors), primary);
  assert.ok(primary.cause instanceof AggregateError);
  assert.equal(primary.cause.errors.length, 5);
});

test('dedicated Markdown attachment gate builds current server output and enables fail-closed mode', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(
    packageJson.scripts['test:e2e:markdown-db'],
    'node -e "if (!process.env.MARKDOWN_TEST_DATABASE_URL) { '
      + "throw new Error('MARKDOWN_TEST_DATABASE_URL is required for the dedicated Markdown attachment gate'); }\" && "
      + 'pnpm --filter @agentwiki/server build && '
      + 'node scripts/run-node-with-env.mjs MARKDOWN_ATTACHMENTS_DEDICATED_GATE=1 --test '
      + 'scripts/markdown-attachments-schema-db.test.mjs '
      + 'scripts/markdown-attachments-http-db.test.mjs '
      + 'scripts/markdown-resource-resolution-db.test.mjs',
  );
});

function createAdminClient(databaseUrl) {
  const administrativeUrl = validateMarkdownTestDatabaseUrl(databaseUrl);
  administrativeUrl.searchParams.delete('schema');
  return new PrismaClient({ datasources: { db: { url: administrativeUrl.toString() } } });
}

test('capacity lock contenders release a two-connection pool for unrelated PostgreSQL work', {
  skip: baseDatabaseUrl
    ? false
    : 'MARKDOWN_TEST_DATABASE_URL is required; run the dedicated gate to satisfy acceptance',
  timeout: 180_000,
}, async () => {
  let generatedSchema;
  await withMarkdownTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    generatedSchema = schemaName;
    const pooledUrl = new URL(databaseUrl);
    pooledUrl.searchParams.set('connection_limit', '2');
    pooledUrl.searchParams.set('pool_timeout', '2');
    const prisma = new PrismaClient({ datasources: { db: { url: pooledUrl.href } } });
    const { PostgresAttachmentCapacityCoordinator } = await import(
      '../apps/server/dist/attachments/attachment-upload.storage.js'
    );
    const coordinator = new PostgresAttachmentCapacityCoordinator(prisma);
    let releaseWinner;
    let signalWinner;
    const winnerEntered = new Promise((resolve) => { signalWinner = resolve; });
    const winnerRelease = new Promise((resolve) => { releaseWinner = resolve; });
    let winner;
    let contenders = [];
    let unrelatedQuery;
    try {
      winner = coordinator.withLock(async () => {
        signalWinner();
        await winnerRelease;
        return 'winner';
      });
      await winnerEntered;
      contenders = Array.from({ length: 3 }, (_, index) =>
        coordinator.withLock(async () => `contender-${index}`));
      await delay(100);

      const timeout = Symbol('unrelated-query-timeout');
      unrelatedQuery = prisma.$queryRawUnsafe('SELECT 1::int AS value');
      const unrelated = await Promise.race([
        unrelatedQuery,
        delay(750).then(() => timeout),
      ]);

      assert.notEqual(
        unrelated,
        timeout,
        'advisory lock waiters must not occupy both pool connections',
      );
      assert.deepEqual(unrelated, [{ value: 1 }]);
    } finally {
      releaseWinner?.();
      await Promise.allSettled([winner, unrelatedQuery, ...contenders].filter(Boolean));
      await prisma.$disconnect();
    }
  });

  const admin = createAdminClient(baseDatabaseUrl);
  try {
    const [cleanup] = await admin.$queryRawUnsafe(
      'SELECT count(*)::int AS schema_count FROM pg_namespace WHERE nspname = $1',
      generatedSchema,
    );
    assert.equal(cleanup.schema_count, 0);
  } finally {
    await admin.$disconnect();
  }
});

test('real HTTP attachment lifecycle, authorization, quota, storage, and cleanup race', {
  skip: baseDatabaseUrl
    ? false
    : 'MARKDOWN_TEST_DATABASE_URL is required; run the dedicated gate to satisfy acceptance',
  timeout: 180_000,
}, async () => {
  let generatedSchema;
  await withMarkdownTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    generatedSchema = schemaName;
    assert.match(schemaName, /^markdown_test_[a-z0-9_]+$/u);
    assert.notEqual(schemaName, 'public');

    const storageRoot = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-'));
    let app;
    let prisma;
    let port;
    let baseUrl;
    const counts = new Map();

    let primaryError;
    let cleanupErrors;
    try {
      Object.assign(process.env, {
        NODE_ENV: 'test',
        PROCESS_ROLE: 'api',
        DATABASE_URL: databaseUrl,
        REDIS_URL: 'redis://127.0.0.1:6379',
        JWT_SECRET: `attachment-http-jwt-${randomUUID()}-${randomUUID()}`,
        AGENTWIKI_SERVER_PEPPER: `attachment-http-pepper-${randomUUID()}`,
        AGENTWIKI_DEPLOYMENT_SEED: randomBytes(32).toString('base64'),
        LOCAL_SYNC_PACKAGE_VERSION: '0.7.0',
        ATTACHMENT_STORAGE_PATH: storageRoot,
        ATTACHMENT_MAX_SPACE_BYTES: String(PNG.length * 2),
        ATTACHMENT_MIN_FREE_BYTES: '1',
      });

      const { Test } = requireFromServer('@nestjs/testing');
      const { ValidationPipe } = requireFromServer('@nestjs/common');
      const { HttpAdapterHost } = requireFromServer('@nestjs/core');
      const { ConfigService } = requireFromServer('@nestjs/config');
      const { AppModule } = await import('../apps/server/dist/app.module.js');
      const { AllExceptionsFilter } = await import(
        '../apps/server/dist/core/filters/all-exceptions.filter.js'
      );
      const { PrismaService } = await import('../apps/server/dist/database/prisma.service.js');
      const { AttachmentCleanupWorker } = await import(
        '../apps/server/dist/attachments/attachment-cleanup.worker.js'
      );
      const { ATTACHMENT_STORAGE } = await import(
        '../apps/server/dist/attachments/attachment-storage.js'
      );
      const { ATTACHMENT_CONFIG } = await import(
        '../apps/server/dist/attachments/attachment.service.js'
      );

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.useGlobalPipes(new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }));
      app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
      await app.init();
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address();
      assert.equal(typeof address, 'object');
      port = address.port;
      baseUrl = `http://127.0.0.1:${port}/api`;
      process.env.PUBLIC_API_URL = baseUrl;
      prisma = app.get(PrismaService);

      const request = async (path, {
        method = 'GET', token, body, form, expected = [200, 201],
      } = {}) => {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          ...(form === undefined ? {} : { body: form }),
          signal: AbortSignal.timeout(30_000),
        });
        counts.set(response.status, (counts.get(response.status) ?? 0) + 1);
        const text = await response.text();
        let data;
        try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
        assert.ok(
          expected.includes(response.status),
          `${method} ${path} returned ${response.status}: ${text.slice(0, 1_000)}`,
        );
        return { response, data };
      };

      const multipart = (bytes, filename, mimeType) => {
        const form = new FormData();
        form.append('file', new Blob([bytes], { type: mimeType }), filename);
        return form;
      };

      const register = async (label) => {
        const suffix = randomUUID();
        const email = `${label}-${suffix}@example.test`;
        const result = await request('/auth/register', {
          method: 'POST',
          body: { email, password: `Pass-${suffix}!`, name: label },
        });
        assert.match(result.data.access_token, /\S/u);
        return { ...result.data.user, email, token: result.data.access_token };
      };

      const owner = await register('owner');
      const editor = await register('editor');
      const viewer = await register('viewer');
      const outsider = await register('outsider');
      const space = (await request('/spaces', {
        method: 'POST', token: owner.token, body: { name: `Attachment ${randomUUID()}` },
      })).data;
      const outsiderSpace = (await request('/spaces', {
        method: 'POST', token: outsider.token, body: { name: `Outsider ${randomUUID()}` },
      })).data;
      for (const [human, role] of [[editor, 'editor'], [viewer, 'viewer']]) {
        await request(`/spaces/${space.id}/members`, {
          method: 'POST', token: owner.token, body: { email: human.email, role },
        });
      }

      const agentRecord = (await request('/agents', {
        method: 'POST', token: owner.token, body: { name: `Attachment Agent ${randomUUID()}` },
      })).data;
      const installation = (await request(
        `/agents/${agentRecord.id}/local-sync-installations`,
        {
          method: 'POST', token: owner.token,
          body: { spaceId: space.id, role: 'editor', pluginVersion: '0.7.0' },
        },
      )).data;
      const exchange = (await request('/integrations/local-sync/exchange', {
        method: 'POST', body: { code: installation.code },
      })).data;
      assert.match(exchange.apiKey, /^agk_/u);
      const agentToken = exchange.apiKey;

      const alpha = (await request(`/spaces/${space.id}/attachments`, {
        method: 'POST', token: owner.token,
        form: multipart(PNG, 'Alpha.png', 'image/png'),
      })).data;
      const beta = (await request(`/spaces/${space.id}/attachments`, {
        method: 'POST', token: editor.token,
        form: multipart(PNG, 'Beta.png', 'image/png'),
      })).data;
      assert.equal(alpha.sizeBytes, String(PNG.length));
      assert.equal(beta.sizeBytes, String(PNG.length));

      for (const token of [viewer.token, outsider.token, agentToken]) {
        await request(`/spaces/${space.id}/attachments`, {
          method: 'POST', token,
          form: multipart(PNG, `denied-${randomUUID()}.png`, 'image/png'),
          expected: [403],
        });
      }

      const spoofed = await request(`/spaces/${space.id}/attachments`, {
        method: 'POST', token: owner.token,
        form: multipart(PNG, 'spoof.jpg', 'image/jpeg'),
        expected: [400],
      });
      assert.equal(spoofed.data.code, 'BAD_REQUEST');

      const quota = await request(`/spaces/${space.id}/attachments`, {
        method: 'POST', token: owner.token,
        form: multipart(PNG, 'Gamma.png', 'image/png'),
        expected: [409],
      });
      assert.equal(quota.data.code, 'RESOURCE_CONFLICT');
      assert.equal(await countStoredBlobs(storageRoot), 1, 'dedupe must retain one physical blob');
      assert.equal(
        await prisma.spaceAttachment.aggregate({
          where: { spaceId: space.id, status: 'active' },
          _sum: { sizeBytes: true },
        }).then((result) => result._sum.sizeBytes),
        BigInt(PNG.length * 2),
        'quota must count logical metadata bytes despite physical dedupe',
      );
      assert.deepEqual(
        await readdir(join(storageRoot, '.tmp')),
        [],
        'successful, denied, invalid, and quota-failed uploads must leave no temp lease sidecars',
      );

      for (const token of [owner.token, editor.token, viewer.token, agentToken]) {
        const listed = await request(`/spaces/${space.id}/attachments`, { token });
        assert.equal(listed.data.total, 2);
        assert.deepEqual(
          new Set(listed.data.items.map((item) => item.id)),
          new Set([alpha.id, beta.id]),
        );
      }

      const rawContent = async (token, expectedStatus = 200) => {
        const response = await fetch(`${baseUrl}/attachments/${alpha.id}/content`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000),
        });
        counts.set(response.status, (counts.get(response.status) ?? 0) + 1);
        assert.equal(response.status, expectedStatus);
        return response;
      };
      for (const token of [owner.token, editor.token, viewer.token, agentToken]) {
        const content = await rawContent(token);
        assert.equal(content.headers.get('content-type'), 'image/png');
        assert.equal(content.headers.get('content-length'), String(PNG.length));
        assert.equal(content.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(content.headers.get('cache-control'), 'private, no-store');
        assert.equal(content.headers.get('etag'), `"${createHash('sha256').update(PNG).digest('hex')}"`);
        assert.match(content.headers.get('content-disposition') ?? '', /Alpha\.png/u);
        assert.deepEqual(Buffer.from(await content.arrayBuffer()), PNG);
      }

      await request(`/spaces/${space.id}/attachments`, {
        token: outsider.token, expected: [403],
      });
      await rawContent(outsider.token, 404);
      await prisma.spaceMember.delete({
        where: { userId_spaceId: { userId: viewer.id, spaceId: space.id } },
      });
      await rawContent(viewer.token, 404);
      assert.equal(outsiderSpace.members[0].userId, outsider.id);

      const archived = (await request(
        `/spaces/${space.id}/attachments/${alpha.id}/archive`,
        { method: 'POST', token: owner.token, body: { expectedUpdatedAt: alpha.updatedAt } },
      )).data;
      assert.equal(archived.status, 'archived');
      await request(`/spaces/${space.id}/attachments/${alpha.id}/archive`, {
        method: 'POST', token: owner.token,
        body: { expectedUpdatedAt: alpha.updatedAt }, expected: [409],
      });
      const restored = (await request(
        `/spaces/${space.id}/attachments/${alpha.id}/restore`,
        { method: 'POST', token: editor.token, body: { expectedUpdatedAt: archived.updatedAt } },
      )).data;
      assert.equal(restored.status, 'active');
      await request(`/spaces/${space.id}/attachments/${alpha.id}/restore`, {
        method: 'POST', token: editor.token,
        body: { expectedUpdatedAt: archived.updatedAt }, expected: [409],
      });
      for (const token of [viewer.token, outsider.token]) {
        await request(`/spaces/${space.id}/attachments/${alpha.id}/archive`, {
          method: 'POST', token,
          body: { expectedUpdatedAt: restored.updatedAt }, expected: [403],
        });
      }
      for (const action of ['archive', 'restore']) {
        await request(`/spaces/${space.id}/attachments/${alpha.id}/${action}`, {
          method: 'POST', token: agentToken,
          body: { expectedUpdatedAt: restored.updatedAt }, expected: [403],
        });
      }

      const raceSpace = (await request('/spaces', {
        method: 'POST', token: owner.token, body: { name: `Race ${randomUUID()}` },
      })).data;
      const raceHash = createHash('sha256').update(RACE_PNG).digest('hex');
      const raceStorageKey = `sha256/${raceHash.slice(0, 2)}/${raceHash.slice(2, 4)}/${raceHash}`;
      const cleanupMarker = await prisma.spaceAttachment.create({
        data: {
          spaceId: outsiderSpace.id,
          displayName: 'cleanup-race.png',
          nameKey: 'cleanup-race.png',
          contentHash: raceHash,
          storageKey: raceStorageKey,
          mimeType: 'image/png',
          sizeBytes: BigInt(RACE_PNG.length),
          width: 1,
          height: 1,
          status: 'archived',
          archivedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        },
      });
      const storage = app.get(ATTACHMENT_STORAGE);
      const attachmentConfig = app.get(ATTACHMENT_CONFIG);
      const runtimeConfig = app.get(ConfigService);
      const originalPublish = storage.publish.bind(storage);
      let signalPublished;
      let releasePublish;
      const published = new Promise((resolvePublished) => { signalPublished = resolvePublished; });
      const release = new Promise((resolveRelease) => { releasePublish = resolveRelease; });
      storage.publish = async (...args) => {
        const result = await originalPublish(...args);
        if (args[1] === raceHash) {
          signalPublished();
          await release;
        }
        return result;
      };
      try {
        const raceUploadPromise = request(`/spaces/${raceSpace.id}/attachments`, {
          method: 'POST', token: owner.token,
          form: multipart(RACE_PNG, 'race.png', 'image/png'),
        });
        await published;
        assert.deepEqual(await readFile(join(storageRoot, raceStorageKey)), RACE_PNG);

        const cleanupWorker = new AttachmentCleanupWorker(
          prisma,
          runtimeConfig,
          storage,
          attachmentConfig,
        );
        let cleanupSettled = false;
        const cleanupPromise = cleanupWorker.tick().finally(() => { cleanupSettled = true; });
        await waitUntil(async () => (
          await prisma.spaceAttachment.count({ where: { id: cleanupMarker.id } })
        ) === 0);
        await delay(25);
        assert.equal(cleanupSettled, false, 'cleanup must wait for the upload content lease');
        assert.equal(
          await prisma.spaceAttachment.count({ where: { storageKey: raceStorageKey } }),
          0,
          'the deterministic race must expose the published-before-metadata gap',
        );

        releasePublish();
        const [raceUpload] = await Promise.all([raceUploadPromise, cleanupPromise]);
        assert.equal(raceUpload.data.spaceId, raceSpace.id);
        assert.equal(
          await prisma.spaceAttachment.count({ where: { storageKey: raceStorageKey } }),
          1,
        );
        assert.deepEqual(await readFile(join(storageRoot, raceStorageKey)), RACE_PNG);
      } finally {
        storage.publish = originalPublish;
        releasePublish?.();
      }

      console.info(
        `Attachment HTTP assertions schema=${schemaName} port=${port} `
        + `statuses=${JSON.stringify(Object.fromEntries([...counts].sort(([a], [b]) => a - b)))}`,
      );
    } catch (error) {
      primaryError = error;
    } finally {
      cleanupErrors = await cleanupAttachmentHarnessResources({
        app,
        prisma,
        port,
        storageRoot,
      });
      console.info(
        `Attachment HTTP cleanup schema=${generatedSchema} `
        + `tempRootRemoved=${cleanupErrors.length === 0} `
        + `portReleased=${Boolean(port) && cleanupErrors.length === 0} `
        + `cleanupErrors=${cleanupErrors.length}`,
      );
    }
    const finalError = errorWithCleanup(primaryError, cleanupErrors);
    if (finalError) throw finalError;
  });

  const admin = createAdminClient(baseDatabaseUrl);
  try {
    const [cleanup] = await admin.$queryRawUnsafe(
      `SELECT
         (SELECT count(*)::int FROM pg_namespace WHERE nspname = $1) AS schema_count,
         (SELECT count(*)::int FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('SpaceAttachment', '_prisma_migrations')) AS public_attachment_tables`,
      generatedSchema,
    );
    assert.equal(cleanup.schema_count, 0);
    assert.equal(cleanup.public_attachment_tables, 0);
  } finally {
    await admin.$disconnect();
  }
});

async function countStoredBlobs(root) {
  let count = 0;
  const algorithmRoot = join(root, 'sha256');
  for (const first of await readdir(algorithmRoot, { withFileTypes: true })) {
    if (!first.isDirectory() || !/^[0-9a-f]{2}$/u.test(first.name)) continue;
    for (const second of await readdir(join(algorithmRoot, first.name), { withFileTypes: true })) {
      if (!second.isDirectory() || !/^[0-9a-f]{2}$/u.test(second.name)) continue;
      for (const blob of await readdir(join(algorithmRoot, first.name, second.name), {
        withFileTypes: true,
      })) {
        if (blob.isFile() && /^[0-9a-f]{64}$/u.test(blob.name)) count += 1;
      }
    }
  }
  return count;
}

async function cleanupAttachmentHarnessResources(resources, overrides = {}) {
  const operations = {
    closeApp: async (app) => app.close(),
    disconnectPrisma: async (prisma) => prisma.$disconnect(),
    releasePort: assertPortReleased,
    removeRoot: async (root) => rm(root, { recursive: true, force: true }),
    verifyRootRemoved: async (root) => {
      await assert.rejects(stat(root), (error) => error?.code === 'ENOENT');
    },
    ...overrides,
  };
  const attempts = [
    resources.app && (() => operations.closeApp(resources.app)),
    resources.prisma && (() => operations.disconnectPrisma(resources.prisma)),
    resources.port && (() => operations.releasePort(resources.port)),
    () => operations.removeRoot(resources.storageRoot),
    () => operations.verifyRootRemoved(resources.storageRoot),
  ].filter(Boolean);
  const errors = [];
  for (const attempt of attempts) {
    try {
      await attempt();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function errorWithCleanup(primary, cleanupErrors) {
  if (primary === undefined) {
    return cleanupErrors.length > 0
      ? new AggregateError(cleanupErrors, 'Attachment HTTP harness cleanup failed')
      : undefined;
  }
  if (cleanupErrors.length === 0) return primary;
  const aggregate = new AggregateError(
    cleanupErrors,
    'Attachment HTTP harness cleanup also failed',
  );
  if (typeof primary === 'object' && primary !== null) {
    try {
      if (primary.cause === undefined) primary.cause = aggregate;
      else primary.attachmentHarnessCleanupError = aggregate;
      return primary;
    } catch {
      // Preserve the primary value in the AggregateError below when it is frozen.
    }
  }
  return new AggregateError(
    [primary, ...cleanupErrors],
    'Attachment HTTP assertion and cleanup failed',
    { cause: primary },
  );
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(10);
  }
  throw new Error('Timed out waiting for deterministic attachment race state');
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function assertPortReleased(port) {
  await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => error ? reject(error) : resolvePort());
    });
  });
}
