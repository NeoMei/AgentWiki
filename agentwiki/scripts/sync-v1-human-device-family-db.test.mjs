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

test('credential family enforces one provisional and one active credential', { skip }, async () => {
  const schema = `sync_family_unique_${randomUUID().replaceAll('-', '')}`;
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
    try {
      const userId = randomUUID();
      const deviceId = randomUUID();
      const vaultId = randomUUID();
      await prisma.user.create({ data: { id: userId, email: `${randomUUID()}@t.local`, type: 'human' } });
      const family = await prisma.humanDeviceCredentialFamily.create({
        data: { id: randomUUID(), userId, deviceId, vaultId },
      });

      const base = {
        credentialFamilyId: family.id,
        userId,
        deviceId,
        vaultId,
        deviceName: 'Test',
      };
      await prisma.humanDeviceCredential.create({
        data: { ...base, id: randomUUID(), credentialHash: `h-${randomUUID()}`, status: 'provisional', provisionalExpiresAt: new Date(Date.now() + 60_000) },
      });
      await prisma.humanDeviceCredential.create({
        data: { ...base, id: randomUUID(), credentialHash: `h-${randomUUID()}`, status: 'active' },
      });

      const secondProvisional = prisma.humanDeviceCredential.create({
        data: { ...base, id: randomUUID(), credentialHash: `h-${randomUUID()}`, status: 'provisional', provisionalExpiresAt: new Date(Date.now() + 60_000) },
      });
      await assert.rejects(() => secondProvisional, (error) => error?.code === 'P2002');

      const secondActive = prisma.humanDeviceCredential.create({
        data: { ...base, id: randomUUID(), credentialHash: `h-${randomUUID()}`, status: 'active' },
      });
      await assert.rejects(() => secondActive, (error) => error?.code === 'P2002');

      await prisma.humanDeviceCredential.updateMany({
        where: { credentialFamilyId: family.id, status: 'provisional' },
        data: { status: 'expired', provisionalExpiresAt: null },
      });
      await prisma.humanDeviceCredential.create({
        data: { ...base, id: randomUUID(), credentialHash: `h-${randomUUID()}`, status: 'provisional', provisionalExpiresAt: new Date(Date.now() + 60_000) },
      });

      await prisma.humanDeviceCredential.updateMany({
        where: { credentialFamilyId: family.id, status: 'active' },
        data: { status: 'revoked' },
      });
      await prisma.humanDeviceCredential.create({
        data: { ...base, id: randomUUID(), credentialHash: `h-${randomUUID()}`, status: 'active' },
      });
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
