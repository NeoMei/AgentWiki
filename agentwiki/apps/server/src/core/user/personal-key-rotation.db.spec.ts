import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { OnboardBootstrapService } from '../../onboard/onboard-bootstrap.service';
import { OnboardDeviceService } from '../../onboard/onboard-device.service';
import { OnboardModule } from '../../onboard/onboard.module';
import { hashServerPlan, type ServerPlan } from '../../onboard/onboard.types';
import { OnboardingTokenGuard, type OnboardingPrincipal } from '../../onboard/onboarding-token.guard';
import { AgentService } from '../agent/agent.service';
import { LocalSyncInstallationService } from '../agent/local-sync-installation.service';
import { AuthService } from '../auth/auth.service';
import { UserService } from './user.service';

const describeWithDatabase = process.env.PERSONAL_KEY_ROTATION_DB_TEST === '1' ? describe : describe.skip;

describeWithDatabase('personal Key rotation with PostgreSQL and Redis', () => {
  let fixture: TestingModule;
  let db: PrismaService;
  let redis: RedisService;
  let users: UserService;
  let agents: AgentService;
  let installations: LocalSyncInstallationService;
  let auth: AuthService;
  let ipSequence = 0;
  const prefix = `key-rotation-${randomUUID()}`;
  const userIds: string[] = [];
  const spaceIds: string[] = [];
  const ip = () => `${prefix}-${ipSequence++}`;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    const cache = new URL(process.env.REDIS_URL!);
    if (!database.pathname.startsWith('/personal_key_rotation_test_')
      || database.hostname !== '127.0.0.1' || cache.hostname !== '127.0.0.1') {
      throw new Error('Dedicated local PostgreSQL and Redis instances are required');
    }
    fixture = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), OnboardModule],
    }).compile();
    db = fixture.get(PrismaService);
    redis = fixture.get(RedisService);
    await db.$connect();
    await redis.onModuleInit();
    users = new UserService(db);
    agents = fixture.get(AgentService);
    installations = fixture.get(LocalSyncInstallationService);
    auth = fixture.get(AuthService);
  }, 30_000);

  afterAll(async () => {
    if (db) {
      await db.onboardingDeviceSession.deleteMany({ where: { authorizedUserId: { in: userIds } } });
      await db.space.deleteMany({ where: { id: { in: spaceIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.securityAuditEvent.deleteMany({ where: { ipAddress: { startsWith: prefix } } });
    }
    await fixture?.close();
  });

  async function ownerFixture() {
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.invalid` } });
    userIds.push(user.id);
    const agent = await agents.create(user.id, { name: 'Rotation fixture' });
    const space = await db.space.create({
      data: {
        name: 'Rotation fixture', slug: `${prefix}-${spaceIds.length}`,
        members: { create: { userId: user.id, role: 'owner' } },
      },
    });
    spaceIds.push(space.id);
    const issue = () => installations.create(user.id, agent.id, space.id, 'editor', '0.9.1', 'https://wiki.test/api');
    const exchange = async () => installations.exchange((await issue()).code, ip());
    return { user, agent, space, issue, exchange };
  }

  async function connectDevice(userId: string) {
    const devices = fixture.get(OnboardDeviceService);
    const started = await devices.start({ purpose: 'agent-connect', clientType: 'codex', packageVersion: '0.9.1' }, ip());
    await devices.decide({ userCode: started.userCode, decision: 'approve' }, userId, ip());
    const authorized = await devices.poll({ deviceCode: started.deviceCode }, ip());
    const request = { headers: { authorization: `Bearer ${authorized.onboardingToken}` } };
    const authorize = async (input: { headers: { authorization: string } }) => {
      await fixture.get(OnboardingTokenGuard).canActivate({ switchToHttp: () => ({ getRequest: () => input }) } as any);
      return (input as typeof input & { onboarding: OnboardingPrincipal }).onboarding;
    };
    return { devices, started, request, authorize, principal: await authorize(request) };
  }

  it('revokes every owned credential and unused code while preserving identity and grants for a fresh reconnect', async () => {
    const owner = await ownerFixture();
    const other = await ownerFixture();
    const anotherAgent = await agents.create(owner.user.id, { name: 'Second owned Agent' });
    const another = await installations.create(owner.user.id, anotherAgent.id, owner.space.id, 'reader', '0.9.1', 'https://wiki.test/api');
    const live = await owner.exchange();
    const liveAgain = await owner.exchange();
    const secondLive = await installations.exchange(another.code, ip());
    const otherLive = await other.exchange();
    const otherUnused = await other.issue();
    const oldPersonal = await users.regenerateApiKey(owner.user.id);
    const otherPersonal = await users.regenerateApiKey(other.user.id);
    const unused = await owner.issue();
    const legacy = await owner.issue();
    const legacyKey = `local-sync:install:${legacy.installationId}`;
    const legacyPayload = JSON.parse((await redis.getStrict(legacyKey))!);
    delete legacyPayload.personalKeyRotation;
    await redis.setStrict(legacyKey, JSON.stringify(legacyPayload), 600);
    const grant = await db.agentGrant.update({
      where: { agentId_spaceId: { agentId: owner.agent.id, spaceId: owner.space.id } },
      data: { folderScopes: ['folders:read'] },
    });
    expect(Boolean(await auth.validateApiKey(live.apiKey))).toBe(true);

    const replacement = await users.regenerateApiKey(owner.user.id);

    for (const credential of [oldPersonal, live.apiKey, liveAgain.apiKey, secondLive.apiKey]) {
      expect(Boolean(await auth.validateApiKey(credential))).toBe(false);
    }
    expect(Boolean(await auth.validateApiKey(replacement))).toBe(true);
    expect(Boolean(await auth.validateApiKey(otherPersonal))).toBe(true);
    expect(Boolean(await auth.validateApiKey(otherLive.apiKey))).toBe(true);
    await expect(installations.exchange(otherUnused.code, ip())).resolves.toMatchObject({ agentId: other.agent.id });
    for (const code of [unused.code, legacy.code, another.code]) {
      await expect(installations.exchange(code, ip())).rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_INVALID' });
    }
    expect(await agents.getOwned(owner.user.id, owner.agent.id)).toMatchObject({ id: owner.agent.id, status: 'active', reconnectRequired: true });
    expect(await agents.list(owner.user.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: owner.agent.id, reconnectRequired: true }),
      expect.objectContaining({ id: anotherAgent.id, reconnectRequired: true }),
    ]));
    expect(await db.agentGrant.findUnique({ where: { id: grant.id } })).toEqual(grant);

    const reconnected = await owner.exchange();
    expect(reconnected.agentId).toBe(owner.agent.id);
    expect(reconnected.credentialId).not.toBe(live.credentialId);
    expect(Boolean(await auth.validateApiKey(reconnected.apiKey))).toBe(true);
    expect(await agents.getOwned(owner.user.id, owner.agent.id)).toMatchObject({ reconnectRequired: false });
    expect(await db.agentGrant.findUnique({ where: { id: grant.id } })).toEqual(grant);
  });

  it('keeps first issuance non-disruptive and treats a revoked historical Key as a regeneration', async () => {
    const owner = await ownerFixture();
    const connected = await owner.exchange();
    const unused = await owner.issue();
    await users.regenerateApiKey(owner.user.id);
    expect(Boolean(await auth.validateApiKey(connected.apiKey))).toBe(true);
    await expect(installations.exchange(unused.code, ip())).resolves.toMatchObject({ agentId: owner.agent.id });

    await users.revokeApiKey(owner.user.id);
    const beforeRegeneration = await owner.issue();
    await users.regenerateApiKey(owner.user.id);
    expect(Boolean(await auth.validateApiKey(connected.apiKey))).toBe(false);
    await expect(installations.exchange(beforeRegeneration.code, ip())).rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_INVALID' });
  });

  it('serializes concurrent first issues so one rotates and exactly one personal Key remains usable', async () => {
    const owner = await ownerFixture();
    const connected = await owner.exchange();
    const keys = await Promise.all([
      users.regenerateApiKey(owner.user.id),
      users.regenerateApiKey(owner.user.id),
    ]);
    const usable = await Promise.all(keys.map(async (key) => Boolean(await auth.validateApiKey(key))));
    expect(usable.filter(Boolean)).toHaveLength(1);
    expect(Boolean(await auth.validateApiKey(connected.apiKey))).toBe(false);
  });

  it('rolls back every revocation if the new personal Key cannot be saved', async () => {
    const owner = await ownerFixture();
    const personal = await users.regenerateApiKey(owner.user.id);
    const connected = await owner.exchange();
    const pending = await owner.issue();
    const device = await connectDevice(owner.user.id);
    const error = new Error('Fixture rejected the new personal Key');
    const failingDb = db.$extends({
      query: { apiKeyCredential: { create: () => { throw error; } } },
    });

    await expect(new UserService(failingDb as unknown as PrismaService).regenerateApiKey(owner.user.id))
      .rejects.toThrow(error);
    expect(Boolean(await auth.validateApiKey(personal))).toBe(true);
    expect(Boolean(await auth.validateApiKey(connected.apiKey))).toBe(true);
    await expect(device.authorize(device.request)).resolves.toMatchObject({ userId: owner.user.id });
    await expect(installations.exchange(pending.code, ip())).resolves.toMatchObject({ agentId: owner.agent.id });
  });

  it('rejects stale Redis writes and renews codes only from the current rotation', async () => {
    const owner = await ownerFixture();
    await users.regenerateApiKey(owner.user.id);
    const write = redis.setOnce.bind(redis);
    let reachedCache!: () => void;
    const atCache = new Promise<void>((resolve) => { reachedCache = resolve; });
    let allowCacheWrite!: () => void;
    const cacheWriteAllowed = new Promise<void>((resolve) => { allowCacheWrite = resolve; });
    const delayed = jest.spyOn(redis, 'setOnce').mockImplementationOnce(async (...args) => {
      reachedCache();
      await cacheWriteAllowed;
      return write(...args);
    });
    const issuance = owner.issue();
    try {
      await atCache;
      await users.regenerateApiKey(owner.user.id);
    } finally {
      allowCacheWrite();
      delayed.mockRestore();
    }
    const stale = await issuance;
    await expect(installations.exchange(stale.code, ip())).rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_INVALID' });
    await expect(owner.exchange()).resolves.toMatchObject({ agentId: owner.agent.id });
  });

  it('invalidates approved and authorized device sessions and fences an already authenticated bootstrap replay', async () => {
    const owner = await ownerFixture();
    const other = await ownerFixture();
    const bootstrap = fixture.get(OnboardBootstrapService);
    await users.regenerateApiKey(owner.user.id);
    const connection = await connectDevice(owner.user.id);
    const otherConnection = await connectDevice(other.user.id);
    const waiting = await connection.devices.start({ purpose: 'agent-connect', clientType: 'codex', packageVersion: '0.9.1' }, ip());
    await connection.devices.decide({ userCode: waiting.userCode, decision: 'approve' }, owner.user.id, ip());
    const plan: ServerPlan = {
      space: { mode: 'existing', id: owner.space.id }, agentName: `${prefix}-bootstrap`,
      role: 'editor', packageVersion: '0.9.1',
    };
    const boot = (principal: OnboardingPrincipal) => bootstrap.bootstrap(principal, prefix, plan, hashServerPlan(plan));
    const original = await boot(connection.principal);
    await users.regenerateApiKey(owner.user.id);

    expect((await connection.devices.poll({ deviceCode: waiting.deviceCode }, ip())).status).toBe('expired');
    expect((await connection.devices.poll({ deviceCode: connection.started.deviceCode }, ip())).status).toBe('expired');
    await expect(connection.authorize(connection.request)).rejects.toMatchObject({ businessCode: 'AUTH_EXPIRED' });
    await expect(boot(connection.principal)).rejects.toMatchObject({ businessCode: 'AUTH_EXPIRED' });
    await expect(otherConnection.authorize(otherConnection.request)).resolves.toMatchObject({ userId: other.user.id });
    await expect(installations.exchange(original.installation.code, ip())).rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_INVALID' });

    const renewed = await connection.devices.renew({ deviceCode: connection.started.deviceCode }, ip());
    await connection.devices.decide({ userCode: renewed.userCode, decision: 'approve' }, owner.user.id, ip());
    const authorized = await connection.devices.poll({ deviceCode: connection.started.deviceCode }, ip());
    await expect(boot(connection.principal)).rejects.toMatchObject({ businessCode: 'AUTH_EXPIRED' });
    const principal = await connection.authorize({ headers: { authorization: `Bearer ${authorized.onboardingToken}` } });
    const fresh = await boot(principal);
    expect(fresh.agent.id).toBe(original.agent.id);
    expect(fresh.space.id).toBe(original.space.id);
    expect(fresh.installation.installationId).not.toBe(original.installation.installationId);
    await expect(installations.exchange(fresh.installation.code, ip())).resolves.toMatchObject({ agentId: original.agent.id });
  });

  it('caps integration access and rejects receipt replay when the owner loses the original role', async () => {
    const owner = await ownerFixture();
    const issued = await owner.issue();
    const exchanged = await installations.exchange(issued.code, ip());
    const membership = { userId_spaceId: { userId: owner.user.id, spaceId: owner.space.id } };
    const savedGrant = await db.agentGrant.findUniqueOrThrow({
      where: { agentId_spaceId: { agentId: owner.agent.id, spaceId: owner.space.id } },
    });
    await db.spaceMember.update({ where: membership, data: { role: 'viewer' } });

    const integration = await agents.integrationAccess(owner.user.id, owner.agent.id, exchanged.credentialId);
    expect(integration[0].grants).toEqual([expect.objectContaining({
      role: 'reader', folderScopes: ['folders:read'],
    })]);
    expect(integration[0].grants[0].scopes).not.toContain('pages:write');
    await expect(installations.exchange(issued.code, ip())).rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_INVALID' });

    await expect(owner.issue()).rejects.toThrow('You cannot authorize this Agent for the Space');
    const capped = await installations.create(
      owner.user.id, owner.agent.id, owner.space.id, 'reader', '0.9.1', 'https://wiki.test/api',
    );
    const reconnected = await installations.exchange(capped.code, ip());
    expect(reconnected).toMatchObject({ agentId: owner.agent.id, role: 'reader' });
    expect(reconnected.scopes).not.toContain('pages:write');
    expect(await db.agentGrant.findUnique({ where: { id: savedGrant.id } })).toEqual(savedGrant);
    await expect(installations.exchange(capped.code, ip())).resolves.toMatchObject({
      credentialId: reconnected.credentialId, role: 'reader',
    });

    await db.spaceMember.delete({ where: membership });
    await expect(installations.exchange(capped.code, ip())).rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_INVALID' });
    expect((await agents.integrationAccess(owner.user.id, owner.agent.id, exchanged.credentialId))[0].grants).toEqual([]);
    expect((await agents.integrationAccess(owner.user.id))[0].grants[0].role).toBe('editor');
  });

  it('shows reconnect only for active Agents with a revoked formerly usable credential and no valid credentials', async () => {
    const owner = await ownerFixture();
    const first = await owner.exchange();
    const second = await owner.exchange();
    await db.agentCredential.update({
      where: { id: first.credentialId }, data: { expiresAt: new Date(0), revokedAt: new Date() },
    });
    await db.agentCredential.update({
      where: { id: second.credentialId }, data: { expiresAt: new Date(0) },
    });
    expect(await agents.getOwned(owner.user.id, owner.agent.id)).toMatchObject({ reconnectRequired: false });
    const third = await owner.exchange();
    expect(await agents.getOwned(owner.user.id, owner.agent.id)).toMatchObject({ reconnectRequired: false });
    await agents.revokeCredential(owner.user.id, owner.agent.id, third.credentialId);
    expect(await agents.getOwned(owner.user.id, owner.agent.id)).toMatchObject({ reconnectRequired: true });
    await agents.update(owner.user.id, owner.agent.id, { status: 'paused' });
    expect(await agents.getOwned(owner.user.id, owner.agent.id)).toMatchObject({ reconnectRequired: false });
  });
});
