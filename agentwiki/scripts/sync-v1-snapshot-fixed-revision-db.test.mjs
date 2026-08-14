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

test('snapshot remains pinned to its revision after head advances', { skip }, async () => {
  const schema = `sync_fixed_snapshot_${randomUUID().replaceAll('-', '')}`;
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
    const { SyncRevisionService } = await import('../apps/server/dist/integrations/obsidian/sync-revision.service.js');
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const writer = new SpaceRevisionWriterService(prisma);
    const service = new SyncRevisionService(prisma);

    try {
      const spaceId = randomUUID();
      const pageA = randomUUID();
      const pageB = randomUUID();
      const userId = randomUUID();
      await prisma.space.create({ data: { id: spaceId, name: 'Fixed', slug: `fixed-${randomUUID().slice(0, 8)}` } });
      await prisma.user.create({ data: { id: userId, email: `${randomUUID()}@t.local`, type: 'human' } });

      const first = await prisma.$transaction((tx) => writer.advance(tx, spaceId, [{
        operation: 'upsert', pageId: pageA, path: 'a.md', title: 'A', body: 'A',
      }], { origin: 'web_editor', createdByUserId: userId }));

      const pinnedBefore = await service.snapshotPage(spaceId, first.revisionId, 100);
      assert.deepEqual(pinnedBefore.items.map((row) => row.pageId), [pageA]);

      await prisma.$transaction((tx) => writer.advance(tx, spaceId, [{
        operation: 'upsert', pageId: pageB, path: 'b.md', title: 'B', body: 'B',
      }], { origin: 'web_editor', createdByUserId: userId }));

      const pinnedAfter = await service.snapshotPage(spaceId, first.revisionId, 100);
      assert.deepEqual(pinnedAfter.items.map((row) => row.pageId), [pageA]);
      assert.equal(pinnedAfter.head.revision, first.revisionId);
      assert.equal(pinnedAfter.head.sequence, first.sequence);

      const current = await service.head(spaceId);
      assert.equal(current.sequence, first.sequence + 1);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
