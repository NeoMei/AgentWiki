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

test('finalize persists page version, published changeset, item, and revision in one transaction', { skip }, async () => {
  const schema = `sync_finalize_side_effects_${randomUUID().replaceAll('-', '')}`;
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
      const pageId = randomUUID();
      const internalPageId = randomUUID();
      const oldBody = 'old';
      const newBody = 'new';
      const newHash = await contentHash(newBody);
      await prisma.space.create({ data: { id: spaceId, name: 'Side Effects', slug: `side-${randomUUID().slice(0, 8)}` } });
      await prisma.user.create({ data: { id: userId, email: `${randomUUID()}@t.local`, type: 'human' } });
      await prisma.spaceMember.create({ data: { userId, spaceId, role: 'editor' } });
      await prisma.humanDeviceCredentialFamily.create({
        data: { id: 'family', userId, deviceId: randomUUID(), vaultId: randomUUID() },
      });
      await prisma.humanDeviceCredential.create({
        data: { id: 'cred', credentialFamilyId: 'family', userId, deviceId: randomUUID(), vaultId: randomUUID(), deviceName: 'Test', credentialHash: `cred-${randomUUID()}`, status: 'active' },
      });
      await prisma.page.create({
        data: {
          id: internalPageId, knowledgeKey: pageId, title: 'Old', slug: 'old', content: oldBody,
          format: 'markdown', spaceId, authorId: userId, syncPath: 'page.md', syncPathKey: 'page.md',
          lastModifiedByUserId: userId, lastModifiedAt: new Date(),
        },
      });

      const manifest = { protocolVersion: '1', spaceId, baseRevision: '0', changes: [{ operation: 'upsert', pageId, path: 'page.md', title: 'New', contentHash: newHash }] };
      const confirmation = await confirmationHash(manifest);
      await prisma.pushSession.create({
        data: {
          id: sessionId, credentialFamilyId: 'family', credentialId: 'cred', userId, spaceId,
          baseRevisionId: '0', idempotencyKey: randomUUID(), status: 'ready_to_finalize',
          capabilitiesHash: 'cap', confirmationHash: confirmation,
          confirmationByteLength: canonicalBytes(manifest).byteLength, changeCount: 1,
          totalBodyBytes: new TextEncoder().encode(newBody).byteLength, receivedBatchCount: 1,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const batch = await prisma.pushSessionBatch.create({ data: { id: randomUUID(), sessionId, batchIndex: 0, batchHash: 'batch', receipt: 'receipt' } });
      await prisma.pushSessionChange.create({
        data: { id: randomUUID(), sessionId, batchId: batch.id, ordinal: 0, operation: 'upsert', pageId, path: 'page.md', title: 'New', body: newBody, contentHash: newHash },
      });

      const result = await service.finalize({ credentialId: 'cred', credentialFamilyId: 'family', userId }, spaceId, sessionId, confirmation);
      assert.equal(result.status, 'published');
      assert.ok(result.changeSetId);

      const page = await prisma.page.findUnique({ where: { id: internalPageId } });
      assert.equal(page.content, newBody);
      assert.equal(page.title, 'New');
      assert.equal(page.lastModifiedByUserId, userId);

      assert.equal(await prisma.pageVersion.count({ where: { pageId: internalPageId } }), 1);
      const changeSet = await prisma.changeSet.findUnique({ where: { id: result.changeSetId } });
      assert.equal(changeSet.origin, 'obsidian_sync');
      assert.equal(changeSet.status, 'published');
      assert.equal(changeSet.humanDeviceCredentialId, 'cred');
      assert.equal(changeSet.baseRevisionId, '0');
      assert.equal(await prisma.changeItem.count({ where: { changeSetId: changeSet.id, status: 'published', publishedResourceId: internalPageId } }), 1);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId, origin: 'obsidian_sync', humanDeviceCredentialId: 'cred' } }), 1);
      const persistedSession = await prisma.pushSession.findUnique({ where: { id: sessionId } });
      assert.equal(persistedSession.status, 'published');
      assert.equal(persistedSession.publishedChangeSetId, changeSet.id);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
