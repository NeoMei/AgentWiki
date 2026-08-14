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

function deploySchema(schema) {
  assert.equal(runPsql(`CREATE SCHEMA "${schema}"`).status, 0);
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  const deploy = spawnSync('pnpm', ['--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url.href },
  });
  assert.equal(deploy.status, 0, `migrate deploy failed:\n${deploy.stdout}\n${deploy.stderr}`);
  return url;
}

async function loadPrisma(url) {
  const { createRequire } = await import('node:module');
  const require = createRequire(resolve(root, 'apps/server/package.json'));
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ datasources: { db: { url: url.href } } });
}

test('backfill blocks U+FEFF without exposing a half-migrated page', { skip }, async () => {
  const schema = `sync_backfill_bom_${randomUUID().replaceAll('-', '')}`;
  const quoted = `"${schema}"`;
  try {
    const url = deploySchema(schema);
    const prisma = await loadPrisma(url);
    try {
      const spaceId = randomUUID();
      const userId = randomUUID();
      const badPage = randomUUID();
      await prisma.space.create({ data: { id: spaceId, name: 'BOM', slug: `bom-${randomUUID().slice(0, 8)}` } });
      await prisma.user.create({ data: { id: userId, email: `${randomUUID()}@t.local`, type: 'human' } });
      await prisma.page.create({
        data: { id: randomUUID(), knowledgeKey: badPage, title: 'Bad', slug: 'bad', content: '\uFEFFbad', format: 'markdown', spaceId, authorId: userId, syncPath: '', syncPathKey: '', lastModifiedByUserId: userId, lastModifiedAt: new Date() },
      });

      const { backfillSpace } = await import(resolve(root, 'scripts/backfill-sync-v1.mjs'));
      await assert.rejects(() => backfillSpace(prisma, spaceId, randomUUID()), /U\+FEFF/);

      const bad = await prisma.page.findUnique({ where: { knowledgeKey: badPage } });
      assert.equal(bad.content, '\uFEFFbad');
      assert.equal(bad.syncPath, '');
      assert.equal(await prisma.pageVersion.count({ where: { pageId: bad.id } }), 0);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});

test('backfill falls back deterministically for a non-portable source path', { skip }, async () => {
  const schema = `sync_backfill_fallback_${randomUUID().replaceAll('-', '')}`;
  const quoted = `"${schema}"`;
  try {
    const url = deploySchema(schema);
    const prisma = await loadPrisma(url);
    try {
      const spaceId = randomUUID();
      const userId = randomUUID();
      const pageId = randomUUID();
      await prisma.space.create({ data: { id: spaceId, name: 'Fallback', slug: `fallback-${randomUUID().slice(0, 8)}` } });
      await prisma.user.create({ data: { id: userId, email: `${randomUUID()}@t.local`, type: 'human' } });
      await prisma.page.create({
        data: { id: randomUUID(), knowledgeKey: pageId, title: 'Fallback', slug: 'fallback', content: 'body', format: 'markdown', spaceId, authorId: userId, sourcePath: '../bad.md', syncPath: '', syncPathKey: '', lastModifiedByUserId: userId, lastModifiedAt: new Date() },
      });

      const { backfillSpace } = await import(resolve(root, 'scripts/backfill-sync-v1.mjs'));
      await backfillSpace(prisma, spaceId, randomUUID());

      const page = await prisma.page.findUnique({ where: { knowledgeKey: pageId } });
      assert.notEqual(page.syncPath, '');
      assert.match(page.syncPath, /^pages\/p-[a-f0-9]{64}\.md$/);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
