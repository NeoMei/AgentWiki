import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AgentService } from '../agent/agent.service';
import { UserService } from '../user/user.service';
import { lockLiveAgentAuthorization } from './live-agent-authorization';

const databaseUrl = process.env.DATABASE_URL;
const dbIt = databaseUrl ? it : it.skip;

describe('live Agent authorization row coordination', () => {
  dbIt('serializes a live write gate with a concurrent connection role change without deadlock', async () => {
    const first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = randomUUID();
    const userId = `auth-owner-${suffix}`;
    const agentId = `auth-agent-${suffix}`;
    const spaceId = `auth-space-${suffix}`;

    try {
      await first.user.create({ data: { id: userId, email: `${suffix}@auth-lock.test` } });
      await first.space.create({ data: { id: spaceId, name: 'Authorization lock test', slug: `auth-lock-${suffix}` } });
      await first.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
      await first.agent.create({ data: { id: agentId, ownerId: userId, name: 'Authorization lock Agent' } });
      const firstService = new AgentService(first as any);
      const initial = await firstService.exchangeConnectionIntent({
        ownerId: userId,
        agentId,
        spaceId,
        role: 'publisher',
        installationId: `initial-${suffix}`,
        rawKey: `agk_initial_${suffix}`,
      });

      let reportLocked!: () => void;
      let release!: () => void;
      const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      const holder = first.$transaction(async (tx) => {
        const state = await lockLiveAgentAuthorization(tx, {
          ownerId: userId,
          agentId,
          credentialId: initial.id,
        }, spaceId);
        expect(state?.grant.role).toBe('publisher');
        reportLocked();
        await released;
      }, { timeout: 10_000 });
      await locked;

      let exchangeFinished = false;
      const secondService = new AgentService(second as any);
      const exchange = secondService.exchangeConnectionIntent({
        ownerId: userId,
        agentId,
        spaceId,
        role: 'reader',
        installationId: `downgrade-${suffix}`,
        rawKey: `agk_downgrade_${suffix}`,
      }).finally(() => { exchangeFinished = true; });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(exchangeFinished).toBe(false);
      release();
      await Promise.all([holder, exchange]);

      await expect(first.agentGrant.findUnique({
        where: { agentId_spaceId: { agentId, spaceId } },
        select: { role: true },
      })).resolves.toEqual({ role: 'reader' });
    } finally {
      await first.space.deleteMany({ where: { id: spaceId } });
      await first.user.deleteMany({ where: { id: userId } });
      await Promise.all([first.$disconnect(), second.$disconnect()]);
    }
  }, 20_000);

  dbIt('serializes a live write gate with whole-Agent revocation without deadlock', async () => {
    const first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = randomUUID();
    const userId = `revoke-owner-${suffix}`;
    const agentId = `revoke-agent-${suffix}`;
    const spaceId = `revoke-space-${suffix}`;

    try {
      await first.user.create({ data: { id: userId, email: `${suffix}@revoke-lock.test` } });
      await first.space.create({ data: { id: spaceId, name: 'Agent revoke lock test', slug: `revoke-lock-${suffix}` } });
      await first.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
      await first.agent.create({ data: { id: agentId, ownerId: userId, name: 'Revoked authorization Agent' } });
      const initial = await new AgentService(first as any).exchangeConnectionIntent({
        ownerId: userId, agentId, spaceId, role: 'editor',
        installationId: `revoke-${suffix}`, rawKey: `agk_revoke_${suffix}`,
      });

      let reportLocked!: () => void;
      let release!: () => void;
      const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      const holder = first.$transaction(async (tx) => {
        expect(await lockLiveAgentAuthorization(tx, {
          ownerId: userId, agentId, credentialId: initial.id,
        }, spaceId)).not.toBeNull();
        reportLocked();
        await released;
      }, { timeout: 10_000 });
      await locked;

      let revokeFinished = false;
      const revoke = new AgentService(second as any).revoke(userId, agentId)
        .finally(() => { revokeFinished = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(revokeFinished).toBe(false);
      release();
      await Promise.all([holder, revoke]);

      await expect(first.agent.findUnique({
        where: { id: agentId }, select: { status: true, revokedAt: true },
      })).resolves.toMatchObject({ status: 'revoked', revokedAt: expect.any(Date) });
      await expect(first.agentCredential.findUnique({
        where: { id: initial.id }, select: { revokedAt: true },
      })).resolves.toMatchObject({ revokedAt: expect.any(Date) });
    } finally {
      await first.space.deleteMany({ where: { id: spaceId } });
      await first.user.deleteMany({ where: { id: userId } });
      await Promise.all([first.$disconnect(), second.$disconnect()]);
    }
  }, 20_000);

  dbIt('serializes a live write gate with owner account deletion without deadlock', async () => {
    const first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = randomUUID();
    const userId = `delete-owner-${suffix}`;
    const agentId = `delete-agent-${suffix}`;
    const spaceId = `delete-space-${suffix}`;

    try {
      await first.user.create({ data: { id: userId, email: `${suffix}@delete-lock.test` } });
      await first.space.create({ data: { id: spaceId, name: 'Owner deletion lock test', slug: `delete-lock-${suffix}` } });
      await first.spaceMember.create({ data: { userId, spaceId, role: 'admin' } });
      await first.agent.create({ data: { id: agentId, ownerId: userId, name: 'Deleted owner Agent' } });
      const initial = await new AgentService(first as any).exchangeConnectionIntent({
        ownerId: userId, agentId, spaceId, role: 'editor',
        installationId: `delete-${suffix}`, rawKey: `agk_delete_${suffix}`,
      });

      let reportLocked!: () => void;
      let release!: () => void;
      const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      const holder = first.$transaction(async (tx) => {
        expect(await lockLiveAgentAuthorization(tx, {
          ownerId: userId, agentId, credentialId: initial.id,
        }, spaceId)).not.toBeNull();
        reportLocked();
        await released;
      }, { timeout: 10_000 });
      await locked;

      let deletionFinished = false;
      const deletion = new UserService(second as any).remove(userId)
        .finally(() => { deletionFinished = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(deletionFinished).toBe(false);
      release();
      await Promise.all([holder, deletion]);

      await expect(first.user.findUnique({
        where: { id: userId }, select: { deletedAt: true },
      })).resolves.toMatchObject({ deletedAt: expect.any(Date) });
      await expect(first.agent.findUnique({
        where: { id: agentId }, select: { status: true, revokedAt: true },
      })).resolves.toMatchObject({ status: 'revoked', revokedAt: expect.any(Date) });
    } finally {
      await first.space.deleteMany({ where: { id: spaceId } });
      await first.user.deleteMany({ where: { id: userId } });
      await Promise.all([first.$disconnect(), second.$disconnect()]);
    }
  }, 20_000);
});
