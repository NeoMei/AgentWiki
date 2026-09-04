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

test('web, changeset, and obsidian origins share one authoritative revision sequence', { skip }, async () => {
  const schema = `sync_unified_origins_${randomUUID().replaceAll('-', '')}`;
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
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const writer = SpaceRevisionWriterService.legacyOnly(prisma);

    try {
      const spaceId = randomUUID();
      const userId = randomUUID();
      const credentialId = randomUUID();
      const familyId = randomUUID();
      const changeSetId = randomUUID();
      await prisma.space.create({ data: { id: spaceId, name: 'Unified', slug: `unified-${randomUUID().slice(0, 8)}` } });
      await prisma.user.create({ data: { id: userId, email: `${randomUUID()}@t.local`, type: 'human' } });
      await prisma.humanDeviceCredentialFamily.create({ data: { id: familyId, userId, deviceId: randomUUID(), vaultId: randomUUID() } });
      await prisma.humanDeviceCredential.create({ data: { id: credentialId, credentialFamilyId: familyId, userId, deviceId: randomUUID(), vaultId: randomUUID(), deviceName: 'Test', credentialHash: `cred-${randomUUID()}`, status: 'active' } });
      await prisma.changeSet.create({ data: { id: changeSetId, title: 'Change', status: 'published', spaceId, origin: 'review' } });

      const web = await prisma.$transaction((tx) => writer.advance(tx, spaceId, [{ operation: 'upsert', pageId: randomUUID(), path: 'web.md', title: 'Web', body: 'web' }], { origin: 'web_editor', createdByUserId: userId }));
      const review = await prisma.$transaction((tx) => writer.advance(tx, spaceId, [{ operation: 'upsert', pageId: randomUUID(), path: 'review.md', title: 'Review', body: 'review' }], { origin: 'change_set', sourceChangeSetId: changeSetId, createdByUserId: userId }));
      const obsidian = await prisma.$transaction((tx) => writer.advance(tx, spaceId, [{ operation: 'upsert', pageId: randomUUID(), path: 'obsidian.md', title: 'Obsidian', body: 'obsidian' }], { origin: 'obsidian_sync', humanDeviceCredentialId: credentialId, createdByUserId: userId }));

      assert.equal(web.sequence, 1);
      assert.equal(review.sequence, 2);
      assert.equal(obsidian.sequence, 3);
      const revisions = await prisma.spaceKnowledgeRevision.findMany({ where: { spaceId }, orderBy: { sequence: 'asc' } });
      assert.deepEqual(revisions.map((revision) => revision.origin), ['web_editor', 'change_set', 'obsidian_sync']);
      assert.deepEqual(revisions.map((revision) => revision.sequence), [1, 2, 3]);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
