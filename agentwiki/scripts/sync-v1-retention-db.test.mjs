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

test('revision retention keeps head and cursor window, removes only expired non-heads', { skip }, async () => {
  const schema = `sync_retention_${randomUUID().replaceAll('-', '')}`;
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
    const { RevisionRetentionService } = await import('../apps/server/dist/core/sync/revision-retention.service.js');
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const service = new RevisionRetentionService(prisma);
    try {
      const spaceId = randomUUID();
      const now = Date.now();
      await prisma.space.create({ data: { id: spaceId, name: 'R', slug: `r-${randomUUID().slice(0, 8)}` } });
      const createRevision = (
        id,
        sequence,
        parentRevisionId,
        createdAt,
        supersededAt,
      ) => prisma.spaceKnowledgeRevision.create({
        data: {
          id, spaceId, sequence, parentRevisionId,
          schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', contentHash: id,
          revisionContentHash: id, snapshot: null, delta: null,
          pageCount: 0n, revisionBodyBytes: 0n, revisionManifestByteLength: 0n,
          origin: 'web_editor', createdAt: new Date(createdAt), supersededAt: supersededAt ? new Date(supersededAt) : null,
        },
      });
      const expiredId = randomUUID();
      const safeCursorId = randomUUID();
      const headId = randomUUID();
      await createRevision(
        expiredId, 1, null,
        now - 32 * 24 * 60 * 60 * 1000,
        now - 32 * 24 * 60 * 60 * 1000,
      );
      await createRevision(safeCursorId, 2, expiredId, now, now - 60 * 60 * 1000);
      await createRevision(headId, 3, safeCursorId, now - 365 * 24 * 60 * 60 * 1000, null);

      const removed = await service.cleanSpace(spaceId);
      assert.equal(removed, 1);
      const remaining = await prisma.spaceKnowledgeRevision.findMany({ where: { spaceId }, select: { id: true }, orderBy: { sequence: 'asc' } });
      assert.deepEqual(remaining.map((r) => r.id).sort(), [safeCursorId, headId].sort());
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
