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

test('confirmation mismatch rejects before page write and keeps session ready', { skip }, async () => {
  const schema = `sync_confirm_mismatch_${randomUUID().replaceAll('-', '')}`;
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
    const { PushSessionService } = await import('../apps/server/dist/integrations/obsidian/push-session.service.js');
    const { ContentTreeService } = await import('../apps/server/dist/content-tree/content-tree.service.js');
    const { ReadableSyncPathService } = await import('../apps/server/dist/core/sync/readable-sync-path.service.js');
    const { SpaceRevisionWriterService } = await import('../apps/server/dist/core/sync/space-revision-writer.service.js');
    const { contentHash, confirmationHash, canonicalBytes } = await import('../packages/sync-protocol/dist/esm/index.js');
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const writer = SpaceRevisionWriterService.legacyOnly(prisma);
    const contentTree = new ContentTreeService(prisma, writer, new ReadableSyncPathService());
    const service = new PushSessionService(prisma, {}, contentTree, {});
    try {
      const spaceId = randomUUID();
      const userId = randomUUID();
      const sessionId = randomUUID();
      const pageId = randomUUID();
      const body = 'mismatch';
      const hash = await contentHash(body);
      await prisma.space.create({ data: { id: spaceId, name: 'S', slug: `s-${randomUUID().slice(0, 8)}` } });
      await prisma.user.create({ data: { id: userId, email: `${randomUUID()}@t.local`, type: 'human' } });
      await prisma.spaceMember.create({ data: { userId, spaceId, role: 'editor' } });
      const manifest = { protocolVersion: '1', spaceId, baseRevision: '0', changes: [{ operation: 'upsert', pageId, path: 'mismatch.md', title: 'Mismatch', contentHash: hash }] };
      const correct = await confirmationHash(manifest);
      await prisma.pushSession.create({
        data: {
          id: sessionId, credentialFamilyId: 'family', credentialId: 'cred', userId, spaceId, baseRevisionId: '0',
          idempotencyKey: randomUUID(), status: 'ready_to_finalize', capabilitiesHash: 'c', confirmationHash: correct,
          confirmationByteLength: canonicalBytes(manifest).byteLength, changeCount: 1, totalBodyBytes: new TextEncoder().encode(body).byteLength,
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const batch = await prisma.pushSessionBatch.create({ data: { id: randomUUID(), sessionId, batchIndex: 0, batchHash: 'b', receipt: 'r' } });
      await prisma.pushSessionChange.create({ data: { id: randomUUID(), sessionId, batchId: batch.id, ordinal: 0, operation: 'upsert', pageId, path: 'mismatch.md', title: 'Mismatch', body, contentHash: hash } });
      await assert.rejects(() => service.finalize({ credentialId: 'cred', credentialFamilyId: 'family', userId }, spaceId, sessionId, '0'.repeat(64)), (error) => error.syncCode === 'CONFIRMATION_MISMATCH');
      assert.equal(await prisma.page.count({ where: { knowledgeKey: pageId } }), 0);
      assert.equal((await prisma.pushSession.findUnique({ where: { id: sessionId } })).status, 'ready_to_finalize');
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
