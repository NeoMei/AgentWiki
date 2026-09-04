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

test('expired sessions are marked then physically removed after retention', { skip }, async () => {
  const schema = `sync_session_expiry_${randomUUID().replaceAll('-', '')}`;
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
    const { SyncMaintenance } = await import('../apps/server/dist/core/sync/sync-maintenance.js');
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const maintenance = new SyncMaintenance(prisma, {});
    try {
      const recent = randomUUID();
      const ancient = randomUUID();
      const makeData = () => ({
        credentialFamilyId: randomUUID(), credentialId: randomUUID(), userId: randomUUID(),
        spaceId: randomUUID(), baseRevisionId: '0', idempotencyKey: randomUUID(), status: 'uploading',
        capabilitiesHash: 'c', confirmationHash: 'h', confirmationByteLength: 1, changeCount: 1, totalBodyBytes: 1n,
      });
      await prisma.pushSession.create({ data: { id: recent, ...makeData(), expiresAt: new Date(Date.now() - 60 * 60 * 1000) } });
      await prisma.pushSession.create({ data: { id: ancient, ...makeData(), expiresAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } });
      await maintenance.expirePushSessions();
      assert.equal((await prisma.pushSession.findUnique({ where: { id: recent } })).status, 'expired');
      assert.equal(await prisma.pushSession.findUnique({ where: { id: ancient } }), null);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
