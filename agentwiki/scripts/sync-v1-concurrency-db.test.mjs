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

async function freshSchema() {
  const schema = `sync_conc_${randomUUID().replaceAll('-', '')}`;
  assert.equal(runPsql(`CREATE SCHEMA "${schema}"`).status, 0);
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
  return { schema, prisma };
}

test('two spaces cannot concurrently create the same public pageId', { skip }, async () => {
  const { schema, prisma } = await freshSchema();
  try {
    const ownerId = randomUUID();
    const spaceA = randomUUID();
    const spaceB = randomUUID();
    const pageId = randomUUID();
    await prisma.user.create({ data: { id: ownerId, email: `${randomUUID()}@t.local`, type: 'human' } });
    await prisma.space.createMany({
      data: [
        { id: spaceA, name: 'A', slug: `a-${randomUUID().slice(0, 8)}` },
        { id: spaceB, name: 'B', slug: `b-${randomUUID().slice(0, 8)}` },
      ],
    });
    const attempt = (spaceId) => prisma.page.create({
      data: {
        id: randomUUID(), knowledgeKey: pageId, title: 'T', slug: randomUUID(),
        content: '', format: 'markdown', spaceId, authorId: ownerId,
        syncPath: `pages/p-${pageId}.md`, syncPathKey: pageId, lastModifiedAt: new Date(),
      },
    });
    const results = await Promise.allSettled([attempt(spaceA), attempt(spaceB)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    assert.equal(fulfilled, 1, 'exactly one space must win the global pageId');
    assert.equal(rejected, 1, 'the other space must be rejected by the global unique constraint');
    assert.equal(await prisma.page.count({ where: { knowledgeKey: pageId } }), 1);
  } finally {
    await prisma.$disconnect();
    runPsql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
});

test('concurrent create push session with same idempotency key yields one row', { skip }, async () => {
  const { schema, prisma } = await freshSchema();
  try {
    const familyId = randomUUID();
    const spaceId = randomUUID();
    const idempotencyKey = randomUUID();
    const sessionId = randomUUID();
    const attempt = () => prisma.pushSession.create({
      data: {
        id: sessionId, credentialFamilyId: familyId, credentialId: randomUUID(),
        userId: randomUUID(), spaceId, baseRevisionId: '0', idempotencyKey,
        status: 'uploading', capabilitiesHash: 'c', confirmationHash: 'h',
        confirmationByteLength: 1, changeCount: 1, totalBodyBytes: 1n,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const results = await Promise.allSettled([attempt(), attempt()]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await prisma.pushSession.count({ where: { credentialFamilyId: familyId, idempotencyKey } }), 1);
  } finally {
    await prisma.$disconnect();
    runPsql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
});
