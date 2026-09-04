import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { spawnPnpmSync } from './package-manager-process.mjs';
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

test('finalize rejects a resulting 5001-page space atomically', { skip }, async () => {
  const schema = `sync_space_too_large_${randomUUID().replaceAll('-', '')}`;
  const quoted = `"${schema}"`;
  try {
    assert.equal(runPsql(`CREATE SCHEMA ${quoted}`).status, 0);
    const url = new URL(databaseUrl);
    url.searchParams.set('schema', schema);
    const deploy = spawnPnpmSync(['--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url.href },
    });
    assert.equal(deploy.status, 0, `migrate deploy failed:\n${deploy.stdout}\n${deploy.stderr}`);

    const { createRequire } = await import('node:module');
    const require = createRequire(resolve(root, 'apps/server/package.json'));
    const { PrismaClient } = require('@prisma/client');
    const { SpaceRevisionWriterService } = await import('../apps/server/dist/core/sync/space-revision-writer.service.js');
    const { PushSessionService } = await import('../apps/server/dist/integrations/obsidian/push-session.service.js');
    const { contentHash, confirmationHash, canonicalBytes } = await import('../packages/sync-protocol/dist/esm/index.js');
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const writer = new SpaceRevisionWriterService(prisma);
    const service = new PushSessionService(prisma, {}, writer);

    try {
      const spaceId = randomUUID();
      const userId = randomUUID();
      const sessionId = randomUUID();
      const extraPageId = randomUUID();
      const body = 'x'.repeat(1024);
      const extraHash = await contentHash(body);
      await prisma.space.create({ data: { id: spaceId, name: 'Too Large', slug: `too-large-${randomUUID().slice(0, 8)}` } });
      await prisma.user.create({ data: { id: userId, email: `${randomUUID()}@t.local`, type: 'human' } });
      await prisma.spaceMember.create({ data: { userId, spaceId, role: 'editor' } });
      await prisma.humanDeviceCredentialFamily.create({
        data: { id: 'family', userId, deviceId: randomUUID(), vaultId: randomUUID() },
      });
      await prisma.humanDeviceCredential.create({
        data: {
          id: 'cred', credentialFamilyId: 'family', userId,
          deviceId: randomUUID(), vaultId: randomUUID(), deviceName: 'Test',
          credentialHash: `cred-${randomUUID()}`, status: 'active',
        },
      });

      const base = await prisma.$transaction(async (tx) => writer.advance(tx, spaceId, Array.from({ length: 5000 }, (_, index) => ({
        operation: 'upsert',
        pageId: randomUUID(),
        path: `pages/p-${index}.md`,
        title: `Page ${index}`,
        body: 'base',
      })), { origin: 'migration' }), { timeout: 120_000 });
      assert.equal(base.pageCount, 5000n);

      const manifest = {
        protocolVersion: '1',
        spaceId,
        baseRevision: base.revisionId,
        changes: [{ operation: 'upsert', pageId: extraPageId, path: 'extra.md', title: 'Extra', contentHash: extraHash }],
      };
      const confirmation = await confirmationHash(manifest);
      await prisma.pushSession.create({
        data: {
          id: sessionId,
          credentialFamilyId: 'family',
          credentialId: 'cred',
          userId,
          spaceId,
          baseRevisionId: base.revisionId,
          idempotencyKey: randomUUID(),
          status: 'ready_to_finalize',
          capabilitiesHash: 'cap',
          confirmationHash: confirmation,
          confirmationByteLength: canonicalBytes(manifest).byteLength,
          changeCount: 1,
          totalBodyBytes: new TextEncoder().encode(body).byteLength,
          receivedBatchCount: 1,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const batch = await prisma.pushSessionBatch.create({ data: { id: randomUUID(), sessionId, batchIndex: 0, batchHash: 'batch', receipt: 'receipt' } });
      await prisma.pushSessionChange.create({
        data: { id: randomUUID(), sessionId, batchId: batch.id, ordinal: 0, operation: 'upsert', pageId: extraPageId, path: 'extra.md', title: 'Extra', body, contentHash: extraHash },
      });

      await assert.rejects(
        () => service.finalize({ credentialId: 'cred', credentialFamilyId: 'family', userId }, spaceId, sessionId, confirmation),
        (error) => error?.syncCode === 'SPACE_TOO_LARGE',
      );
      const session = await prisma.pushSession.findUnique({ where: { id: sessionId } });
      assert.equal(session.status, 'ready_to_finalize');
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);
      assert.equal(await prisma.syncRevisionPageRow.count({ where: { revisionId: base.revisionId } }), 5000);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
