import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL;
const psqlAvailable = spawnSync('psql', ['--version'], { encoding: 'utf8' }).status === 0;
const redisAvailable = spawnSync('redis-cli', ['ping'], { encoding: 'utf8' }).status === 0;
const skip = !databaseUrl
  ? 'DATABASE_URL is not configured'
  : !psqlAvailable
    ? 'psql is unavailable'
    : !redisAvailable
      ? 'redis is unavailable'
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
    input: sql, encoding: 'utf8', env: postgresEnvironment(databaseUrl),
  });
}

async function request(baseUrl, path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  return { status: response.status, data };
}

test('full sync v1 HTTP flow over real Prisma and Redis', { skip }, async () => {
  const schema = `sync_http_${randomUUID().replaceAll('-', '')}`;
  const quoted = `"${schema}"`;
  let app;
  try {
    assert.equal(runPsql(`CREATE SCHEMA ${quoted}`).status, 0);
    const url = new URL(databaseUrl);
    url.searchParams.set('schema', schema);
    const deploy = spawnSync('pnpm', ['--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url.href },
    });
    assert.equal(deploy.status, 0, `migrate deploy failed:\n${deploy.stdout}\n${deploy.stderr}`);

    const seed = randomBytes(32).toString('base64');
    const pepper = `test-pepper-${randomUUID()}`;
    const jwtSecret = `test-jwt-${randomUUID()}`;
    const env = {
      ...process.env,
      DATABASE_URL: url.href,
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: jwtSecret,
      AGENTWIKI_SERVER_PEPPER: pepper,
      AGENTWIKI_DEPLOYMENT_SEED: seed,
      PROCESS_ROLE: 'api',
    };

    const { createRequire } = await import('node:module');
    const require = createRequire(resolve(root, 'apps/server/package.json'));
    const { Test } = require('@nestjs/testing');
    const { ObsidianModule } = await import('../apps/server/dist/integrations/obsidian/obsidian.module.js');
    const { AllExceptionsFilter } = await import('../apps/server/dist/core/filters/all-exceptions.filter.js');
    const { HttpAdapterHost } = require('@nestjs/core');
    const { ConfigModule } = require('@nestjs/config');

    // Environment must be in place before Nest instantiates ConfigModule.
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), ObsidianModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.init();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // 1. Register a human user through the auth endpoint.
    const email = `sync-${randomUUID()}@example.test`;
    const password = `Pass-${randomUUID()}!`;
    const registration = await request(baseUrl, '/auth/register', {
      method: 'POST', body: { email, password, name: 'Sync E2E' },
    });
    assert.equal(registration.status, 201, JSON.stringify(registration.data));
    const token = registration.data.access_token;
    const userId = registration.data.user.id;
    assert.ok(token);
    const redirectStatuses = [301, 302, 303, 307, 308];

    // 2. Create an Obsidian installation code as the human user.
    const installation = await request(baseUrl, '/integrations/obsidian/installations', {
      method: 'POST', token, body: { pluginId: 'agentwiki-sync', requestedProtocolVersion: '1' },
    });
    assert.equal(installation.status, 201, JSON.stringify(installation.data));
    assert.ok(installation.data.code);
    assert.ok(!redirectStatuses.includes(installation.status), 'installations returned a redirect');

    // 3. Exchange the code for a provisional device credential.
    const exchangeBody = {
      code: installation.data.code,
      exchangeId: randomUUID(),
      credential: randomBytes(32).toString('base64url'),
      deviceId: randomUUID(),
      deviceName: 'E2E Mac',
      vaultId: randomUUID(),
      pluginVersion: '1.0.0',
      supportedProtocolVersions: ['1'],
    };
    const exchange = await request(baseUrl, '/integrations/obsidian/exchange', {
      method: 'POST', body: exchangeBody,
    });
    assert.equal(exchange.status, 201, JSON.stringify(exchange.data));
    const credentialId = exchange.data.credentialId;
    const deviceToken = exchangeBody.credential;
    assert.equal(exchange.data.credentialStatus, 'provisional');

    // 4. Activate the credential.
    const activate = await request(baseUrl, '/integrations/obsidian/credentials/current/activate', {
      method: 'POST', token: deviceToken, body: { credentialId },
    });
    assert.equal(activate.status, 200, JSON.stringify(activate.data));
    assert.equal(activate.data.credentialStatus, 'active');

    // 5. Session returns active credential metadata without the secret.
    const session = await request(baseUrl, '/integrations/obsidian/session', { token: deviceToken });
    assert.equal(session.status, 200);
    assert.equal(session.data.credentialStatus, 'active');
    assert.equal(JSON.stringify(session.data).includes(deviceToken), false);

    // 6. Create a Space for the user and grant membership.
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const spaceId = randomUUID();
    await prisma.space.create({ data: { id: spaceId, name: 'E2E Space', slug: `e2e-${randomUUID().slice(0, 8)}` } });
    await prisma.spaceMember.create({ data: { userId, spaceId, role: 'editor' } });
    await prisma.$disconnect();

    // 7. Head and spaces list are readable via the device credential.
    const spaces = await request(baseUrl, '/sync/v1/spaces', { token: deviceToken });
    assert.equal(spaces.status, 200, JSON.stringify(spaces.data));
    assert.ok(spaces.data.spaces.some((s) => s.spaceId === spaceId));

    const head = await request(baseUrl, `/sync/v1/spaces/${spaceId}/head`, { token: deviceToken });
    assert.equal(head.status, 200, JSON.stringify(head.data));
    assert.equal(head.data.revision, '0');

    const deltaAtHead = await request(baseUrl, `/sync/v1/spaces/${spaceId}/delta?from=0`, { token: deviceToken });
    assert.equal(deltaAtHead.status, 200, JSON.stringify(deltaAtHead.data));
    assert.deepEqual(deltaAtHead.data.items, []);
    assert.equal(deltaAtHead.data.toRevision, '0');
    assert.equal(deltaAtHead.data.nextCursor, null);



    const coreSyncRoutes = [
      '/sync/v1/spaces',
      `/sync/v1/spaces/${spaceId}/head`,
      `/sync/v1/spaces/${spaceId}/snapshot?revision=current`,
      `/sync/v1/spaces/${spaceId}/delta?from=0`,
    ];
    for (const path of coreSyncRoutes) {
      const routeResponse = await request(baseUrl, path, { token: deviceToken });
      assert.ok(!redirectStatuses.includes(routeResponse.status), `${path} returned a redirect: ${routeResponse.status}`);
    }

    const fakeSessionId = randomUUID();
    const terminalRouteCases = [
      ['POST', '/integrations/obsidian/exchange', undefined, {}],
      ['GET', '/integrations/obsidian/session', deviceToken],
      ['POST', '/integrations/obsidian/credentials/current/activate', deviceToken, {}],
      ['GET', '/integrations/obsidian/credentials', token],
      ['DELETE', `/integrations/obsidian/credentials/${randomUUID()}`, token],
      ['DELETE', `/integrations/obsidian/installations/${randomUUID()}`, token],
      ['POST', `/sync/v1/spaces/${spaceId}/push-sessions`, deviceToken, {}],
      ['PUT', `/sync/v1/spaces/${spaceId}/push-sessions/${fakeSessionId}/batches/0`, deviceToken, {}],
      ['POST', `/sync/v1/spaces/${spaceId}/push-sessions/${fakeSessionId}/finalize`, deviceToken, {}],
      ['GET', `/sync/v1/spaces/${spaceId}/push-sessions/${fakeSessionId}`, deviceToken],
      ['DELETE', `/sync/v1/spaces/${spaceId}/push-sessions/${fakeSessionId}`, deviceToken],
    ];
    for (const [method, path, routeToken, body] of terminalRouteCases) {
      const routeResponse = await request(baseUrl, path, { method, token: routeToken, body });
      assert.ok(!redirectStatuses.includes(routeResponse.status), `${method} ${path} returned a redirect: ${routeResponse.status}`);
    }



    // 8. Create a push session, upload one batch, and finalize.
    const { canonicalBytes, contentHash, confirmationHash, batchHash, capabilitiesHash } = await import('../packages/sync-protocol/dist/esm/index.js');
    const capabilities = activate.data.capabilities;
    const pageId = randomUUID();
    const body = '# Hello\n';
    const pageContentHash = await contentHash(body);
    const manifest = {
      protocolVersion: '1',
      spaceId,
      baseRevision: '0',
      changes: [{ operation: 'upsert', pageId, path: 'hello.md', title: 'Hello', contentHash: pageContentHash }],
    };
    const confirmation = await confirmationHash(manifest);
    const confirmationByteLength = canonicalBytes(manifest).byteLength;
    const create = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions`, {
      method: 'POST', token: deviceToken,
      body: {
        baseRevision: '0',
        idempotencyKey: randomUUID(),
        capabilitiesHash: await capabilitiesHash(capabilities),
        confirmationHash: confirmation,
        confirmationByteLength,
        changeCount: 1,
        totalBodyBytes: new TextEncoder().encode(body).byteLength,
      },
    });
    assert.equal(create.status, 201, JSON.stringify(create.data));
    const sessionId = create.data.sessionId;

    const batch = {
      protocolVersion: '1',
      batchIndex: 0,
      changes: [{ operation: 'upsert', pageId, path: 'hello.md', title: 'Hello', body, contentHash: pageContentHash }],
    };
    const batchHashValue = await batchHash(batch);
    const upload = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${sessionId}/batches/0`, {
      method: 'PUT', token: deviceToken, body: { ...batch, batchHash: batchHashValue },
    });
    assert.equal(upload.status, 200, JSON.stringify(upload.data));

    // finalize requires the confirmation hash; the byte length bound was
    // declared loosely above, so use the exact value for a clean finalize.
    const finalize = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${sessionId}/finalize`, {
      method: 'POST', token: deviceToken, body: { confirmationHash: confirmation, userConfirmed: true },
    });
    assert.equal(finalize.status, 200, JSON.stringify(finalize.data));
    assert.equal(finalize.data.status, 'published');
    assert.equal(finalize.data.pageCount, '1');

    // 9. Snapshot now returns the published page.
    const snapshot = await request(baseUrl, `/sync/v1/spaces/${spaceId}/snapshot?revision=current`, { token: deviceToken });
    assert.equal(snapshot.status, 200, JSON.stringify(snapshot.data));
    assert.equal(snapshot.data.items.length, 1);
    assert.equal(snapshot.data.items[0].pageId, pageId);
    assert.equal(snapshot.data.items[0].body, body);
    // 10. noop finalize must persist a complete result without advancing revision.
    const headAfterFirst = await request(baseUrl, `/sync/v1/spaces/${spaceId}/head`, { token: deviceToken });
    assert.equal(headAfterFirst.status, 200, JSON.stringify(headAfterFirst.data));
    const noopManifest = { protocolVersion: '1', spaceId, baseRevision: headAfterFirst.data.revision, changes: [] };
    const noopConfirmation = await confirmationHash(noopManifest);
    const noopCreate = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions`, {
      method: 'POST', token: deviceToken,
      body: {
        baseRevision: headAfterFirst.data.revision,
        idempotencyKey: randomUUID(),
        capabilitiesHash: await capabilitiesHash(capabilities),
        confirmationHash: noopConfirmation,
        confirmationByteLength: canonicalBytes(noopManifest).byteLength,
        changeCount: 0,
        totalBodyBytes: 0,
      },
    });
    assert.equal(noopCreate.status, 201, JSON.stringify(noopCreate.data));
    assert.equal(noopCreate.data.status, 'ready_to_finalize');
    const noopFinalize = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${noopCreate.data.sessionId}/finalize`, {
      method: 'POST', token: deviceToken, body: { confirmationHash: noopConfirmation, userConfirmed: true },
    });
    assert.equal(noopFinalize.status, 200, JSON.stringify(noopFinalize.data));
    assert.equal(noopFinalize.data.status, 'noop');
    assert.equal(noopFinalize.data.revision, headAfterFirst.data.revision);
    assert.equal(noopFinalize.data.changeSetId, null);

    // 10b. Capability change must reject create before consuming an idempotency key.
    const capMismatch = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions`, {
      method: 'POST', token: deviceToken,
      body: {
        baseRevision: headAfterFirst.data.revision,
        idempotencyKey: randomUUID(),
        capabilitiesHash: '0'.repeat(64),
        confirmationHash: '0'.repeat(64),
        confirmationByteLength: 1,
        changeCount: 0,
        totalBodyBytes: 0,
      },
    });
    assert.equal(capMismatch.status, 409, JSON.stringify(capMismatch.data));
    assert.equal(capMismatch.data.error.code, 'CAPABILITIES_CHANGED');

    // 10c. changeCount hard boundary must reject 5001 before reaching the database.
    const tooMany = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions`, {
      method: 'POST', token: deviceToken,
      body: {
        baseRevision: headAfterFirst.data.revision,
        idempotencyKey: randomUUID(),
        capabilitiesHash: await capabilitiesHash(capabilities),
        confirmationHash: '0'.repeat(64),
        confirmationByteLength: 1,
        changeCount: 5001,
        totalBodyBytes: 0,
      },
    });
    assert.equal(tooMany.status, 400, JSON.stringify(tooMany.data));
    assert.equal(tooMany.data.error.code, 'PAYLOAD_INVALID');


    // 11. Unicode case-fold path collision must be rejected as PATH_COLLISION.
    const collHead = await request(baseUrl, `/sync/v1/spaces/${spaceId}/head`, { token: deviceToken });
    assert.equal(collHead.status, 200, JSON.stringify(collHead.data));
    const collPageA = randomUUID();
    const collPageB = randomUUID();
    const collBody = 'collide';
    const collHash = await contentHash(collBody);
    const collChanges = [
      { operation: 'upsert', pageId: collPageA, path: 'Straße.md', title: 'Straße', contentHash: collHash },
      { operation: 'upsert', pageId: collPageB, path: 'STRASSE.md', title: 'STRASSE', contentHash: collHash },
    ];
    const collManifest = { protocolVersion: '1', spaceId, baseRevision: collHead.data.revision, changes: collChanges };
    const collConfirmation = await confirmationHash(collManifest);
    const collBodyBytes = new TextEncoder().encode(collBody).byteLength;
    const collCreate = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions`, {
      method: 'POST', token: deviceToken,
      body: {
        baseRevision: collHead.data.revision,
        idempotencyKey: randomUUID(),
        capabilitiesHash: await capabilitiesHash(capabilities),
        confirmationHash: collConfirmation,
        confirmationByteLength: canonicalBytes(collManifest).byteLength,
        changeCount: 2,
        totalBodyBytes: collBodyBytes * 2,
      },
    });
    assert.equal(collCreate.status, 201, JSON.stringify(collCreate.data));
    const collBatch = {
      protocolVersion: '1',
      batchIndex: 0,
      changes: [
        { operation: 'upsert', pageId: collPageA, path: 'Straße.md', title: 'Straße', body: collBody, contentHash: collHash },
        { operation: 'upsert', pageId: collPageB, path: 'STRASSE.md', title: 'STRASSE', body: collBody, contentHash: collHash },
      ],
    };
    const collBatchHash = await batchHash(collBatch);
    const collUpload = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${collCreate.data.sessionId}/batches/0`, {
      method: 'PUT', token: deviceToken, body: { ...collBatch, batchHash: collBatchHash },
    });
    assert.equal(collUpload.status, 200, JSON.stringify(collUpload.data));
    const collFinalize = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${collCreate.data.sessionId}/finalize`, {
      method: 'POST', token: deviceToken, body: { confirmationHash: collConfirmation, userConfirmed: true },
    });
    assert.equal(collFinalize.status, 409, JSON.stringify(collFinalize.data));
    assert.equal(collFinalize.data.error.code, 'PATH_COLLISION');

    // 11b. An archived page ID can be restored by a later Obsidian upsert.
    const pageLookup = new PrismaClient({ datasources: { db: { url: url.href } } });
    const archivedPage = await pageLookup.page.findUnique({ where: { knowledgeKey: pageId } });
    assert.ok(archivedPage, `page record not found for knowledgeKey ${pageId}`);
    await pageLookup.page.update({ where: { id: archivedPage.id }, data: { deletedAt: new Date() } });
    await pageLookup.$disconnect();
    const restoreHead = await request(baseUrl, `/sync/v1/spaces/${spaceId}/head`, { token: deviceToken });
    assert.equal(restoreHead.status, 200, JSON.stringify(restoreHead.data));
    const restoreManifest = { protocolVersion: '1', spaceId, baseRevision: restoreHead.data.revision, changes: [{ operation: 'upsert', pageId, path: 'hello.md', title: 'Hello', contentHash: pageContentHash }] };
    const restoreConfirmation = await confirmationHash(restoreManifest);
    const restoreCreate = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions`, {
      method: 'POST', token: deviceToken,
      body: {
        baseRevision: restoreHead.data.revision,
        idempotencyKey: randomUUID(),
        capabilitiesHash: await capabilitiesHash(capabilities),
        confirmationHash: restoreConfirmation,
        confirmationByteLength: canonicalBytes(restoreManifest).byteLength,
        changeCount: 1,
        totalBodyBytes: new TextEncoder().encode(body).byteLength,
      },
    });
    assert.equal(restoreCreate.status, 201, JSON.stringify(restoreCreate.data));
    const restoreBatch = { protocolVersion: '1', batchIndex: 0, changes: [{ operation: 'upsert', pageId, path: 'hello.md', title: 'Hello', body, contentHash: pageContentHash }] };
    const restoreBatchHash = await batchHash(restoreBatch);
    const restoreUpload = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${restoreCreate.data.sessionId}/batches/0`, { method: 'PUT', token: deviceToken, body: { ...restoreBatch, batchHash: restoreBatchHash } });
    assert.equal(restoreUpload.status, 200, JSON.stringify(restoreUpload.data));
    const restoreFinalize = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${restoreCreate.data.sessionId}/finalize`, { method: 'POST', token: deviceToken, body: { confirmationHash: restoreConfirmation, userConfirmed: true } });
    assert.equal(restoreFinalize.status, 200, JSON.stringify(restoreFinalize.data));
    const restoredSnapshot = await request(baseUrl, `/sync/v1/spaces/${spaceId}/snapshot?revision=current`, { token: deviceToken });
    assert.equal(restoredSnapshot.status, 200, JSON.stringify(restoredSnapshot.data));
    assert.ok(restoredSnapshot.data.items.some((item) => item.pageId === pageId));


    // 12. Exact create replay after head advances must recover the published session result.
    const replayHead = await request(baseUrl, `/sync/v1/spaces/${spaceId}/head`, { token: deviceToken });
    assert.equal(replayHead.status, 200, JSON.stringify(replayHead.data));
    const replayPageId = randomUUID();
    const replayBody = 'second';
    const replayHash = await contentHash(replayBody);
    const replayManifest = { protocolVersion: '1', spaceId, baseRevision: replayHead.data.revision, changes: [{ operation: 'upsert', pageId: replayPageId, path: 'second.md', title: 'Second', contentHash: replayHash }] };
    const replayConfirmation = await confirmationHash(replayManifest);
    const replayIdempotencyKey = randomUUID();
    const replayCreateBody = {
      baseRevision: replayHead.data.revision,
      idempotencyKey: replayIdempotencyKey,
      capabilitiesHash: await capabilitiesHash(capabilities),
      confirmationHash: replayConfirmation,
      confirmationByteLength: canonicalBytes(replayManifest).byteLength,
      changeCount: 1,
      totalBodyBytes: new TextEncoder().encode(replayBody).byteLength,
    };
    const replayCreate = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions`, { method: 'POST', token: deviceToken, body: replayCreateBody });
    assert.equal(replayCreate.status, 201, JSON.stringify(replayCreate.data));
    const replayBatch = { protocolVersion: '1', batchIndex: 0, changes: [{ operation: 'upsert', pageId: replayPageId, path: 'second.md', title: 'Second', body: replayBody, contentHash: replayHash }] };
    const replayBatchHash = await batchHash(replayBatch);
    const replayUpload = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${replayCreate.data.sessionId}/batches/0`, { method: 'PUT', token: deviceToken, body: { ...replayBatch, batchHash: replayBatchHash } });
    assert.equal(replayUpload.status, 200, JSON.stringify(replayUpload.data));
    const replayFinalize = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${replayCreate.data.sessionId}/finalize`, { method: 'POST', token: deviceToken, body: { confirmationHash: replayConfirmation, userConfirmed: true } });
    assert.equal(replayFinalize.status, 200, JSON.stringify(replayFinalize.data));
    const replayAgain = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions`, { method: 'POST', token: deviceToken, body: replayCreateBody });
    assert.equal(replayAgain.status, 201, JSON.stringify(replayAgain.data));
    assert.equal(replayAgain.data.sessionId, replayCreate.data.sessionId);
    assert.deepEqual(replayAgain.data.result, replayFinalize.data);

    // 14. Two concurrent finalize calls must converge to one published result.
    const concHead = await request(baseUrl, `/sync/v1/spaces/${spaceId}/head`, { token: deviceToken });
    assert.equal(concHead.status, 200, JSON.stringify(concHead.data));
    const concPageId = randomUUID();
    const concBody = 'concurrent';
    const concHash = await contentHash(concBody);
    const concManifest = { protocolVersion: '1', spaceId, baseRevision: concHead.data.revision, changes: [{ operation: 'upsert', pageId: concPageId, path: 'concurrent.md', title: 'Concurrent', contentHash: concHash }] };
    const concConfirmation = await confirmationHash(concManifest);
    const concCreate = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions`, {
      method: 'POST', token: deviceToken,
      body: {
        baseRevision: concHead.data.revision,
        idempotencyKey: randomUUID(),
        capabilitiesHash: await capabilitiesHash(capabilities),
        confirmationHash: concConfirmation,
        confirmationByteLength: canonicalBytes(concManifest).byteLength,
        changeCount: 1,
        totalBodyBytes: new TextEncoder().encode(concBody).byteLength,
      },
    });
    assert.equal(concCreate.status, 201, JSON.stringify(concCreate.data));
    const concBatch = { protocolVersion: '1', batchIndex: 0, changes: [{ operation: 'upsert', pageId: concPageId, path: 'concurrent.md', title: 'Concurrent', body: concBody, contentHash: concHash }] };
    const concBatchHash = await batchHash(concBatch);
    const concUpload = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${concCreate.data.sessionId}/batches/0`, { method: 'PUT', token: deviceToken, body: { ...concBatch, batchHash: concBatchHash } });
    assert.equal(concUpload.status, 200, JSON.stringify(concUpload.data));
    const concFinalize = () => request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${concCreate.data.sessionId}/finalize`, { method: 'POST', token: deviceToken, body: { confirmationHash: concConfirmation, userConfirmed: true } });
    const [concA, concB] = await Promise.all([concFinalize(), concFinalize()]);
    assert.equal(concA.status, 200, JSON.stringify(concA.data));
    assert.equal(concB.status, 200, JSON.stringify(concB.data));
    assert.equal(concA.data.status, 'published');
    assert.deepEqual(concA.data, concB.data);

    // 12b. Concurrent exchange of the same installation code must yield one provisional credential.
    const concurrentInstallation = await request(baseUrl, '/integrations/obsidian/installations', {
      method: 'POST', token, body: { pluginId: 'agentwiki-sync', requestedProtocolVersion: '1' },
    });
    assert.equal(concurrentInstallation.status, 201, JSON.stringify(concurrentInstallation.data));
    const concurrentCredential = randomBytes(32).toString('base64url');
    const concurrentExchangeBody = {
      code: concurrentInstallation.data.code,
      exchangeId: randomUUID(),
      credential: concurrentCredential,
      deviceId: randomUUID(),
      deviceName: 'Concurrent Exchange',
      vaultId: randomUUID(),
      pluginVersion: '1.0.0',
      supportedProtocolVersions: ['1'],
    };
    const exchangeOnce = () => request(baseUrl, '/integrations/obsidian/exchange', { method: 'POST', body: concurrentExchangeBody });
    const [exchangeA, exchangeB] = await Promise.all([exchangeOnce(), exchangeOnce()]);
    assert.deepEqual([exchangeA.status, exchangeB.status].sort(), [201, 409]);
    const successfulExchange = exchangeA.status === 201 ? exchangeA : exchangeB;
    assert.equal(successfulExchange.data.credentialStatus, 'provisional');


    // 13. Role downgrade must make an existing ready push session fail finalize.
    const roleHead = await request(baseUrl, `/sync/v1/spaces/${spaceId}/head`, { token: deviceToken });
    assert.equal(roleHead.status, 200, JSON.stringify(roleHead.data));
    const rolePageId = randomUUID();
    const roleBody = 'role';
    const roleHash = await contentHash(roleBody);
    const roleManifest = { protocolVersion: '1', spaceId, baseRevision: roleHead.data.revision, changes: [{ operation: 'upsert', pageId: rolePageId, path: 'role.md', title: 'Role', contentHash: roleHash }] };
    const roleConfirmation = await confirmationHash(roleManifest);
    const roleCreate = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions`, {
      method: 'POST', token: deviceToken,
      body: {
        baseRevision: roleHead.data.revision,
        idempotencyKey: randomUUID(),
        capabilitiesHash: await capabilitiesHash(capabilities),
        confirmationHash: roleConfirmation,
        confirmationByteLength: canonicalBytes(roleManifest).byteLength,
        changeCount: 1,
        totalBodyBytes: new TextEncoder().encode(roleBody).byteLength,
      },
    });
    assert.equal(roleCreate.status, 201, JSON.stringify(roleCreate.data));
    const prisma2 = new PrismaClient({ datasources: { db: { url: url.href } } });
    await prisma2.spaceMember.updateMany({ where: { userId, spaceId }, data: { role: 'viewer' } });
    await prisma2.$disconnect();
    const roleBatch = { protocolVersion: '1', batchIndex: 0, changes: [{ operation: 'upsert', pageId: rolePageId, path: 'role.md', title: 'Role', body: roleBody, contentHash: roleHash }] };
    const roleBatchHash = await batchHash(roleBatch);
    const roleUpload = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${roleCreate.data.sessionId}/batches/0`, { method: 'PUT', token: deviceToken, body: { ...roleBatch, batchHash: roleBatchHash } });
    assert.equal(roleUpload.status, 200, JSON.stringify(roleUpload.data));
    const roleFinalize = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${roleCreate.data.sessionId}/finalize`, { method: 'POST', token: deviceToken, body: { confirmationHash: roleConfirmation, userConfirmed: true } });
    assert.equal(roleFinalize.status, 403, JSON.stringify(roleFinalize.data));
    assert.equal(roleFinalize.data.error.code, 'SPACE_READ_ONLY');

    // 15. A rotated credential in the same family may read a published result but not an unpublished session.
    const rotatedInstallation = await request(baseUrl, '/integrations/obsidian/installations', {
      method: 'POST', token, body: { pluginId: 'agentwiki-sync', requestedProtocolVersion: '1' },
    });
    assert.equal(rotatedInstallation.status, 201, JSON.stringify(rotatedInstallation.data));
    const rotatedCredential = randomBytes(32).toString('base64url');
    const rotatedExchange = await request(baseUrl, '/integrations/obsidian/exchange', {
      method: 'POST',
      body: {
        code: rotatedInstallation.data.code,
        exchangeId: randomUUID(),
        credential: rotatedCredential,
        deviceId: exchangeBody.deviceId,
        deviceName: exchangeBody.deviceName,
        vaultId: exchangeBody.vaultId,
        pluginVersion: exchangeBody.pluginVersion,
        supportedProtocolVersions: exchangeBody.supportedProtocolVersions,
      },
    });
    assert.equal(rotatedExchange.status, 201, JSON.stringify(rotatedExchange.data));
    const rotatedActivate = await request(baseUrl, '/integrations/obsidian/credentials/current/activate', {
      method: 'POST', token: rotatedCredential, body: { credentialId: rotatedExchange.data.credentialId },
    });
    assert.equal(rotatedActivate.status, 200, JSON.stringify(rotatedActivate.data));
    const rotatedPublishedGet = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${replayCreate.data.sessionId}`, { token: rotatedCredential });
    assert.equal(rotatedPublishedGet.status, 200, JSON.stringify(rotatedPublishedGet.data));
    assert.deepEqual(rotatedPublishedGet.data.result, replayFinalize.data);
    const rotatedUnpublishedGet = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${roleCreate.data.sessionId}`, { token: rotatedCredential });
    assert.equal(rotatedUnpublishedGet.status, 404, JSON.stringify(rotatedUnpublishedGet.data));


    // 16. Exchange replay must bind to the exact original credential, even when
    // a later exchange has already replaced the family provisional.
    const replayBindAInstallation = await request(baseUrl, '/integrations/obsidian/installations', {
      method: 'POST', token, body: { pluginId: 'agentwiki-sync', requestedProtocolVersion: '1' },
    });
    assert.equal(replayBindAInstallation.status, 201, JSON.stringify(replayBindAInstallation.data));
    const replayBindACredential = randomBytes(32).toString('base64url');
    const replayBindABody = {
      code: replayBindAInstallation.data.code,
      exchangeId: randomUUID(),
      credential: replayBindACredential,
      deviceId: exchangeBody.deviceId,
      deviceName: exchangeBody.deviceName,
      vaultId: exchangeBody.vaultId,
      pluginVersion: exchangeBody.pluginVersion,
      supportedProtocolVersions: ['1'],
    };
    const replayBindA = await request(baseUrl, '/integrations/obsidian/exchange', { method: 'POST', body: replayBindABody });
    assert.equal(replayBindA.status, 201, JSON.stringify(replayBindA.data));

    const replayBindBInstallation = await request(baseUrl, '/integrations/obsidian/installations', {
      method: 'POST', token, body: { pluginId: 'agentwiki-sync', requestedProtocolVersion: '1' },
    });
    assert.equal(replayBindBInstallation.status, 201, JSON.stringify(replayBindBInstallation.data));
    const replayBindBCredential = randomBytes(32).toString('base64url');
    const replayBindBBody = {
      code: replayBindBInstallation.data.code,
      exchangeId: randomUUID(),
      credential: replayBindBCredential,
      deviceId: exchangeBody.deviceId,
      deviceName: exchangeBody.deviceName,
      vaultId: exchangeBody.vaultId,
      pluginVersion: exchangeBody.pluginVersion,
      supportedProtocolVersions: ['1'],
    };
    const replayBindB = await request(baseUrl, '/integrations/obsidian/exchange', { method: 'POST', body: replayBindBBody });
    assert.equal(replayBindB.status, 201, JSON.stringify(replayBindB.data));

    const replayOldA = await request(baseUrl, '/integrations/obsidian/exchange', { method: 'POST', body: replayBindABody });
    assert.equal(replayOldA.status, 409, JSON.stringify(replayOldA.data));
    assert.equal(replayOldA.data.error.code, 'INSTALLATION_ALREADY_EXCHANGED');

    // 17. finalize must reject a non-contiguous batch index set even when the
    // uploaded change count happens to match the declared changeCount.
    const restoreRolePrisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    await restoreRolePrisma.spaceMember.updateMany({ where: { userId, spaceId }, data: { role: 'editor' } });
    await restoreRolePrisma.$disconnect();
    const gapHead = await request(baseUrl, `/sync/v1/spaces/${spaceId}/head`, { token: rotatedCredential });
    assert.equal(gapHead.status, 200, JSON.stringify(gapHead.data));
    const gapPageA = randomUUID();
    const gapPageB = randomUUID();
    const gapBodyA = 'gap-a';
    const gapBodyB = 'gap-b';
    const gapHashA = await contentHash(gapBodyA);
    const gapHashB = await contentHash(gapBodyB);
    const gapManifest = {
      protocolVersion: '1', spaceId, baseRevision: gapHead.data.revision,
      changes: [
        { operation: 'upsert', pageId: gapPageA, path: 'gap-a.md', title: 'Gap A', contentHash: gapHashA },
        { operation: 'upsert', pageId: gapPageB, path: 'gap-b.md', title: 'Gap B', contentHash: gapHashB },
      ],
    };
    const gapConfirmation = await confirmationHash(gapManifest);
    const gapCreate = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions`, {
      method: 'POST', token: rotatedCredential,
      body: {
        baseRevision: gapHead.data.revision,
        idempotencyKey: randomUUID(),
        capabilitiesHash: await capabilitiesHash(capabilities),
        confirmationHash: gapConfirmation,
        confirmationByteLength: canonicalBytes(gapManifest).byteLength,
        changeCount: 2,
        totalBodyBytes: new TextEncoder().encode(gapBodyA).byteLength + new TextEncoder().encode(gapBodyB).byteLength,
      },
    });
    assert.equal(gapCreate.status, 201, JSON.stringify(gapCreate.data));
    const gapBatch0 = { protocolVersion: '1', batchIndex: 0, changes: [{ operation: 'upsert', pageId: gapPageA, path: 'gap-a.md', title: 'Gap A', body: gapBodyA, contentHash: gapHashA }] };
    const gapBatch2 = { protocolVersion: '1', batchIndex: 2, changes: [{ operation: 'upsert', pageId: gapPageB, path: 'gap-b.md', title: 'Gap B', body: gapBodyB, contentHash: gapHashB }] };
    const gapUpload0 = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${gapCreate.data.sessionId}/batches/0`, { method: 'PUT', token: rotatedCredential, body: { ...gapBatch0, batchHash: await batchHash(gapBatch0) } });
    assert.equal(gapUpload0.status, 200, JSON.stringify(gapUpload0.data));
    const gapUpload2 = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${gapCreate.data.sessionId}/batches/2`, { method: 'PUT', token: rotatedCredential, body: { ...gapBatch2, batchHash: await batchHash(gapBatch2) } });
    assert.equal(gapUpload2.status, 200, JSON.stringify(gapUpload2.data));
    const gapFinalize = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${gapCreate.data.sessionId}/finalize`, { method: 'POST', token: rotatedCredential, body: { confirmationHash: gapConfirmation, userConfirmed: true } });
    assert.equal(gapFinalize.status, 409, JSON.stringify(gapFinalize.data));
    assert.equal(gapFinalize.data.error.code, 'PUSH_SESSION_INCOMPLETE');

    // 18. A super_admin device principal has effective owner access without a
    // Space membership and can publish through sync v1.
    const superEmail = `super-${randomUUID()}@example.test`;
    const superPassword = `Super-${randomUUID()}!`;
    const superRegistration = await request(baseUrl, '/auth/register', {
      method: 'POST', body: { email: superEmail, password: superPassword, name: 'Super Admin E2E' },
    });
    assert.equal(superRegistration.status, 201, JSON.stringify(superRegistration.data));
    const superToken = superRegistration.data.access_token;
    const superUserId = superRegistration.data.user.id;
    const superPrisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    await superPrisma.user.update({ where: { id: superUserId }, data: { platformRole: 'super_admin' } });
    await superPrisma.$disconnect();
    const superInstallation = await request(baseUrl, '/integrations/obsidian/installations', {
      method: 'POST', token: superToken, body: { pluginId: 'agentwiki-sync', requestedProtocolVersion: '1' },
    });
    assert.equal(superInstallation.status, 201, JSON.stringify(superInstallation.data));
    const superCredential = randomBytes(32).toString('base64url');
    const superExchange = await request(baseUrl, '/integrations/obsidian/exchange', {
      method: 'POST', body: {
        code: superInstallation.data.code,
        exchangeId: randomUUID(),
        credential: superCredential,
        deviceId: randomUUID(),
        deviceName: 'Super Admin E2E',
        vaultId: randomUUID(),
        pluginVersion: '1.0.0',
        supportedProtocolVersions: ['1'],
      },
    });
    assert.equal(superExchange.status, 201, JSON.stringify(superExchange.data));
    const superActivate = await request(baseUrl, '/integrations/obsidian/credentials/current/activate', {
      method: 'POST', token: superCredential, body: { credentialId: superExchange.data.credentialId },
    });
    assert.equal(superActivate.status, 200, JSON.stringify(superActivate.data));
    const superSpaces = await request(baseUrl, '/sync/v1/spaces', { token: superCredential });
    assert.equal(superSpaces.status, 200, JSON.stringify(superSpaces.data));
    assert.ok(superSpaces.data.spaces.some((entry) => entry.spaceId === spaceId && entry.role === 'owner'));
    const superHead = await request(baseUrl, `/sync/v1/spaces/${spaceId}/head`, { token: superCredential });
    assert.equal(superHead.status, 200, JSON.stringify(superHead.data));
    const superPageId = randomUUID();
    const superBody = 'super publish';
    const superHash = await contentHash(superBody);
    const superManifest = { protocolVersion: '1', spaceId, baseRevision: superHead.data.revision, changes: [{ operation: 'upsert', pageId: superPageId, path: 'super.md', title: 'Super', contentHash: superHash }] };
    const superConfirmation = await confirmationHash(superManifest);
    const superCreate = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions`, {
      method: 'POST', token: superCredential,
      body: {
        baseRevision: superHead.data.revision,
        idempotencyKey: randomUUID(),
        capabilitiesHash: await capabilitiesHash(superActivate.data.capabilities),
        confirmationHash: superConfirmation,
        confirmationByteLength: canonicalBytes(superManifest).byteLength,
        changeCount: 1,
        totalBodyBytes: new TextEncoder().encode(superBody).byteLength,
      },
    });
    assert.equal(superCreate.status, 201, JSON.stringify(superCreate.data));
    const superBatch = { protocolVersion: '1', batchIndex: 0, changes: [{ operation: 'upsert', pageId: superPageId, path: 'super.md', title: 'Super', body: superBody, contentHash: superHash }] };
    const superUpload = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${superCreate.data.sessionId}/batches/0`, { method: 'PUT', token: superCredential, body: { ...superBatch, batchHash: await batchHash(superBatch) } });
    assert.equal(superUpload.status, 200, JSON.stringify(superUpload.data));
    const superFinalize = await request(baseUrl, `/sync/v1/spaces/${spaceId}/push-sessions/${superCreate.data.sessionId}/finalize`, { method: 'POST', token: superCredential, body: { confirmationHash: superConfirmation, userConfirmed: true } });
    assert.equal(superFinalize.status, 200, JSON.stringify(superFinalize.data));


    // 19. Deleting or deactivating the owning user invalidates the device
    // credential on the very next request.
    const deletedUserEmail = `deleted-${randomUUID()}@example.test`;
    const deletedUserPassword = `Deleted-${randomUUID()}!`;
    const deletedRegistration = await request(baseUrl, '/auth/register', {
      method: 'POST', body: { email: deletedUserEmail, password: deletedUserPassword, name: 'Deleted User E2E' },
    });
    assert.equal(deletedRegistration.status, 201, JSON.stringify(deletedRegistration.data));
    const deletedUserToken = deletedRegistration.data.access_token;
    const deletedUserId = deletedRegistration.data.user.id;
    const deletedInstallation = await request(baseUrl, '/integrations/obsidian/installations', {
      method: 'POST', token: deletedUserToken, body: { pluginId: 'agentwiki-sync', requestedProtocolVersion: '1' },
    });
    assert.equal(deletedInstallation.status, 201, JSON.stringify(deletedInstallation.data));
    const deletedDeviceCredential = randomBytes(32).toString('base64url');
    const deletedExchange = await request(baseUrl, '/integrations/obsidian/exchange', {
      method: 'POST', body: {
        code: deletedInstallation.data.code,
        exchangeId: randomUUID(),
        credential: deletedDeviceCredential,
        deviceId: randomUUID(),
        deviceName: 'Deleted User E2E',
        vaultId: randomUUID(),
        pluginVersion: '1.0.0',
        supportedProtocolVersions: ['1'],
      },
    });
    assert.equal(deletedExchange.status, 201, JSON.stringify(deletedExchange.data));
    const deletedActivate = await request(baseUrl, '/integrations/obsidian/credentials/current/activate', {
      method: 'POST', token: deletedDeviceCredential, body: { credentialId: deletedExchange.data.credentialId },
    });
    assert.equal(deletedActivate.status, 200, JSON.stringify(deletedActivate.data));
    const deleteUserPrisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    await deleteUserPrisma.user.delete({ where: { id: deletedUserId } });
    await deleteUserPrisma.$disconnect();
    const deletedHead = await request(baseUrl, `/sync/v1/spaces/${spaceId}/head`, { token: deletedDeviceCredential });
    assert.equal(deletedHead.status, 401, JSON.stringify(deletedHead.data));
    assert.equal(deletedHead.data.error.code, 'AUTHENTICATION_REQUIRED');

  } finally {
    if (app) await app.close();
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
