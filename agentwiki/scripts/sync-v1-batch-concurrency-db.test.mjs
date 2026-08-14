import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL;
const psqlAvailable = spawnSync('psql', ['--version'], { encoding: 'utf8' }).status === 0;
const skip = !databaseUrl ? 'DATABASE_URL is not configured' : !psqlAvailable ? 'psql is unavailable' : false;

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

test('concurrent batch uploads serialize through the same session row lock', { skip }, async () => {
  const schema = `sync_batch_conc_${randomUUID().replaceAll('-', '')}`;
  const quoted = `"${schema}"`;
  try {
    assert.equal(runPsql(`CREATE SCHEMA ${quoted}`).status, 0);
    const url = new URL(databaseUrl);
    url.searchParams.set('schema', schema);
    const deploy = spawnSync('pnpm', ['--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url.href },
    });
    assert.equal(deploy.status, 0, `migrate deploy failed:\n${deploy.stdout}\n${deploy.stderr}`);

    const { createRequire } = await import('node:module');
    const require = createRequire(resolve(root, 'apps/server/package.json'));
    const { PrismaClient } = require('@prisma/client');
    const { PushSessionService } = await import('../apps/server/dist/integrations/obsidian/push-session.service.js');
    const { batchHash } = await import('../packages/sync-protocol/dist/esm/index.js');
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const crypto = { batchReceipt: (_sessionId, batchIndex, hash) => `receipt:${batchIndex}:${hash}` };
    const service = new PushSessionService(prisma, crypto, {});
    try {
      const spaceId = randomUUID();
      const sessionId = randomUUID();
      const credentialId = randomUUID();
      const familyId = randomUUID();
      await prisma.pushSession.create({
        data: {
          id: sessionId, credentialFamilyId: familyId, credentialId, userId: randomUUID(),
          spaceId, baseRevisionId: '0', idempotencyKey: randomUUID(), status: 'uploading',
          capabilitiesHash: 'c', confirmationHash: 'h', confirmationByteLength: 1,
          changeCount: 2, totalBodyBytes: 2n, expiresAt: new Date(Date.now() + 60000),
        },
      });
      const principal = { credentialId, credentialFamilyId: familyId, userId: 'user' };
      const makeBatch = async (batchIndex, pageId, body) => {
        const withoutHash = { protocolVersion: '1', batchIndex, changes: [{ operation: 'upsert', pageId, path: `${pageId}.md`, title: pageId, body, contentHash: `${pageId}` }] };
        return { ...withoutHash, batchHash: await batchHash(withoutHash) };
      };
      const [batch0, batch1] = await Promise.all([
        makeBatch(0, randomUUID(), 'a'),
        makeBatch(1, randomUUID(), 'b'),
      ]);
      const results = await Promise.all([
        service.upload(principal, spaceId, sessionId, batch0),
        service.upload(principal, spaceId, sessionId, batch1),
      ]);
      assert.equal(results.length, 2);
      const session = await prisma.pushSession.findUnique({ where: { id: sessionId } });
      assert.equal(session.receivedBatchCount, 2);
      assert.equal(session.receivedChangeCount, 2);
      assert.equal(session.status, 'ready_to_finalize');
      const changes = await prisma.pushSessionChange.findMany({ where: { sessionId }, orderBy: { ordinal: 'asc' } });
      assert.equal(changes.length, 2);
      assert.equal(new Set(changes.map((change) => change.pageId)).size, 2);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});

test('concurrent upload and abort serialize and abort removes staging', { skip }, async () => {
  const schema = `sync_put_delete_conc_${randomUUID().replaceAll('-', '')}`;
  const quoted = `"${schema}"`;
  try {
    assert.equal(runPsql(`CREATE SCHEMA ${quoted}`).status, 0);
    const url = new URL(databaseUrl);
    url.searchParams.set('schema', schema);
    const deploy = spawnSync('pnpm', ['--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url.href },
    });
    assert.equal(deploy.status, 0, `migrate deploy failed:\n${deploy.stdout}\n${deploy.stderr}`);

    const { createRequire } = await import('node:module');
    const require = createRequire(resolve(root, 'apps/server/package.json'));
    const { PrismaClient } = require('@prisma/client');
    const { PushSessionService } = await import('../apps/server/dist/integrations/obsidian/push-session.service.js');
    const { batchHash } = await import('../packages/sync-protocol/dist/esm/index.js');
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const crypto = { batchReceipt: (_sessionId, batchIndex, hash) => `receipt:${batchIndex}:${hash}` };
    const service = new PushSessionService(prisma, crypto, {});

    try {
      const spaceId = randomUUID();
      const sessionId = randomUUID();
      const credentialId = randomUUID();
      const familyId = randomUUID();
      const pageId = randomUUID();
      await prisma.pushSession.create({
        data: {
          id: sessionId, credentialFamilyId: familyId, credentialId, userId: randomUUID(),
          spaceId, baseRevisionId: '0', idempotencyKey: randomUUID(), status: 'uploading',
          capabilitiesHash: 'c', confirmationHash: 'h', confirmationByteLength: 1,
          changeCount: 1, totalBodyBytes: 1n, expiresAt: new Date(Date.now() + 60000),
        },
      });
      const principal = { credentialId, credentialFamilyId: familyId, userId: 'user' };
      const withoutHash = { protocolVersion: '1', batchIndex: 0, changes: [{ operation: 'upsert', pageId, path: `${pageId}.md`, title: pageId, body: 'a', contentHash: `${pageId}` }] };
      const batch = { ...withoutHash, batchHash: await batchHash(withoutHash) };

      const results = await Promise.allSettled([
        service.upload(principal, spaceId, sessionId, batch),
        service.abort(principal, spaceId, sessionId),
      ]);
      assert.ok(results.some((result) => result.status === 'fulfilled'));

      const session = await prisma.pushSession.findUnique({ where: { id: sessionId } });
      assert.equal(session.status, 'aborted');
      assert.equal(await prisma.pushSessionChange.count({ where: { sessionId } }), 0);
      assert.equal(await prisma.pushSessionBatch.count({ where: { sessionId } }), 0);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
