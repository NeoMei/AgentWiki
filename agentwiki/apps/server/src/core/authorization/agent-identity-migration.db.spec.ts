import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { AuthorizationService } from './authorization.service';
import { AuthService } from '../auth/auth.service';
import { createHash } from 'crypto';

function hasIsolatedTestDatabase(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url || url !== process.env.COLLABORATION_TEST_DATABASE_URL) return false;
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      && /test/i.test(parsed.pathname)
      && /^collaboration_test_/.test(parsed.searchParams.get('schema') ?? '');
  } catch { return false; }
}
const dbIt = hasIsolatedTestDatabase() ? it : it.skip;

describe('Agent identity credential migration', () => {
  dbIt('preserves historical key lifecycle data and removes Grant deletion cascade', async () => {
    const db = new PrismaClient();
    try {
      await db.$transaction(async tx => {
        // Temporary tables isolate the pre-migration shape from the real schema.
        await tx.$executeRawUnsafe('CREATE TEMP TABLE "AgentGrant" (id TEXT PRIMARY KEY, "agentId" TEXT, UNIQUE(id, "agentId")) ON COMMIT DROP');
        await tx.$executeRawUnsafe('CREATE TEMP TABLE "AgentCredential" (id TEXT PRIMARY KEY, "agentId" TEXT, "authorizationId" TEXT NOT NULL, "keyHash" TEXT, "localSyncInstallationId" TEXT, "revokedAt" TIMESTAMP, "expiresAt" TIMESTAMP, CONSTRAINT "AgentCredential_authorizationId_agentId_fkey" FOREIGN KEY ("authorizationId", "agentId") REFERENCES "AgentGrant"(id, "agentId") ON DELETE CASCADE) ON COMMIT DROP');
        await tx.$executeRawUnsafe('CREATE INDEX "AgentCredential_authorizationId_agentId_idx" ON "AgentCredential"("authorizationId", "agentId")');
        await tx.$executeRawUnsafe(`INSERT INTO "AgentGrant" VALUES ('grant-a','agent')`);
        await tx.$executeRawUnsafe(`INSERT INTO "AgentCredential" VALUES ('active','agent','grant-a','hash-active','installation-active',NULL,NULL), ('revoked','agent','grant-a','hash-revoked','installation-revoked','2026-01-01',NULL), ('expired','agent','grant-a','hash-expired','installation-expired',NULL,'2026-01-01')`);
        const before = await tx.$queryRawUnsafe('SELECT * FROM "AgentCredential" ORDER BY id');
        const sql = readFileSync(resolve(__dirname, '../../../prisma/migrations/20261014120000_agent_identity_credentials/migration.sql'), 'utf8');
        for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
        await tx.$executeRawUnsafe(`DELETE FROM "AgentGrant" WHERE id='grant-a'`);
        expect(await tx.$queryRawUnsafe('SELECT * FROM "AgentCredential" ORDER BY id')).toEqual(before);
        await tx.$executeRawUnsafe(`INSERT INTO "AgentCredential" (id,"agentId","keyHash") VALUES ('new','agent','hash-new')`);
        expect(await tx.$queryRawUnsafe(`SELECT "authorizationId" FROM "AgentCredential" WHERE id='new'`)).toEqual([{ authorizationId: null }]);
      });
    } finally { await db.$disconnect(); }
  });

  dbIt('keeps one original key valid after grant changes, with per-Space roles and global revocation', async () => {
    const db = new PrismaClient();
    const suffix = randomUUID();
    const userId = `identity-owner-${suffix}`;
    const agentId = `identity-agent-${suffix}`;
    const spaces = [`identity-a-${suffix}`, `identity-b-${suffix}`];
    const rawKey = `agk_identity_${suffix}`;
    const auth = new AuthService({} as any, db as any);
    const authorization = new AuthorizationService(db as any);
    try {
      await db.user.create({ data: { id: userId, email: `${suffix}@identity.test` } });
      await db.agent.create({ data: { id: agentId, ownerId: userId, name: 'identity test' } });
      for (const id of spaces) await db.space.create({ data: { id, slug: id, name: id } });
      const grantA = await db.agentGrant.create({ data: { agentId, spaceId: spaces[0], role: 'reader' } });
      const credential = await db.agentCredential.create({ data: { agentId, name: 'original', prefix: 'agk_identity', keyHash: createHash('sha256').update(rawKey).digest('hex'), legacyAuthorizationId: grantA.id } });
      const principal = (await auth.validateApiKey(rawKey))!;
      expect(await authorization.getAccessibleSpaceIds(principal)).toEqual([spaces[0]]);
      await db.agentGrant.create({ data: { agentId, spaceId: spaces[1], role: 'publisher' } });
      await expect(authorization.assertSpaceAccess(principal, spaces[1], ['editor'], 'pages:write')).resolves.toMatchObject({ role: 'publisher' });
      await expect(authorization.assertSpaceAccess(principal, spaces[0], ['editor'], 'pages:write')).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
      await db.agentGrant.delete({ where: { id: grantA.id } });
      expect(await auth.validateApiKey(rawKey)).not.toBeNull();
      expect(await authorization.getAccessibleSpaceIds(principal)).toEqual([spaces[1]]);
      await expect(authorization.assertSpaceAccess(principal, spaces[0])).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
      await expect(authorization.assertSpaceAccess({ ...principal, agentId: 'different-agent' }, spaces[1])).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
      // Every global identity lifecycle gate must invalidate all Space access.
      for (const change of [
        { apply: () => db.user.update({ where: { id: userId }, data: { lockedAt: new Date() } }), undo: () => db.user.update({ where: { id: userId }, data: { lockedAt: null } }) },
        { apply: () => db.user.update({ where: { id: userId }, data: { deletedAt: new Date() } }), undo: () => db.user.update({ where: { id: userId }, data: { deletedAt: null } }) },
        { apply: () => db.agent.update({ where: { id: agentId }, data: { status: 'paused' } }), undo: () => db.agent.update({ where: { id: agentId }, data: { status: 'active' } }) },
        { apply: () => db.agentCredential.update({ where: { id: credential.id }, data: { expiresAt: new Date(0) } }), undo: () => db.agentCredential.update({ where: { id: credential.id }, data: { expiresAt: null } }) },
      ]) {
        await change.apply();
        expect(await auth.validateApiKey(rawKey)).toBeNull();
        expect(await authorization.getAccessibleSpaceIds(principal)).toEqual([]);
        await expect(authorization.assertSpaceAccess(principal, spaces[1])).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
        await change.undo();
      }
      await db.agentCredential.update({ where: { id: credential.id }, data: { revokedAt: new Date() } });
      expect(await auth.validateApiKey(rawKey)).toBeNull();
      expect(await authorization.getAccessibleSpaceIds(principal)).toEqual([]);
      await expect(authorization.assertSpaceAccess(principal, spaces[1])).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    } finally {
      await db.space.deleteMany({ where: { id: { in: spaces } } });
      await db.user.deleteMany({ where: { id: userId } });
      await db.$disconnect();
    }
  });
});
