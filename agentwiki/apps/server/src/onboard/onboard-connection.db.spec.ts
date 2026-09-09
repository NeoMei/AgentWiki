import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { OnboardModule } from './onboard.module';
import { OnboardDeviceService } from './onboard-device.service';
import { OnboardBootstrapService } from './onboard-bootstrap.service';
import { OnboardingTokenGuard } from './onboarding-token.guard';
import { ObsidianIntegrationService } from '../integrations/obsidian/obsidian-integration.service';
import { ObsidianCryptoService } from '../integrations/obsidian/obsidian-crypto.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';
import { ObsidianDeviceController } from '../integrations/obsidian/obsidian-device.controller';
import { hashServerPlan, type ServerPlan } from './onboard.types';

const run = process.env.CONNECTION_UX_DB_TEST === '1' ? describe : describe.skip;
run('connection authorization dedicated PostgreSQL/Redis gate', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;
  let devices: OnboardDeviceService;
  let installations: ObsidianIntegrationService;
  let userId: string;
  let otherId: string;
  const prefix = `connection-test-${randomUUID()}`;
  const sessionIds: string[] = [];
  const spaces: string[] = [];
  const agents: string[] = [];
  let seq = 0;
  const ip = () => `${prefix}-${seq++}`;
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.startsWith('/connection_ux_server_test_')) throw new Error('Dedicated connection test DB required');
    const redisUrl = new URL(process.env.REDIS_URL!); redisUrl.pathname = '/1'; process.env.REDIS_URL = redisUrl.toString();
    module = await Test.createTestingModule({imports:[ConfigModule.forRoot({isGlobal:true, ignoreEnvFile:true}), OnboardModule]}).compile();
    prisma = module.get(PrismaService); redis = module.get(RedisService);
    await prisma.$connect(); await redis.onModuleInit();
    devices = module.get(OnboardDeviceService); installations = module.get(ObsidianIntegrationService);
    await module.get(ObsidianCryptoService).onModuleInit();
    userId = (await prisma.user.create({data:{email:`${prefix}@example.invalid`,name:'Connection fixture'}})).id;
    otherId = (await prisma.user.create({data:{email:`${prefix}-other@example.invalid`,name:'Other fixture'}})).id;
  }, 30000);
  afterAll(async () => {
    if (prisma) {
      await prisma.onboardingDeviceSession.deleteMany({where:{id:{in:sessionIds}}});
      await prisma.agent.deleteMany({where:{id:{in:agents}}});
      await prisma.space.deleteMany({where:{id:{in:spaces}}});
      await prisma.securityAuditEvent.deleteMany({where:{OR:[{actorUserId:{in:[userId,otherId].filter(Boolean)}},{ipAddress:{startsWith:prefix}}]}});
      await prisma.user.deleteMany({where:{id:{in:[userId,otherId].filter(Boolean)}}});
    }
    await module?.close();
  });
  async function start(purpose: 'obsidian-connect'|'agent-connect' = 'obsidian-connect') {
    const result = await devices.start(purpose === 'obsidian-connect'
      ? {packageVersion:'0.4.0',clientType:'obsidian',purpose}
      : {packageVersion:'0.9.1',clientType:'codex',purpose}, ip());
    const row = await prisma.onboardingDeviceSession.findFirstOrThrow({where:{userCodeHash:require('crypto').createHash('sha256').update(result.userCode.replace('-','')).digest('hex')}});
    sessionIds.push(row.id); return {...result, id:row.id};
  }
  it('compiles the real module graph and delivers exactly one installation across real concurrent polls then exchanges and activates it', async () => {
    expect(module.get(ObsidianDeviceController)).toBeDefined();
    const started = await start();
    expect(await devices.pollObsidian({deviceCode:started.deviceCode}, ip(), installations)).toEqual({status:'authorization_pending'});
    await Promise.all([devices.decide({userCode:started.userCode,decision:'approve'},userId,ip()),devices.decide({userCode:started.userCode,decision:'approve'},userId,ip())]);
    const before = await prisma.obsidianInstallation.count({where:{userId}});
    const polls = await Promise.all(Array.from({length:8},()=>devices.pollObsidian({deviceCode:started.deviceCode},ip(),installations)));
    const codes = new Set(polls.map(x=>x.code)); expect(codes.size).toBe(1);
    expect(polls.every(x=>x.status==='authorized')).toBe(true);
    expect(await prisma.obsidianInstallation.count({where:{userId}})).toBe(before+1);
    const request = {code:polls[0].code as string, exchangeId:randomUUID(),deviceId:randomUUID(),vaultId:randomUUID(),deviceName:'isolated fixture',credential: 'awhd_' + 'a'.repeat(43),supportedProtocolVersions:['1']};
    const exchanged = await installations.exchange(request as any,ip());
    expect(await installations.exchange(request as any,ip())).toEqual(exchanged);
    const credential = await prisma.humanDeviceCredential.findUniqueOrThrow({where:{id:exchanged.credentialId}});
    const active = await installations.activate({userId,credentialId:credential.id,credentialFamilyId:credential.credentialFamilyId},credential.id);
    expect(active.credentialStatus).toBe('active');
    await prisma.user.update({where:{id:userId},data:{lockedAt:new Date()}});
    expect(await devices.pollObsidian({deviceCode:started.deviceCode},ip(),installations)).toEqual({status:'denied'});
    await prisma.user.update({where:{id:userId},data:{lockedAt:null}});
    await prisma.onboardingDeviceSession.update({where:{id:started.id},data:{expiresAt:new Date(Date.now()-1)}});
    expect(await devices.pollObsidian({deviceCode:started.deviceCode},ip(),installations)).toEqual({status:'expired'});
  });
  it('enforces real concurrent approve/deny CAS and purpose isolation', async () => {
    const started = await start();
    const results = await Promise.allSettled([devices.decide({userCode:started.userCode,decision:'approve'},userId,ip()),devices.decide({userCode:started.userCode,decision:'deny'},userId,ip())]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(await devices.poll({deviceCode:started.deviceCode},ip())).toEqual({status:'expired'});
    const agent = await start('agent-connect');
    expect(await devices.pollObsidian({deviceCode:agent.deviceCode},ip(),installations)).toEqual({status:'expired'});
  });
  it('renews same Agent session owner, lists bootstrap spaces, and recovers expired completed receipts without duplicated resources', async () => {
    const started = await start('agent-connect');
    await devices.decide({userCode:started.userCode,decision:'approve'},userId,ip());
    const authorized = await devices.poll({deviceCode:started.deviceCode},ip());
    expect((await devices.poll({deviceCode:started.deviceCode},ip())).onboardingToken).toBe(authorized.onboardingToken);
    const principal = {sessionId:started.id,userId,packageVersion:'0.9.1',purpose:'agent-connect',requestedCapabilities:['bootstrap:space','bootstrap:agent','bootstrap:installation']};
    const plan: ServerPlan = {space:{mode:'create',name:prefix},agentName:prefix,role:'reader',packageVersion:'0.9.1'};
    const bootstrap = module.get(OnboardBootstrapService);
    const result = await bootstrap.bootstrap(principal,prefix,plan,hashServerPlan(plan));
    spaces.push(result.space.id); agents.push(result.agent.id);
    for (const role of ['admin', 'editor', 'viewer', 'owner']) {
      const extra = await prisma.space.create({data:{name:`${prefix}-${role}`,slug:`${prefix}-${role}`,deletedAt:role==='owner'?new Date():null,members:{create:{userId,role}}}});
      spaces.push(extra.id);
    }
    const eligible = await bootstrap.listSpaces(principal);
    expect(eligible.spaces.map(x=>x.name).sort()).toEqual([prefix,`${prefix}-admin`].sort());
    const record = await prisma.onboardingBootstrap.findUniqueOrThrow({where:{deviceSessionId:started.id}});
    // Delete only this exact receipt; simulates TTL expiry without touching other tests' Redis keys.
    await redis.deleteStrict(`onboarding:bootstrap-result:${record.id}:${record.generation}:${record.executionId}`);
    await prisma.onboardingDeviceSession.update({where:{id:started.id},data:{expiresAt:new Date(Date.now()-1),tokenExpiresAt:new Date(Date.now()-1)}});
    const renewals = await Promise.all(Array.from({length:4},()=>devices.renew({deviceCode:started.deviceCode},ip())));
    expect(new Set(renewals.map(x=>x.userCode)).size).toBe(1);
    const renewed = renewals[0];
    await expect(devices.decide({userCode:renewed.userCode,decision:'approve'},otherId,ip())).rejects.toMatchObject({businessCode:'AUTH_DENIED'});
    await devices.decide({userCode:renewed.userCode,decision:'approve'},userId,ip());
    const token = await devices.poll({deviceCode:started.deviceCode},ip());
    expect(token.onboardingToken).not.toBe(authorized.onboardingToken);
    const request:any = {headers:{authorization:`Bearer ${token.onboardingToken}`}};
    expect(await module.get(OnboardingTokenGuard).canActivate({switchToHttp:()=>({getRequest:()=>request})} as any)).toBe(true);
    const replay = await bootstrap.bootstrap(request.onboarding,prefix,plan,hashServerPlan(plan));
    expect(replay.space.id).toBe(result.space.id); expect(replay.agent.id).toBe(result.agent.id);
    expect(replay.installation.code).not.toBe(result.installation.code);
    expect((await prisma.onboardingBootstrap.findUniqueOrThrow({where:{deviceSessionId:started.id}})).generation).toBe(2);
    expect(await prisma.space.count({where:{name:prefix}})).toBe(1);
    expect(await prisma.agent.count({where:{name:prefix}})).toBe(1);
  },30000);
});
