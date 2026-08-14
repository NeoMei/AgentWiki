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

test('advance copies parent rows via INSERT SELECT and aggregates metrics in SQL', { skip }, async () => {
  const schema = `sync_advance_${randomUUID().replaceAll('-', '')}`;
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
    const { SpaceRevisionWriterService } = await import('../apps/server/dist/core/sync/space-revision-writer.service.js');
    const { LegacyBundleHashStream } = await import('../apps/server/dist/core/sync/legacy-serializer.js');
    const writer = new SpaceRevisionWriterService(prisma);
    try {
      const spaceId = randomUUID();
      const pageA = randomUUID();
      const pageB = randomUUID();
      await prisma.space.create({ data: { id: spaceId, name: 'S', slug: `s-${randomUUID().slice(0, 8)}` } });

      const rev1 = await prisma.$transaction(async (tx) => {
        await writer.lockSpace(tx, spaceId);
        return writer.advance(tx, spaceId, [
          { operation: 'upsert', pageId: pageA, path: 'a.md', title: 'A', body: 'A\n' },
          { operation: 'upsert', pageId: pageB, path: 'b.md', title: 'B', body: 'BB\n' },
        ], { origin: 'web_editor' });
      });
      assert.equal(rev1.pageCount, 2n);
      assert.equal(rev1.revisionBodyBytes, 5n); // 'A\n' = 2 bytes, 'BB\n' = 3 bytes

      const rev2 = await prisma.$transaction(async (tx) => {
        await writer.lockSpace(tx, spaceId);
        return writer.advance(tx, spaceId, [
          { operation: 'archive', pageId: pageA, previousPath: 'a.md' },
        ], { origin: 'web_editor' });
      });
      assert.equal(rev2.pageCount, 1n);
      assert.equal(rev2.revisionBodyBytes, 3n);

      const rev2Rows = await prisma.syncRevisionPageRow.findMany({ where: { revisionId: rev2.revisionId } });
      assert.deepEqual(rev2Rows.map((r) => r.pageId), [pageB]);

      const delta = await prisma.syncRevisionDeltaRow.findMany({ where: { revisionId: rev2.revisionId }, orderBy: { ordinal: 'asc' } });
      assert.equal(delta.length, 1);
      assert.equal(delta[0].operation, 'archive');
      assert.equal(delta[0].previousPath, 'a.md');

      // Sidecar, page extra, and body blob must be written so the legacy DTO
      // remains synthesizable after snapshot/delta become null in Release B.
      const rev1Extras = await prisma.legacyRevisionPageExtra.findMany({ where: { revisionId: rev1.revisionId }, orderBy: { ordinal: 'asc' } });
      assert.equal(rev1Extras.length, 2);
      const rev2Extras = await prisma.legacyRevisionPageExtra.findMany({ where: { revisionId: rev2.revisionId }, orderBy: { ordinal: 'asc' } });
      assert.deepEqual(rev2Extras.map((e) => e.pageId), [pageB]);
      const blob = await prisma.legacyPageBodyRow.findUnique({ where: { contentHash: rev2Extras[0].legacyBodyHash } });
      assert.equal(blob.body, 'BB\n');

      // The persisted revision contentHash must equal the hash of the legacy
      // bundle reconstructed from sidecar + extras + body blobs.
      const rev2Record = await prisma.spaceKnowledgeRevision.findUnique({ where: { id: rev2.revisionId } });
      const sidecar = await prisma.legacyRevisionSidecar.findUnique({ where: { revisionId: rev2.revisionId } });
      const stream = new LegacyBundleHashStream('knowledge-bundle@1', 'none', spaceId, null);
      for (const extra of rev2Extras) {
        const value = extra.extra;
        const bodyRow = await prisma.legacyPageBodyRow.findUnique({ where: { contentHash: extra.legacyBodyHash } });
        stream.appendPage({
          pageId: extra.pageId, spaceId, path: value.path, title: value.title, body: bodyRow.body,
          order: value.order ?? 0, metadata: value.metadata ?? null, artifactIds: value.artifactIds ?? [],
          contentHash: value.contentHash ?? extra.legacyBodyHash, updatedAt: value.updatedAt,
        });
      }
      const synthesizedHash = stream.digest([], [], [], []);
      assert.equal(rev2Record.contentHash, synthesizedHash, 'persisted legacy contentHash matches synthesized bundle hash');
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
