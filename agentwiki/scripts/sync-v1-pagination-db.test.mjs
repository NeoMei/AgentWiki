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

test('snapshot keyset pagination returns fixed pages in pageId order', { skip }, async () => {
  const schema = `sync_pagination_${randomUUID().replaceAll('-', '')}`;
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
    const { SyncRevisionService } = await import('../apps/server/dist/integrations/obsidian/sync-revision.service.js');
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const service = new SyncRevisionService(prisma);
    try {
      const spaceId = randomUUID();
      const revisionId = randomUUID();
      const pages = ['a', 'b', 'c'];
      await prisma.space.create({ data: { id: spaceId, name: 'P', slug: `p-${randomUUID().slice(0, 8)}` } });
      await prisma.spaceKnowledgeRevision.create({ data: { id: revisionId, spaceId, sequence: 1, parentRevisionId: null, schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', contentHash: 'h', revisionContentHash: 'h', snapshot: null, delta: null, pageCount: 3n, revisionBodyBytes: 3n, revisionManifestByteLength: 3n, origin: 'migration' } });
      for (const pageId of pages) {
        const contentHash = `hash-${pageId}`;
        await prisma.syncPageContentRow.create({ data: { contentHash, body: pageId, byteLength: 1 } });
        await prisma.syncRevisionPageRow.create({ data: { revisionId, pageId, path: `${pageId}.md`, pathKey: `${pageId}.md`, title: pageId, contentHash, updatedAt: new Date() } });
      }
      const first = await service.snapshotPage(spaceId, revisionId, 2);
      assert.deepEqual(first.items.map((row) => row.pageId), ['a', 'b']);
      assert.equal(first.nextPageId, 'b');
      const second = await service.snapshotPage(spaceId, revisionId, 2, first.nextPageId);
      assert.deepEqual(second.items.map((row) => row.pageId), ['c']);
      assert.equal(second.nextPageId, undefined);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
