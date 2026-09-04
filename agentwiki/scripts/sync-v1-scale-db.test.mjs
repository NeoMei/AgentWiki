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

test('5000 pages and 100 MiB body metrics advance through the bounded writer', { skip }, async () => {
  const schema = `sync_scale_${randomUUID().replaceAll('-', '')}`;
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
    const writer = new SpaceRevisionWriterService(prisma);
    try {
      const spaceId = randomUUID();
      const body = 'x'.repeat(20 * 1024 - 1) + '\n';
      const bodyBytes = new TextEncoder().encode(body).byteLength;
      assert.equal(bodyBytes, 20 * 1024);
      await prisma.space.create({ data: { id: spaceId, name: 'Scale', slug: `scale-${randomUUID().slice(0, 8)}` } });
      const changes = Array.from({ length: 5000 }, (_, index) => ({
        operation: 'upsert',
        pageId: randomUUID(),
        path: `pages/p-${index}.md`,
        title: `Page ${index}`,
        body,
      }));
      const result = await prisma.$transaction(async (tx) => {
        const lockedTx = await writer.lockSpace(tx, spaceId);
        return writer.advanceLocked(lockedTx, spaceId, changes, { origin: 'migration' });
      }, { timeout: 120_000 });
      assert.equal(result.pageCount, 5000n);
      assert.equal(result.revisionBodyBytes, BigInt(bodyBytes * 5000));
      assert.ok(result.revisionManifestByteLength > 0n);
      assert.equal(await prisma.syncRevisionPageRow.count({ where: { revisionId: result.revisionId } }), 5000);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
