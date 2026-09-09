import assert from 'node:assert/strict';
import { Blob } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { withSyncV3TestDatabase } from './sync-v3-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { FormData } = globalThis;
const baseDatabaseUrl = process.env.SYNC_V3_TEST_DATABASE_URL;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('dedicated Sync v3 HTTP gate is registered as a serial real-database command', async () => {
  const manifest = requireFromServer('../../package.json');
  assert.equal(
    manifest.scripts['test:e2e:sync-v3-http-db'],
    'node -e "if (!process.env.SYNC_V3_TEST_DATABASE_URL) { '
      + "throw new Error('SYNC_V3_TEST_DATABASE_URL is required for the dedicated Sync v3 HTTP gate'); }\" && "
      + 'pnpm --filter @neomei/agentwiki-sync-protocol build && '
      + 'pnpm --filter @agentwiki/server build && '
      + 'node --test scripts/sync-v3-http-db.test.mjs',
  );
});

const requestJson = async (baseUrl, path, {
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
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  assert.ok(expected.includes(response.status), `${method} ${path} returned ${response.status}`);
  return { response, data };
};

async function assertPortReleased(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close((error) => error ? reject(error) : resolve()));
  });
}

test('real isolated HTTP Sync v3 lifecycle is durable, idempotent, guarded, and atomic', {
  skip: baseDatabaseUrl ? false : 'SYNC_V3_TEST_DATABASE_URL is required',
  timeout: 300_000,
}, async () => {
  await withSyncV3TestDatabase(baseDatabaseUrl, async ({
    databaseUrl,
    schemaName,
    applySyncV3Migration,
    applySyncV3PushOrdinalMigration,
    applySyncV3BlobReferenceIndexMigration,
    applySyncV3AttachmentCleanupCursorMigration,
    applySyncV3AttachmentCleanupLeaseMigration,
  }) => {
    assert.match(schemaName, /^sync_v3_test_[a-z0-9_]+$/u);
    await applySyncV3Migration();
    await applySyncV3PushOrdinalMigration();
    await applySyncV3BlobReferenceIndexMigration();
    await applySyncV3AttachmentCleanupCursorMigration();
    await applySyncV3AttachmentCleanupLeaseMigration();

    const storageRoot = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-sync-v3-http-'));
    let app;
    let port;
    try {
      Object.assign(process.env, {
        NODE_ENV: 'test',
        PROCESS_ROLE: 'api',
        DATABASE_URL: databaseUrl,
        REDIS_URL: 'redis://127.0.0.1:6379',
        JWT_SECRET: `sync-v3-http-jwt-${randomUUID()}-${randomUUID()}`,
        AGENTWIKI_SERVER_PEPPER: `sync-v3-http-pepper-${randomUUID()}`,
        AGENTWIKI_DEPLOYMENT_SEED: randomBytes(32).toString('base64'),
        LOCAL_SYNC_PACKAGE_VERSION: '0.10.0',
        ATTACHMENT_STORAGE_PATH: storageRoot,
        ATTACHMENT_MIN_FREE_BYTES: '1',
      });

      const { Test } = requireFromServer('@nestjs/testing');
      const { ValidationPipe } = requireFromServer('@nestjs/common');
      const { HttpAdapterHost } = requireFromServer('@nestjs/core');
      const { AppModule } = await import('../apps/server/dist/app.module.js');
      const { installBigIntJsonSerialization } = await import('../apps/server/dist/bigint-json.js');
      const { AllExceptionsFilter } = await import('../apps/server/dist/core/filters/all-exceptions.filter.js');
      const { PrismaService } = await import('../apps/server/dist/database/prisma.service.js');
      const { SyncV3RevisionWriterService } = await import(
        '../apps/server/dist/core/sync/sync-v3-revision-writer.service.js'
      );
      const protocol = await import('../packages/sync-protocol/dist/esm/index.js');

      installBigIntJsonSerialization();
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.useGlobalPipes(new ValidationPipe({
        whitelist: true, forbidNonWhitelisted: true, transform: true,
        transformOptions: { enableImplicitConversion: true },
      }));
      app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
      await app.init();
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address();
      assert.equal(typeof address, 'object');
      port = address.port;
      const baseUrl = `http://127.0.0.1:${port}/api`;
      const prisma = app.get(PrismaService);

      const email = `sync-v3-${randomUUID()}@example.test`;
      const password = `Pass-${randomUUID()}!`;
      const registration = await requestJson(baseUrl, '/auth/register', {
        method: 'POST', body: { email, password, name: 'Sync v3 owner' },
      });
      const humanToken = registration.data.access_token;
      const space = (await requestJson(baseUrl, '/spaces', {
        method: 'POST', token: humanToken, body: { name: `Sync v3 ${randomUUID().slice(0, 8)}` },
      })).data;

      const installation = (await requestJson(baseUrl, '/integrations/obsidian/installations', {
        method: 'POST', token: humanToken,
        body: { pluginId: 'agentwiki-sync', requestedProtocolVersion: '1' },
      })).data;
      const deviceToken = randomBytes(32).toString('base64url');
      const exchange = (await requestJson(baseUrl, '/integrations/obsidian/exchange', {
        method: 'POST', body: {
          code: installation.code,
          exchangeId: randomUUID(), credential: deviceToken,
          deviceId: randomUUID(), deviceName: 'Isolated HTTP vault', vaultId: randomUUID(),
          pluginVersion: '0.5.1', supportedProtocolVersions: ['1'],
        },
      })).data;
      await requestJson(baseUrl, '/integrations/obsidian/credentials/current/activate', {
        method: 'POST', token: deviceToken, body: { credentialId: exchange.credentialId },
      });

      const strictQueryCases = [
        ['capabilities unknown', '/sync/v3/capabilities?unexpected=1', 'GET', undefined],
        ['capabilities repeated', '/sync/v3/capabilities?unexpected=1&unexpected=2', 'GET', undefined],
        ['spaces unknown', '/sync/v3/spaces?unexpected=1', 'GET', undefined],
        ['spaces repeated', '/sync/v3/spaces?unexpected=1&unexpected=2', 'GET', undefined],
        ['head unknown', `/sync/v3/spaces/${space.id}/head?unexpected=1`, 'GET', undefined],
        ['head repeated', `/sync/v3/spaces/${space.id}/head?unexpected=1&unexpected=2`, 'GET', undefined],
        ['preview unknown', `/sync/v3/spaces/${space.id}/bootstrap-preview?unexpected=1`, 'GET', undefined],
        ['preview repeated', `/sync/v3/spaces/${space.id}/bootstrap-preview?unexpected=1&unexpected=2`, 'GET', undefined],
        ['bootstrap unknown', `/sync/v3/spaces/${space.id}/bootstrap?unexpected=1`, 'POST', {
          protocolVersion: '3', baseRevision: '0', confirmationHash: 'a'.repeat(64),
          userConfirmed: true,
        }],
        ['bootstrap repeated', `/sync/v3/spaces/${space.id}/bootstrap?unexpected=1&unexpected=2`, 'POST', {
          protocolVersion: '3', baseRevision: '0', confirmationHash: 'a'.repeat(64),
          userConfirmed: true,
        }],
        ['snapshot unknown', `/sync/v3/spaces/${space.id}/snapshot?revision=current&unexpected=1`, 'GET', undefined],
        ['snapshot repeated revision', `/sync/v3/spaces/${space.id}/snapshot?revision=current&revision=0`, 'GET', undefined],
        ['snapshot repeated cursor', `/sync/v3/spaces/${space.id}/snapshot?revision=current&cursor=a&cursor=b`, 'GET', undefined],
        ['snapshot repeated limit', `/sync/v3/spaces/${space.id}/snapshot?revision=current&limit=1&limit=2`, 'GET', undefined],
        ['delta unknown', `/sync/v3/spaces/${space.id}/delta?from=0&unexpected=1`, 'GET', undefined],
        ['delta repeated from', `/sync/v3/spaces/${space.id}/delta?from=0&from=rev-1`, 'GET', undefined],
        ['delta repeated cursor', `/sync/v3/spaces/${space.id}/delta?from=0&cursor=a&cursor=b`, 'GET', undefined],
        ['delta repeated limit', `/sync/v3/spaces/${space.id}/delta?from=0&limit=1&limit=2`, 'GET', undefined],
      ];
      const strictQueryResults = [];
      for (const [name, path, method, body] of strictQueryCases) {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${deviceToken}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        let responseBody;
        try { responseBody = await response.json(); } catch { responseBody = null; }
        strictQueryResults.push({
          name, status: response.status, cacheControl: response.headers.get('cache-control'),
          code: responseBody?.error?.code,
        });
      }
      assert.deepEqual(
        strictQueryResults,
        strictQueryCases.map(([name]) => ({
          name, status: 400, cacheControl: 'no-store', code: 'PAYLOAD_INVALID',
        })),
        `strict query failures: ${JSON.stringify(strictQueryResults)}`,
      );

      const capabilities = (await requestJson(baseUrl, '/sync/v3/capabilities', {
        token: deviceToken,
      })).data;
      assert.equal(capabilities.protocolVersion, '3');
      assert.equal(capabilities.capabilities.blobChunkBytes, 1_048_576);
      assert.match(capabilities.capabilitiesHash, /^[0-9a-f]{64}$/u);
      const spaces = (await requestJson(baseUrl, '/sync/v3/spaces', { token: deviceToken })).data;
      assert.deepEqual(spaces.spaces.map(({ spaceId }) => spaceId), [space.id]);

      const form = new FormData();
      form.append('file', new Blob([PNG], { type: 'image/png' }), 'Diagram.png');
      const attachment = (await requestJson(baseUrl, `/spaces/${space.id}/attachments`, {
        method: 'POST', token: humanToken, form,
      })).data;
      assert.equal(attachment.canonicalPath, 'assets/Diagram.png');
      const tree = (await requestJson(baseUrl, `/spaces/${space.id}/content-tree?take=1`, {
        token: humanToken,
      })).data;
      const pageContent = `# Canonical\n\n![[${attachment.canonicalPath}]]\n`;
      const page = (await requestJson(baseUrl, '/pages', {
        method: 'POST', token: humanToken, body: {
          spaceId: space.id, title: 'Canonical Page', content: pageContent,
          expectedTreeRevision: tree.treeRevision,
        },
      })).data;
      const persistedPage = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });

      const head = (await requestJson(baseUrl, `/sync/v3/spaces/${space.id}/head`, {
        token: deviceToken,
      })).data;
      assert.equal(head.protocolVersion, '3');
      assert.notEqual(head.revision, '0');
      const snapshot = (await requestJson(
        baseUrl,
        `/sync/v3/spaces/${space.id}/snapshot?revision=${encodeURIComponent(head.revision)}`,
        { token: deviceToken },
      )).data;
      assert.equal(snapshot.pages.length, 1);
      assert.equal(snapshot.pages[0].pageId, persistedPage.knowledgeKey);
      assert.deepEqual(snapshot.pages[0].referencedAttachmentIds, [attachment.id]);
      assert.equal(snapshot.attachments[0].path, attachment.canonicalPath);

      const currentSnapshot = (await requestJson(
        baseUrl,
        `/sync/v3/spaces/${space.id}/snapshot?revision=current&limit=1`,
        { token: deviceToken },
      )).data;
      assert.equal(currentSnapshot.revision, head.revision);
      assert.equal(typeof currentSnapshot.nextCursor, 'string');
      const continuedSnapshot = (await requestJson(
        baseUrl,
        `/sync/v3/spaces/${space.id}/snapshot?revision=current&cursor=${encodeURIComponent(currentSnapshot.nextCursor)}&limit=1`,
        { token: deviceToken },
      )).data;
      assert.equal(continuedSnapshot.revision, head.revision);
      const driftedSnapshot = await requestJson(
        baseUrl,
        `/sync/v3/spaces/${space.id}/snapshot?revision=0&cursor=${encodeURIComponent(currentSnapshot.nextCursor)}&limit=1`,
        { token: deviceToken, expected: [400] },
      );
      assert.equal(driftedSnapshot.data.error.code, 'CURSOR_INVALID');

      const deltaPage = (await requestJson(
        baseUrl,
        `/sync/v3/spaces/${space.id}/delta?from=0&limit=1`,
        { token: deviceToken },
      )).data;
      assert.equal(deltaPage.fromRevision, '0');
      assert.equal(typeof deltaPage.nextCursor, 'string');
      const continuedDelta = (await requestJson(
        baseUrl,
        `/sync/v3/spaces/${space.id}/delta?from=0&cursor=${encodeURIComponent(deltaPage.nextCursor)}&limit=1`,
        { token: deviceToken },
      )).data;
      assert.equal(continuedDelta.fromRevision, '0');
      assert.equal(continuedDelta.toRevision, deltaPage.toRevision);

      const blob = await fetch(
        `${baseUrl}/sync/v3/spaces/${space.id}/revisions/${head.revision}/attachments/${attachment.id}/content`,
        { headers: { Authorization: `Bearer ${deviceToken}` } },
      );
      assert.equal(blob.status, 200);
      assert.equal(blob.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(Buffer.from(await blob.arrayBuffer()), PNG);

      const v2 = await requestJson(baseUrl, `/sync/v2/spaces/${space.id}/head`, {
        token: deviceToken, expected: [409],
      });
      assert.equal(v2.data.error.code, 'SYNC_PROTOCOL_UPGRADE_REQUIRED');
      const archive = await requestJson(baseUrl, `/spaces/${space.id}/attachments/${attachment.id}/archive`, {
        method: 'POST', token: humanToken,
        body: { expectedUpdatedAt: attachment.updatedAt }, expected: [409],
      });
      assert.equal(archive.data.code, 'ATTACHMENT_REFERENCED');

      const pushedBody = '# Pushed\n';
      const pushedAt = new Date().toISOString();
      const pushedPage = {
        pageId: randomUUID(), folderId: null, path: 'pages/Pushed.md', title: 'Pushed',
        body: pushedBody, contentHash: await protocol.contentHash(pushedBody),
        updatedAt: pushedAt, referencedAttachmentIds: [],
      };
      const manifest = {
        protocolVersion: '3', spaceId: space.id, baseRevision: head.revision,
        capabilitiesHash: capabilities.capabilitiesHash,
        changes: [{ operation: 'upsert_page', page: {
          pageId: pushedPage.pageId, folderId: null, path: pushedPage.path,
          title: pushedPage.title, contentHash: pushedPage.contentHash,
          updatedAt: pushedAt, referencedAttachmentIds: [],
        } }],
      };
      const confirmationHash = await protocol.treeConfirmationHashV3(manifest);
      const created = (await requestJson(baseUrl, `/sync/v3/spaces/${space.id}/push-sessions`, {
        method: 'POST', token: deviceToken, body: {
          protocolVersion: '3', baseRevision: head.revision, idempotencyKey: randomUUID(),
          capabilitiesHash: capabilities.capabilitiesHash, confirmationHash,
          confirmationByteLength: protocol.canonicalBytes(manifest).byteLength,
          changeCount: 1, totalBodyBytes: Buffer.byteLength(pushedBody),
          attachmentCount: 0, transferBlobBytes: 0, blobRequirements: [],
        },
      })).data;
      const batchWithoutHash = {
        protocolVersion: '3', batchIndex: 0,
        changes: [{ operation: 'upsert_page', page: pushedPage }],
      };
      await requestJson(baseUrl, `/sync/v3/spaces/${space.id}/push-sessions/${created.sessionId}/batches/0`, {
        method: 'PUT', token: deviceToken,
        body: { ...batchWithoutHash, batchHash: await protocol.treeBatchHashV3(batchWithoutHash) },
      });
      const finalizeBody = { protocolVersion: '3', confirmationHash, userConfirmed: true };
      const published = (await requestJson(
        baseUrl, `/sync/v3/spaces/${space.id}/push-sessions/${created.sessionId}/finalize`,
        { method: 'POST', token: deviceToken, body: finalizeBody },
      )).data;
      const replay = (await requestJson(
        baseUrl, `/sync/v3/spaces/${space.id}/push-sessions/${created.sessionId}/finalize`,
        { method: 'POST', token: deviceToken, body: finalizeBody },
      )).data;
      assert.deepEqual(replay, published);
      assert.equal(published.status, 'published');
      const session = (await requestJson(
        baseUrl, `/sync/v3/spaces/${space.id}/push-sessions/${created.sessionId}`,
        { token: deviceToken },
      )).data;
      assert.equal(session.status, 'published');
      assert.deepEqual(session.result, published);

      const faultHead = (await requestJson(baseUrl, `/sync/v3/spaces/${space.id}/head`, {
        token: deviceToken,
      })).data;
      const before = {
        revisions: await prisma.spaceKnowledgeRevision.count({ where: { spaceId: space.id } }),
        pages: await prisma.page.count({ where: { spaceId: space.id } }),
      };
      const faultPage = { ...pushedPage, pageId: randomUUID(), path: 'pages/Fault.md', title: 'Fault' };
      const faultManifest = {
        protocolVersion: '3', spaceId: space.id, baseRevision: faultHead.revision,
        capabilitiesHash: capabilities.capabilitiesHash,
        changes: [{ operation: 'upsert_page', page: {
          pageId: faultPage.pageId, folderId: null, path: faultPage.path, title: faultPage.title,
          contentHash: faultPage.contentHash, updatedAt: faultPage.updatedAt, referencedAttachmentIds: [],
        } }],
      };
      const faultConfirmation = await protocol.treeConfirmationHashV3(faultManifest);
      const faultSession = (await requestJson(baseUrl, `/sync/v3/spaces/${space.id}/push-sessions`, {
        method: 'POST', token: deviceToken, body: {
          protocolVersion: '3', baseRevision: faultHead.revision, idempotencyKey: randomUUID(),
          capabilitiesHash: capabilities.capabilitiesHash, confirmationHash: faultConfirmation,
          confirmationByteLength: protocol.canonicalBytes(faultManifest).byteLength,
          changeCount: 1, totalBodyBytes: Buffer.byteLength(faultPage.body),
          attachmentCount: 0, transferBlobBytes: 0, blobRequirements: [],
        },
      })).data;
      const faultBatch = { protocolVersion: '3', batchIndex: 0, changes: [{ operation: 'upsert_page', page: faultPage }] };
      await requestJson(baseUrl, `/sync/v3/spaces/${space.id}/push-sessions/${faultSession.sessionId}/batches/0`, {
        method: 'PUT', token: deviceToken,
        body: { ...faultBatch, batchHash: await protocol.treeBatchHashV3(faultBatch) },
      });

      const writer = app.get(SyncV3RevisionWriterService);
      const advance = writer.advanceV3Locked.bind(writer);
      writer.advanceV3Locked = async (...args) => {
        await advance(...args);
        throw new Error('injected Sync v3 finalize failure');
      };
      try {
        const failed = await requestJson(
          baseUrl, `/sync/v3/spaces/${space.id}/push-sessions/${faultSession.sessionId}/finalize`,
          { method: 'POST', token: deviceToken,
            body: { protocolVersion: '3', confirmationHash: faultConfirmation, userConfirmed: true },
            expected: [500] },
        );
        assert.equal(failed.data.error.code, 'INTERNAL_ERROR');
      } finally {
        writer.advanceV3Locked = advance;
      }
      const afterHead = (await requestJson(baseUrl, `/sync/v3/spaces/${space.id}/head`, {
        token: deviceToken,
      })).data;
      assert.equal(afterHead.revision, faultHead.revision);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId: space.id } }), before.revisions);
      assert.equal(await prisma.page.count({ where: { spaceId: space.id } }), before.pages);
      assert.equal(await prisma.page.count({ where: { knowledgeKey: faultPage.pageId } }), 0);
      const persistedFaultSession = await prisma.pushSession.findUniqueOrThrow({
        where: { id: faultSession.sessionId },
      });
      assert.equal(persistedFaultSession.status, 'ready_to_finalize');
      assert.equal(persistedFaultSession.result, null);
    } finally {
      if (app) await app.close();
      if (port) await assertPortReleased(port);
      await rm(storageRoot, { recursive: true, force: true });
      await assert.rejects(stat(storageRoot), { code: 'ENOENT' });
    }
  });
});
