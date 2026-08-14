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

test('upload is idempotent for same hash and rejects same index with different hash', { skip }, async () => {
  const schema = `sync_upload_idem_${randomUUID().replaceAll('-', '')}`;
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
    const crypto = { batchReceipt: (_sessionId, index, hash) => `receipt:${index}:${hash}` };
    const service = new PushSessionService(prisma, crypto, {});
    try {
      const spaceId = randomUUID();
      const sessionId = randomUUID();
      const credentialId = randomUUID();
      const familyId = randomUUID();
      await prisma.pushSession.create({
        data: {
          id: sessionId, credentialFamilyId: familyId, credentialId, userId: randomUUID(), spaceId,
          baseRevisionId: '0', idempotencyKey: randomUUID(), status: 'uploading', capabilitiesHash: 'c', confirmationHash: 'h',
          confirmationByteLength: 1, changeCount: 1, totalBodyBytes: 1n, expiresAt: new Date(Date.now() + 60000),
        },
      });
      const principal = { credentialId, credentialFamilyId: familyId, userId: 'user' };
      const pageId = randomUUID();
      const body = 'a';
      const withoutHash = { protocolVersion: '1', batchIndex: 0, changes: [{ operation: 'upsert', pageId, path: `${pageId}.md`, title: pageId, body, contentHash: `${pageId}` }] };
      const batch = { ...withoutHash, batchHash: await batchHash(withoutHash) };
      const first = await service.upload(principal, spaceId, sessionId, batch);
      const second = await service.upload(principal, spaceId, sessionId, batch);
      assert.equal(first.receipt, second.receipt);
      const otherBody = { protocolVersion: '1', batchIndex: 0, changes: [{ operation: 'upsert', pageId, path: `${pageId}.md`, title: pageId, body: 'b', contentHash: `${pageId}` }] };
      const otherBatch = { ...otherBody, batchHash: await batchHash(otherBody) };
      await assert.rejects(() => service.upload(principal, spaceId, sessionId, otherBatch), (error) => error.syncCode === 'BATCH_MISMATCH');
      const session = await prisma.pushSession.findUnique({ where: { id: sessionId } });
      assert.equal(session.receivedBatchCount, 1);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});

test('upload rejects the same page id across different batches', { skip }, async () => {
  const schema = `sync_upload_duplicate_${randomUUID().replaceAll('-', '')}`;
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
    const crypto = { batchReceipt: (_sessionId, index, hash) => `receipt:${index}:${hash}` };
    const service = new PushSessionService(prisma, crypto, {});
    try {
      const spaceId = randomUUID();
      const sessionId = randomUUID();
      const credentialId = randomUUID();
      const familyId = randomUUID();
      const pageId = randomUUID();
      await prisma.pushSession.create({
        data: { id: sessionId, credentialFamilyId: familyId, credentialId, userId: randomUUID(), spaceId, baseRevisionId: '0', idempotencyKey: randomUUID(), status: 'uploading', capabilitiesHash: 'c', confirmationHash: 'h', confirmationByteLength: 1, changeCount: 2, totalBodyBytes: 2n, expiresAt: new Date(Date.now() + 60000) },
      });
      const principal = { credentialId, credentialFamilyId: familyId, userId: 'user' };
      const makeBatch = async (batchIndex) => {
        const withoutHash = { protocolVersion: '1', batchIndex, changes: [{ operation: 'upsert', pageId, path: `${pageId}.md`, title: pageId, body: 'a', contentHash: `${pageId}` }] };
        return { ...withoutHash, batchHash: await batchHash(withoutHash) };
      };
      const batch0 = await makeBatch(0);
      const batch1 = await makeBatch(1);
      await service.upload(principal, spaceId, sessionId, batch0);
      await assert.rejects(() => service.upload(principal, spaceId, sessionId, batch1), (error) => error.syncCode === 'PAYLOAD_INVALID');
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
