import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaService } from '../../../database/prisma.service';
import { PlatformAdminService } from '../../../platform-admin/platform-admin.service';
import { AuthService } from '../auth.service';
import type { AuditService } from '../../security/audit.service';
import { UserService } from '../../user/user.service';
import { UniHubClient } from './unihub-client';
import { recordUniHubSourceLifecycle, UniHubLifecycleService } from './unihub-lifecycle.service';

function isolatedDatabase(): boolean {
  const url = process.env.UNIHUB_LIFECYCLE_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL) return false;
  const { hostname, pathname, searchParams } = new URL(url);
  return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname) && /test|integration/.test(pathname)
    && /^unihub_lifecycle_test_\w+$/.test(searchParams.get('schema') ?? '');
}

const describeDb = isolatedDatabase() ? describe : describe.skip;

const lifecyclePath = '/internal/v1/product-runtime/identity/source-lifecycle';
type RequestBody = Record<string, unknown>;
type GatewayRequest = { path: string; body: RequestBody };
type GatewayReply = [status: number, body?: object];

describeDb('UniHub lifecycle outbox with PostgreSQL', () => {
  const prisma = new PrismaService();
  const userId = 'outbox-local-user';
  const otherUserId = 'outbox-other-user';
  const savedEnvironment = new Map([
    ['UNIHUB_IDENTITY_ENABLED', process.env.UNIHUB_IDENTITY_ENABLED],
    ['UNIHUB_IDENTITY_API_ORIGIN', process.env.UNIHUB_IDENTITY_API_ORIGIN],
    ['UNIHUB_IDENTITY_RUNTIME_TOKEN', process.env.UNIHUB_IDENTITY_RUNTIME_TOKEN],
  ]);
  const requests: GatewayRequest[] = [];
  let server: Server;
  let client: UniHubClient;
  let reply: (request: GatewayRequest) => GatewayReply | Promise<GatewayReply>;

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      if (request.method !== 'POST' || request.headers.authorization !== 'Bearer integration-runtime-token-for-wiki-test') {
        response.writeHead(401).end();
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const received = { path: request.url!, body: JSON.parse(Buffer.concat(chunks).toString()) };
      requests.push(received);
      const [status, body] = await reply(received);
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    client = new UniHubClient(new ConfigService({
      UNIHUB_IDENTITY_ENABLED: 'true',
      UNIHUB_IDENTITY_API_ORIGIN: origin,
      UNIHUB_IDENTITY_PUBLIC_ORIGIN: origin,
      UNIHUB_IDENTITY_CALLBACK_URL: origin + '/api/auth/unihub/callback',
      UNIHUB_IDENTITY_CLIENT_ID: 'wiki-test',
      UNIHUB_IDENTITY_RUNTIME_TOKEN: 'integration-runtime-token-for-wiki-test',
    }));
  });

  beforeEach(async () => {
    process.env.UNIHUB_IDENTITY_ENABLED = 'true';
    delete process.env.UNIHUB_IDENTITY_API_ORIGIN;
    delete process.env.UNIHUB_IDENTITY_RUNTIME_TOKEN;
    requests.length = 0;
    reply = ({ path, body }) => path === lifecyclePath
      ? [200, { auth_version: body.next_auth_version }]
      : [404];
    await cleanFixtures();
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({ data: { id, email: `${id}@example.test` } });
    }
  });

  afterAll(async () => {
    for (const [name, value] of savedEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    try {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await cleanFixtures();
    } finally {
      await prisma.$disconnect();
    }
  });

  async function cleanFixtures() {
    if (await outboxExists()) await prisma.$executeRaw`DELETE FROM "UniHubLifecycleOutbox"`;
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  }

  async function outboxExists() {
    const [row] = await prisma.$queryRaw<Array<{ present: boolean }>>`
      SELECT to_regclass('"UniHubLifecycleOutbox"') IS NOT NULL AS present
    `;
    return row.present;
  }

  async function rows() {
    return prisma.$queryRaw<Array<{
      id: string;
      userId: string;
      previousLocalVersion: number;
      state: string | null;
      attempts: number;
    }>>`
      SELECT "id", "userId", "previousLocalVersion", "state", "attempts"
      FROM "UniHubLifecycleOutbox" ORDER BY "userId", "previousLocalVersion"
    `;
  }

  async function makeRetriesDue() {
    await prisma.$executeRaw`UPDATE "UniHubLifecycleOutbox" SET "availableAt" = NOW()`;
  }

  function worker(runtime = client) {
    return new UniHubLifecycleService(prisma, runtime);
  }

  async function record(id: string, version: number, state?: 'locked' | 'active' | 'deleted') {
    await prisma.$transaction((tx) => recordUniHubSourceLifecycle(tx, id, version, state));
  }

  it('installs the durable outbox in the database', async () => {
    await expect(outboxExists()).resolves.toBe(true);
  });

  it('records and sends a source transition before any local binding exists', async () => {
    await record(userId, 0, 'locked');
    const [event] = await rows();
    await worker().pollOnce();
    expect(requests).toEqual([{
      path: lifecyclePath,
      body: {
        operation_id: event.id, local_user_id: userId,
        previous_auth_version: 1, next_auth_version: 2, state: 'locked',
      },
    }]);
    await expect(rows()).resolves.toEqual([]);
  });

  it('rolls back a lifecycle event with its user mutation', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { authVersion: { increment: 1 } } });
      await recordUniHubSourceLifecycle(tx, userId, 0);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    await expect(rows()).resolves.toEqual([]);
    await expect(prisma.user.findUnique({ where: { id: userId } })).resolves.toMatchObject({ authVersion: 0 });
  });

  it('skips recording and polling when the integration is disabled', async () => {
    await record(userId, 0);
    process.env.UNIHUB_IDENTITY_ENABLED = 'false';
    const disabled = worker(new UniHubClient(new ConfigService()));
    await record(userId, 1);
    disabled.onModuleInit();
    await disabled.pollOnce();
    await disabled.onModuleDestroy();
    expect(requests).toEqual([]);
    await expect(rows()).resolves.toMatchObject([{ previousLocalVersion: 0, attempts: 0 }]);
  });

  it('keeps syncing native changes when the SSO rollback retains the runtime connection', async () => {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.UNIHUB_IDENTITY_ENABLED = 'false';
    process.env.UNIHUB_IDENTITY_API_ORIGIN = origin;
    process.env.UNIHUB_IDENTITY_RUNTIME_TOKEN = 'integration-runtime-token-for-wiki-test';
    try {
      const runtime = new UniHubClient(new ConfigService());
      expect(runtime.allowsLocalUser(userId)).toBe(false);
      await expect(runtime.request('/browser/exchange', {})).rejects.toMatchObject({ status: 404 });
      await record(userId, 0, 'locked');
      await worker(runtime).pollOnce();
      expect(requests).toMatchObject([{
        path: lifecyclePath,
        body: { local_user_id: userId, previous_auth_version: 1, next_auth_version: 2, state: 'locked' },
      }]);
      await expect(rows()).resolves.toEqual([]);
    } finally {
      delete process.env.UNIHUB_IDENTITY_API_ORIGIN;
      delete process.env.UNIHUB_IDENTITY_RUNTIME_TOKEN;
    }
  });

  it('defers a missing subject and retries the same operation after enrollment', async () => {
    await record(userId, 0);
    await record(userId, 1, 'locked');
    await record(otherUserId, 0);
    reply = ({ body }) => body.local_user_id === userId ? [404] : [200, { auth_version: 2 }];
    await worker().pollOnce();
    const original = requests.find(({ body }) => body.local_user_id === userId);
    expect(original?.body).not.toHaveProperty('state');
    expect(requests.map(({ body }) => body.local_user_id).sort()).toEqual([userId, otherUserId].sort());
    await expect(rows()).resolves.toMatchObject([
      { previousLocalVersion: 0, attempts: 1 }, { previousLocalVersion: 1, attempts: 0 },
    ]);
    await worker().pollOnce();
    expect(requests).toHaveLength(2);
    await makeRetriesDue();
    reply = ({ body }) => [200, { auth_version: body.next_auth_version }];
    await worker().pollOnce();
    expect(requests[2]).toEqual(original);
    expect(requests[3].body).toMatchObject({ previous_auth_version: 2, next_auth_version: 3, state: 'locked' });
    await expect(rows()).resolves.toEqual([]);
  });

  it('unblocks a newer event after exact Gateway status confirms the prior version', async () => {
    await record(userId, 0, 'locked');
    await record(userId, 1, 'active');
    await record(userId, 2, 'deleted');
    reply = ({ path, body }) => path === lifecyclePath + '/status'
      ? [200, { local_user_id: userId, auth_version: 3, state: 'active' }]
      : body.next_auth_version === 4 ? [200, { auth_version: 4 }] : [409];
    await worker().pollOnce();
    expect(requests.map(({ path, body }) => [path, body.next_auth_version ?? body.local_user_id])).toEqual([
      [lifecyclePath, 2], [lifecyclePath + '/status', userId],
      [lifecyclePath, 3], [lifecyclePath + '/status', userId],
      [lifecyclePath, 4],
    ]);
    await expect(rows()).resolves.toEqual([]);
  });

  it.each([
    ['unavailable Gateway', [503] as GatewayReply, [200, { local_user_id: userId, auth_version: 9, state: 'locked' }] as GatewayReply],
    ['invalid receipt', [200, { auth_version: 999 }] as GatewayReply, [404] as GatewayReply],
    ['wrong subject', [409] as GatewayReply, [200, { local_user_id: otherUserId, auth_version: 9, state: 'locked' }] as GatewayReply],
    ['Gateway behind', [409] as GatewayReply, [200, { local_user_id: userId, auth_version: 1, state: 'active' }] as GatewayReply],
    ['same version with different state', [409] as GatewayReply, [200, { local_user_id: userId, auth_version: 2, state: 'active' }] as GatewayReply],
  ])('keeps later events pending after %s', async (_label, transition, status) => {
    await record(userId, 0, 'locked');
    await record(userId, 1, 'active');
    reply = ({ path }) => path === lifecyclePath ? transition : status;
    await worker().pollOnce();
    expect(requests.filter(({ path }) => path === lifecyclePath)).toHaveLength(1);
    await expect(rows()).resolves.toMatchObject([
      { previousLocalVersion: 0, attempts: 1 }, { previousLocalVersion: 1, attempts: 0 },
    ]);
  });

  it('keeps one user in order while another worker claims a different user', async () => {
    await record(userId, 0, 'locked');
    await record(userId, 1, 'active');
    let notifyArrival!: () => void;
    let releaseFirst!: () => void;
    const arrived = new Promise<void>((resolve) => { notifyArrival = resolve; });
    const inFlight = new Promise<void>((resolve) => { releaseFirst = resolve; });
    reply = async ({ body }) => {
      if (body.local_user_id === userId && body.next_auth_version === 2) {
        notifyArrival();
        await inFlight;
      }
      return [200, { auth_version: body.next_auth_version }];
    };
    const first = worker().pollOnce();
    try {
      await Promise.race([arrived, first.then(() => { throw new Error('missing first request'); })]);
      await record(otherUserId, 0, 'deleted');
      await worker().pollOnce();
      expect(requests.map(({ body }) => body.local_user_id)).toEqual([userId, otherUserId]);
    } finally {
      releaseFirst();
      await first;
    }
    expect(requests[2].body).toMatchObject({ local_user_id: userId, next_auth_version: 3 });
    await expect(rows()).resolves.toEqual([]);
  });

  it('records Admin reset, lock, unlock and deletion alongside their auth version changes', async () => {
    const admin = new PlatformAdminService(
      prisma, new ConfigService(), { record: async () => undefined } as unknown as AuditService,
      new AuthService(new JwtService(), prisma),
    );
    await admin.resetPassword(otherUserId, userId);
    const locks = await Promise.all([admin.lockUser(otherUserId, userId), admin.lockUser(otherUserId, userId)]);
    expect(locks).toEqual(expect.arrayContaining([{ locked: true }, { locked: true, alreadyLocked: true }]));
    await admin.unlockUser(otherUserId, userId);
    await admin.deleteUser(otherUserId, userId);
    await expect(rows()).resolves.toMatchObject([
      { previousLocalVersion: 0, state: null }, { previousLocalVersion: 1, state: 'locked' },
      { previousLocalVersion: 2, state: 'active' }, { previousLocalVersion: 3, state: 'deleted' },
    ]);
    await expect(prisma.user.findUnique({ where: { id: userId } })).resolves.toMatchObject({
      authVersion: 4, deletedAt: expect.any(Date),
    });
  });

  it('records self-deletion as the terminal native state', async () => {
    await new UserService(prisma).remove(userId);
    await expect(rows()).resolves.toMatchObject([{ userId, previousLocalVersion: 0, state: 'deleted' }]);
  });
});
