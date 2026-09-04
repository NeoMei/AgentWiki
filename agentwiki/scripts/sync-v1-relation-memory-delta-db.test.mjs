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

test('relation/memory-only revision advances head with an empty sync v1 delta', { skip }, async () => {
  const schema = `sync_rel_mem_delta_${randomUUID().replaceAll('-', '')}`;
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
    const { SyncRevisionService } = await import('../apps/server/dist/integrations/obsidian/sync-revision.service.js');
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const writer = SpaceRevisionWriterService.legacyOnly(prisma);
    const revisions = new SyncRevisionService(prisma);

    try {
      const spaceId = randomUUID();
      const pageId = randomUUID();
      const userId = randomUUID();
      await prisma.space.create({ data: { id: spaceId, name: 'S', slug: `s-${randomUUID().slice(0, 8)}` } });
      await prisma.user.create({ data: { id: userId, email: `${randomUUID()}@t.local`, type: 'human' } });

      const parent = await prisma.$transaction((tx) => writer.advance(tx, spaceId, [{
        operation: 'upsert',
        pageId,
        path: 'a.md',
        title: 'A',
        body: '# A\n',
      }], {
        origin: 'web_editor',
        createdByUserId: userId,
      }));

      const changeSetId = randomUUID();
      await prisma.changeSet.create({
        data: { id: changeSetId, title: 'Relation only', status: 'published', spaceId, origin: 'review' },
      });
      const relationOnly = await prisma.$transaction((tx) => writer.advance(tx, spaceId, [], {
        origin: 'change_set',
        sourceChangeSetId: changeSetId,
        legacySidecarOverride: {
          schemaVersion: 'knowledge-bundle@1',
          recipeVersion: 'none',
          baseRevision: parent.revisionId,
          memories: [{ memoryId: randomUUID() }],
          relations: [{ relationId: randomUUID() }],
          provenance: [],
          deletions: [],
        },
      }));

      assert.equal(relationOnly.sequence, parent.sequence + 1);
      assert.equal(relationOnly.revisionContentHash, parent.revisionContentHash);

      const fromParent = await revisions.deltaPage(spaceId, parent.revisionId, 100);
      assert.deepEqual(fromParent.items, []);
      assert.equal(fromParent.toRevision, relationOnly.revisionId);
      assert.equal(fromParent.head.revisionContentHash, parent.revisionContentHash);

      const fromHead = await revisions.deltaPage(spaceId, relationOnly.revisionId, 100);
      assert.deepEqual(fromHead.items, []);
      assert.equal(fromHead.toRevision, relationOnly.revisionId);

      const deltaRows = await prisma.syncRevisionDeltaRow.count({ where: { revisionId: relationOnly.revisionId } });
      assert.equal(deltaRows, 0);

      const pageB = randomUUID();
      const afterRelation = await prisma.$transaction((tx) => writer.advance(tx, spaceId, [{
        operation: 'upsert', pageId: pageB, path: 'b.md', title: 'B', body: 'B',
      }], { origin: 'web_editor', createdByUserId: userId }));
      const nextRevision = await prisma.spaceKnowledgeRevision.findUnique({ where: { id: afterRelation.revisionId } });
      assert.equal(nextRevision.sequence, relationOnly.sequence + 1);
      assert.equal(nextRevision.parentRevisionId, relationOnly.revisionId);

      const afterRelationDelta = await revisions.deltaPage(spaceId, relationOnly.revisionId, 100);
      assert.equal(afterRelationDelta.items.length, 1);
      assert.equal(afterRelationDelta.items[0].pageId, pageB);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
