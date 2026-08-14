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

    // 2. Create an Obsidian installation code as the human user.
    const installation = await request(baseUrl, '/integrations/obsidian/installations', {
      method: 'POST', token, body: { pluginId: 'agentwiki-sync', requestedProtocolVersion: '1' },
    });
    assert.equal(installation.status, 201, JSON.stringify(installation.data));
    assert.ok(installation.data.code);

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
  } finally {
    if (app) await app.close();
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
