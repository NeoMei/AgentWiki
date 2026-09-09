import { createHash } from 'crypto';
import { OnboardDeviceService } from './onboard-device.service';
import { ObsidianIntegrationService } from '../integrations/obsidian/obsidian-integration.service';
import { ObsidianCryptoService } from '../integrations/obsidian/obsidian-crypto.service';
import { OnboardBootstrapService } from './onboard-bootstrap.service';

const deviceCode = 'awd_' + 'a'.repeat(43);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('browser connection authorization', () => {
  let service: OnboardDeviceService;
  let installations: ObsidianIntegrationService;
  let prisma: any;
  let stored: any;
  let user: any;
  let codes: any[];
  let rate: number;
  const ip = '127.0.0.1';
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00Z'));
    stored = { id: 'session-1', purpose: 'obsidian-connect', clientType: 'obsidian', packageVersion: '0.4.0',
      deviceCodeHash: hash(deviceCode), userCodeHash: hash('ABCDEFGH'), requestedCapabilities: [],
      expiresAt: new Date(Date.now() + 600000), status: 'approved', authorizedUserId: 'user-1',
      lastPolledAt: null, pollIntervalSeconds: 5, pollCount: 0, onboardingTokenHash: null,
      tokenExpiresAt: null, tokenConsumedAt: null };
    user = { id: 'user-1', type: 'human', lockedAt: null, deletedAt: null };
    codes = []; rate = 1;
    const matches = (where: any): boolean => Object.entries(where).every(([key, value]: any) => {
      if (key === 'AND') return matches(value);
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('gt' in value) return stored[key] > value.gt;
        if ('lte' in value) return stored[key] <= value.lte;
      }
      return value instanceof Date ? stored[key]?.getTime() === value.getTime() : stored[key] === value;
    });
    prisma = {
      onboardingDeviceSession: {
        findUnique: jest.fn(async ({where}: any) => matches(where) ? {...stored} : null),
        updateMany: jest.fn(async ({where, data}: any) => {
          if (!matches(where)) return {count: 0};
          for (const [key,value] of Object.entries(data) as any) stored[key] = value?.increment ? stored[key] + value.increment : value;
          return {count: 1};
        }),
      },
      user: {findUnique: jest.fn(async () => user)},
      obsidianInstallation: {
        create: jest.fn(async ({data}: any) => { const row = {status: 'pending', ...data}; codes.push(row); return row; }),
        findUnique: jest.fn(async ({where}: any) => codes.find(x => x.codeHash === where.codeHash) ?? null),
      },
    };
    // Serialize the external DB transaction boundary; real DB concurrency is a separate gate.
    let queue = Promise.resolve();
    prisma.$transaction = (work: any) => { const result = queue.then(() => work(prisma)); queue = result.then(() => undefined, () => undefined); return result; };
    const config: any = {get: (key: string) => key === 'AGENTWIKI_SERVER_PEPPER' ? 'test-pepper' : key === 'PUBLIC_WEB_URL' ? 'https://agentwiki.example' : undefined};
    const redis: any = {incrementWithWindow: async () => rate};
    const audit: any = {record: jest.fn(async () => undefined)};
    service = new OnboardDeviceService(prisma, redis, audit, config);
    installations = new ObsidianIntegrationService(prisma, new ObsidianCryptoService(config, prisma), audit, redis);
  });
  afterEach(() => jest.useRealTimers());
  const poll = () => (service as any).pollObsidian({deviceCode}, ip, installations);

  it('replays one installation code after lost responses and concurrent polls, with no private code persisted', async () => {
    const results = await Promise.all([poll(), poll(), poll()]);
    expect(results[0]).toMatchObject({status: 'authorized', code: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresIn: 600});
    expect(results).toEqual([results[0], results[0], results[0]]);
    expect(codes).toHaveLength(1);
    expect(JSON.stringify([stored, codes])).not.toContain(results[0].code);
    expect(stored.onboardingTokenHash).toBeNull();
    expect(await service.getPublicSession('ABCD-EFGH', ip)).toEqual({clientType: 'obsidian', purpose: 'obsidian-connect', packageVersion: '0.4.0', status: 'authorized', expiresAt: stored.expiresAt});
  });
  it.each(['full-onboarding','agent-connect'])('rejects %s on Obsidian poll', async purpose => {
    stored.purpose = purpose; expect(await poll()).toEqual({status:'expired'}); expect(codes).toHaveLength(0);
  });
  it.each(['expired','denied','pending'])('does not issue credentials while %s', async status => {
    stored.status = status;
    expect(await poll()).toEqual({status: status === 'pending' ? 'authorization_pending' : status});
    expect(codes).toHaveLength(0);
  });
  it('enforces expiration even after authorized replay', async () => {
    await poll(); jest.advanceTimersByTime(600000);
    expect(await poll()).toEqual({status:'expired'}); expect(codes).toHaveLength(1);
  });
  it.each(['lockedAt', 'deletedAt'])('denies replay when human account has %s', async field => {
    await poll(); user[field] = new Date(); expect(await poll()).toEqual({status:'denied'});
  });
  it('returns slowdown for early pending polls and fails closed on rate limit', async () => {
    stored.status = 'pending'; await poll(); expect(await poll()).toEqual({status:'slow_down', interval:10});
    rate = 121; await expect(poll()).rejects.toMatchObject({businessCode:'AUTH_RATE_LIMITED'});
  });
  it('replays new Agent purpose tokens while preserving legacy single delivery', async () => {
    stored.purpose = 'agent-connect'; stored.clientType = 'codex';
    const first = await service.poll({deviceCode}, ip);
    expect(first).toMatchObject({status:'authorized', onboardingToken: expect.stringMatching(/^awo_/)});
    expect(await service.poll({deviceCode}, ip)).toEqual(first);
    user.lockedAt = new Date(); expect(await service.poll({deviceCode}, ip)).toEqual({status:'denied'});
  });
  it('renews expired Agent authorization with same owner/session and replays a lost renewal response', async () => {
    stored.purpose = 'agent-connect'; stored.clientType = 'codex'; stored.status = 'expired'; stored.expiresAt = new Date(Date.now()-1);
    const renewed = await (service as any).renew({deviceCode}, ip);
    expect(renewed).toMatchObject({deviceCode, expiresIn:600, interval:5});
    expect(await (service as any).renew({deviceCode}, ip)).toEqual(renewed);
    expect(stored).toMatchObject({id:'session-1', authorizedUserId:'user-1', status:'pending'});
    await expect(service.decide({userCode:renewed.userCode, decision:'approve'}, 'other-user', ip)).rejects.toMatchObject({businessCode:'AUTH_DENIED'});
    await service.decide({userCode:renewed.userCode, decision:'approve'}, 'user-1', ip);
    expect(await service.poll({deviceCode}, ip)).toMatchObject({status:'authorized'});
  });
  it('rotates authorization generation even when denial and renewal share the same millisecond', async () => {
    stored.purpose = 'agent-connect'; stored.clientType = 'codex';
    const first = await service.poll({deviceCode}, ip);
    const oldExpiresAt = stored.expiresAt;
    stored.status = 'denied';
    const renewed = await service.renew({deviceCode}, ip);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(oldExpiresAt.getTime());
    expect(renewed.expiresIn).toBe(600);
    expect(await service.renew({deviceCode}, ip)).toEqual(renewed);
    await expect(service.decide({userCode:'ABCD-EFGH', decision:'approve'}, 'user-1', ip)).rejects.toMatchObject({businessCode:'RESOURCE_NOT_FOUND'});
    await service.decide({userCode:renewed.userCode, decision:'approve'}, 'user-1', ip);
    const second = await service.poll({deviceCode}, ip);
    expect(second.onboardingToken).not.toBe(first.onboardingToken);
    expect(second.expiresIn).toBe(600);
  });

  it('does not allow an in-flight old browser decision to approve a renewed generation', async () => {
    stored.purpose = 'agent-connect'; stored.status = 'pending';
    const original = prisma.onboardingDeviceSession.updateMany.getMockImplementation();
    let switched = false;
    prisma.onboardingDeviceSession.updateMany.mockImplementation(async (query: any) => {
      if (!switched && query.data.status === 'approved') {
        switched = true; stored.userCodeHash = hash('JKLMNPQR'); stored.expiresAt = new Date(stored.expiresAt.getTime()+1);
      }
      return original(query);
    });
    await expect(service.decide({userCode:'ABCD-EFGH',decision:'approve'}, 'user-1', ip)).rejects.toMatchObject({businessCode:'RESOURCE_CONFLICT'});
    expect(stored.status).toBe('pending');
  });

  it('does not expire a renewed generation from an in-flight old public session read', async () => {
    stored.purpose = 'agent-connect'; stored.status = 'pending'; stored.expiresAt = new Date(Date.now()-1);
    const original = prisma.onboardingDeviceSession.updateMany.getMockImplementation();
    prisma.onboardingDeviceSession.updateMany.mockImplementation(async (query: any) => {
      if (query.data.status === 'expired') {stored.expiresAt = new Date(Date.now()+600000); stored.userCodeHash=hash('JKLMNPQR');}
      return original(query);
    });
    expect((await service.getPublicSession('ABCD-EFGH', ip)).status).toBe('expired');
    expect(stored.status).toBe('pending');
  });

  it('lists only bootstrap eligible spaces and rejects non-Agent purposes', async () => {
    prisma.space = {findMany: jest.fn(async ({where}: any) => {
      expect(where).toEqual({deletedAt:null, members:{some:{userId:'user-1',role:{in:['owner','admin']}}}});
      return [{id:'space-1', name:'Owner Space'}];
    })};
    const bootstrap = new OnboardBootstrapService(prisma, {} as any, {} as any, {} as any);
    expect(await (bootstrap as any).listSpaces({userId:'user-1', purpose:'agent-connect'})).toEqual({spaces:[{id:'space-1', name:'Owner Space'}]});
    await expect((bootstrap as any).listSpaces({userId:'user-1', purpose:'obsidian-connect'})).rejects.toMatchObject({businessCode:'AUTH_DENIED'});
  });
});
