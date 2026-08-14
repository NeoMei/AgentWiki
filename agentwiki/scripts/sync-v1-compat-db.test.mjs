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

test('legacy DTO synthesis restores pages after snapshot/delta become null', { skip }, async () => {
  const schema = `sync_compat_${randomUUID().replaceAll('-', '')}`;
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
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    try {
      const spaceId = randomUUID();
      const pageId = randomUUID();
      const revisionId = randomUUID();
      await prisma.space.create({ data: { id: spaceId, name: 'S', slug: `s-${randomUUID().slice(0, 8)}` } });
      await prisma.spaceKnowledgeRevision.create({
        data: {
          id: revisionId, spaceId, sequence: 1, parentRevisionId: null,
          schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none',
          contentHash: 'legacy-hash', revisionContentHash: 'rev-hash',
          snapshot: null, delta: null, pageCount: 1n, revisionBodyBytes: 6n,
          revisionManifestByteLength: 10n, origin: 'migration',
        },
      });
      await prisma.legacyRevisionSidecar.create({
        data: { revisionId, sidecar: { schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', baseRevision: null, memories: [], relations: [], provenance: [], deletions: [] } },
      });
      await prisma.legacyPageBodyRow.create({ data: { contentHash: 'body-hash', body: 'Original\r\nBody' } });
      await prisma.legacyRevisionPageExtra.create({
        data: {
          revisionId, pageId, ordinal: 0, legacyBodyHash: 'body-hash',
          extra: { spaceId, title: 'Title', path: 'p.md', order: 0, metadata: null, artifactIds: [], legacyBodyHash: 'body-hash', contentHash: 'legacy-page-hash', updatedAt: '2026-01-01T00:00:00.000Z' },
        },
      });

      const { KnowledgeRevisionService } = await import('../apps/server/dist/knowledge-revision/knowledge-revision.service.js');
      const service = new KnowledgeRevisionService(prisma);
      const snapshot = await service.snapshot(spaceId, revisionId);
      assert.equal(snapshot.bundle.pages.length, 1);
      assert.equal(snapshot.bundle.pages[0].pageId, pageId);
      assert.equal(snapshot.bundle.pages[0].title, 'Title');
      assert.equal(snapshot.bundle.pages[0].body, 'Original\r\nBody');
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
