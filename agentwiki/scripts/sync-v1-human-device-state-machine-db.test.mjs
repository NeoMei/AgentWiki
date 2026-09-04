import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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

test('exchange replaces older provisional and activate converges to one active', { skip }, async () => {
  const schema = `sync_device_state_${randomUUID().replaceAll('-', '')}`;
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
    const { ObsidianIntegrationService } = await import('../apps/server/dist/integrations/obsidian/obsidian-integration.service.js');
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    const serverInstanceId = randomUUID();
    const crypto = {
      newCode: () => randomBytes(32).toString('base64url'),
      installationCodeHash: (code) => hash(`code:${code}`),
      credentialHash: (credential) => hash(`credential:${credential}`),
      getServerInstanceId: async () => serverInstanceId,
    };
    const audit = { record: async () => {} };
    const redis = { incrementWithWindow: async () => 1 };
    const service = new ObsidianIntegrationService(prisma, crypto, audit, redis);

    try {
      const userId = randomUUID();
      const deviceId = randomUUID();
      const vaultId = randomUUID();
      await prisma.user.create({ data: { id: userId, email: `${randomUUID()}@t.local`, type: 'human' } });

      const baseRequest = {
        deviceId,
        vaultId,
        deviceName: 'State Machine',
        pluginVersion: '1.0.0',
        supportedProtocolVersions: ['1'],
      };
      const code1 = crypto.newCode();
      const installation1 = await prisma.obsidianInstallation.create({
        data: { id: randomUUID(), codeHash: crypto.installationCodeHash(code1), userId, expiresAt: new Date(Date.now() + 60000) },
      });
      const credential1 = crypto.newCode();
      const request1 = { code: code1, exchangeId: randomUUID(), credential: credential1, ...baseRequest };
      const exchange1 = await service.exchange(request1, '127.0.0.1');
      assert.equal(exchange1.credentialStatus, 'provisional');
      const credential1Id = exchange1.credentialId;

      const code2 = crypto.newCode();
      const installation2 = await prisma.obsidianInstallation.create({
        data: { id: randomUUID(), codeHash: crypto.installationCodeHash(code2), userId, expiresAt: new Date(Date.now() + 60000) },
      });
      const credential2 = crypto.newCode();
      const request2 = { code: code2, exchangeId: randomUUID(), credential: credential2, ...baseRequest };
      const exchange2 = await service.exchange(request2, '127.0.0.1');
      assert.equal(exchange2.credentialStatus, 'provisional');
      assert.notEqual(exchange1.credentialId, exchange2.credentialId);

      const first = await prisma.humanDeviceCredential.findUnique({ where: { id: credential1Id } });
      assert.equal(first.status, 'revoked');
      const familyId = first.credentialFamilyId;
      assert.equal(await prisma.humanDeviceCredential.count({ where: { credentialFamilyId: familyId, status: 'provisional' } }), 1);
      assert.equal(await prisma.humanDeviceCredential.count({ where: { credentialFamilyId: familyId, status: 'active' } }), 0);

      await assert.rejects(
        () => service.activate({ userId, credentialId: credential1Id, credentialFamilyId: familyId }, credential1Id),
        (error) => error?.syncCode === 'DEVICE_CREDENTIAL_REVOKED',
      );

      const active = await service.activate({ userId, credentialId: exchange2.credentialId, credentialFamilyId: familyId }, exchange2.credentialId);
      assert.equal(active.credentialStatus, 'active');
      assert.equal(await prisma.humanDeviceCredential.count({ where: { credentialFamilyId: familyId, status: 'active' } }), 1);
      assert.equal(await prisma.humanDeviceCredential.count({ where: { credentialFamilyId: familyId, status: 'provisional' } }), 0);

      const idempotent = await service.activate({ userId, credentialId: exchange2.credentialId, credentialFamilyId: familyId }, exchange2.credentialId);
      assert.equal(idempotent.credentialStatus, 'active');
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
