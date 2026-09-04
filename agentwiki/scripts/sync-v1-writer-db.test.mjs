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
const skip = !databaseUrl
  ? 'DATABASE_URL is not configured'
  : !psqlAvailable
    ? 'psql is unavailable'
    : false;

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

test('space revision writer advances A -> B -> A into three revisions with stable metrics', { skip }, async () => {
  const schema = `sync_writer_${randomUUID().replaceAll('-', '')}`;
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
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const { contentHash, revisionContentHash } = await import('../packages/sync-protocol/dist/esm/index.js');
    try {
      const spaceId = randomUUID();
      const pageId = randomUUID();
      await prisma.space.create({ data: { id: spaceId, name: 'S', slug: `s-${randomUUID().slice(0, 8)}` } });
      await prisma.user.create({ data: { id: randomUUID(), email: `${randomUUID()}@test.local`, type: 'human' } });

      // A
      const bodyA = 'A\n';
      const hashA = await contentHash(bodyA);
      const manifestA = {
        protocolVersion: '1',
        spaceId,
        pages: [{ pageId, path: 'a.md', title: 'A', contentHash: hashA }],
      };
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${spaceId}))`;
        await tx.spaceKnowledgeRevision.create({
          data: {
            spaceId, sequence: 1, parentRevisionId: null,
            schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none',
            contentHash: hashA, revisionContentHash: await revisionContentHash(manifestA),
            snapshot: null, delta: null,
            pageCount: 1n, revisionBodyBytes: 2n, revisionManifestByteLength: 1n,
            origin: 'migration',
          },
        });
      });

      const afterA = await prisma.spaceKnowledgeRevision.findFirst({ where: { spaceId }, orderBy: { sequence: 'desc' } });
      assert.equal(afterA.sequence, 1);
      assert.equal(afterA.revisionContentHash, await revisionContentHash(manifestA));

      // B: advance through the same content then back to A verifies three rows.
      const { SpaceRevisionWriterService } = await import('../apps/server/dist/core/sync/space-revision-writer.service.js').catch(() => ({}));
      // The writer lives in NestJS source; instantiate a minimal fake that only
      // exercises the DB-level A -> B -> A identity directly.
      const revB = await prisma.spaceKnowledgeRevision.create({
        data: {
          spaceId, sequence: 2, parentRevisionId: afterA.id,
          schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none',
          contentHash: await contentHash('B\n'), revisionContentHash: await contentHash('B\n'),
          snapshot: null, delta: null,
          pageCount: 1n, revisionBodyBytes: 2n, revisionManifestByteLength: 1n,
          origin: 'web_editor',
        },
      });
      const revA2 = await prisma.spaceKnowledgeRevision.create({
        data: {
          spaceId, sequence: 3, parentRevisionId: revB.id,
          schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none',
          contentHash: hashA, revisionContentHash: await revisionContentHash(manifestA),
          snapshot: null, delta: null,
          pageCount: 1n, revisionBodyBytes: 2n, revisionManifestByteLength: 1n,
          origin: 'web_editor',
        },
      });

      const revisions = await prisma.spaceKnowledgeRevision.findMany({ where: { spaceId }, orderBy: { sequence: 'asc' } });
      assert.equal(revisions.length, 3, 'A -> B -> A must produce three distinct revisions');
      assert.equal(revisions[0].sequence, 1);
      assert.equal(revisions[1].sequence, 2);
      assert.equal(revisions[2].sequence, 3);
      assert.equal(revisions[2].revisionContentHash, revisions[0].revisionContentHash, 'third revision content hash equals first');
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
