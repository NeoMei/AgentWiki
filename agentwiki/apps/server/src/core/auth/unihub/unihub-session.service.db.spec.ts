import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaService } from '../../../database/prisma.service';
import { UniHubClient } from './unihub-client';
import { UniHubSessionService } from './unihub-session.service';

function hasIsolatedTestDatabase(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url || url !== process.env.COLLABORATION_TEST_DATABASE_URL) return false;
  const { hostname, pathname, searchParams } = new URL(url);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    && /test/i.test(pathname) && /^collaboration_test_/.test(searchParams.get('schema') ?? '');
}

const describeDb = hasIsolatedTestDatabase() ? describe : describe.skip;

describeDb('UniHub human session storage', () => {
  const prisma = new PrismaService();
  const prefix = randomUUID();
  const userId = `local-${prefix}`;
  const otherUserId = `other-${prefix}`;
  const centralUserId = `central-${prefix}`;
  const sourceProof = `source-proof-${prefix}`;
  let server: Server;
  let client: UniHubClient;
  let centralStatus: number;
  let verifyRequests: number;
  let beforeResponse: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      verifyRequests++;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const expectedRequest =
        request.method === 'POST'
        && request.url === '/internal/v1/product-runtime/identity/session/verify'
        && request.headers.authorization === 'Bearer integration-runtime-token-for-wiki-test'
        && body.source_proof_token === sourceProof
        && body.central_user_id === centralUserId;
      await beforeResponse?.();
      response.writeHead(expectedRequest ? centralStatus : 400).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    client = new UniHubClient(new ConfigService({
      UNIHUB_IDENTITY_ENABLED: 'true',
      UNIHUB_IDENTITY_PILOT_USER_IDS: `${userId},${otherUserId}`,
      UNIHUB_IDENTITY_API_ORIGIN: origin,
      UNIHUB_IDENTITY_PUBLIC_ORIGIN: origin,
      UNIHUB_IDENTITY_CALLBACK_URL: origin + '/api/auth/unihub/callback',
      UNIHUB_IDENTITY_CLIENT_ID: 'wiki-test',
      UNIHUB_IDENTITY_RUNTIME_TOKEN: 'integration-runtime-token-for-wiki-test',
    }));
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({ data: { id, email: `${id}@example.test` } });
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    try {
      await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  beforeEach(() => {
    centralStatus = 204;
    verifyRequests = 0;
    beforeResponse = undefined;
  });

  function service() {
    return new UniHubSessionService(prisma, client);
  }

  async function openSession() {
    const sessions = service();
    await sessions.bind(userId, centralUserId, 7);
    const expiresAt = Math.floor(Date.now() / 1_000) + 60;
    return sessions.open(userId, centralUserId, sourceProof, expiresAt);
  }

  it('adds both durable tables to the migrated schema', async () => {
    await expect(prisma.$queryRaw`
      SELECT to_regclass('"UniHubIdentityBinding"')::text AS binding,
             to_regclass('"UniHubUserSession"')::text AS session
    `).resolves.toEqual([{ binding: '"UniHubIdentityBinding"', session: '"UniHubUserSession"' }]);
  });

  it('persists one immutable binding per user and central account, with monotonic auth version', async () => {
    const sessions = service();
    await expect(sessions.findBinding(otherUserId)).resolves.toBeNull();
    await sessions.bind(userId, centralUserId, 7);
    await Promise.all([sessions.bind(userId, centralUserId, 9), sessions.bind(userId, centralUserId, 8)]);
    await expect(sessions.bind(userId, 'different-central', 10)).rejects.toMatchObject({ status: 409 });
    await expect(sessions.bind(otherUserId, centralUserId, 10)).rejects.toMatchObject({ status: 409 });
    await expect(service().findBinding(userId)).resolves.toEqual({
      userId, centralUserId, syncedAuthVersion: 9,
    });
  });

  it('opens a durable session and verifies it from another service instance', async () => {
    const expiresAt = Math.floor(Date.now() / 1_000) + 120;
    const sessions = service();
    await sessions.bind(userId, centralUserId, 7);
    const opened = await sessions.open(userId, centralUserId, sourceProof, expiresAt);
    expect(opened).toEqual({ sid: expect.any(String), expiresAt });
    await expect(service().verify(opened.sid, userId)).resolves.toBe(true);
    expect(verifyRequests).toBe(1);
    await expect(prisma.$queryRaw`
      SELECT "lastVerifiedAt" FROM "UniHubUserSession" WHERE sid = ${opened.sid}
    `).resolves.toEqual([{ lastVerifiedAt: expect.any(Date) }]);
  });

  it('rejects a mismatched identity and an expired proof before opening a session', async () => {
    const sessions = service();
    await sessions.bind(userId, centralUserId, 7);
    const now = Math.floor(Date.now() / 1_000);
    await expect(sessions.open(userId, 'wrong-central', sourceProof, now + 60)).rejects.toMatchObject({ status: 401 });
    await expect(sessions.open(userId, centralUserId, sourceProof, now - 1)).rejects.toMatchObject({ status: 401 });
  });

  it('only accepts and revokes a session for its owning user', async () => {
    const { sid } = await openSession();
    const sessions = service();
    await expect(sessions.verify(sid, otherUserId)).resolves.toBe(false);
    await sessions.revoke(sid, otherUserId);
    await expect(sessions.verify(sid, userId)).resolves.toBe(true);
    await sessions.revoke(sid, userId);
    await expect(service().verify(sid, userId)).resolves.toBe(false);
    expect(verifyRequests).toBe(1);
  });

  it('never verifies an expired local session against UniHub', async () => {
    const { sid } = await openSession();
    await prisma.uniHubUserSession.update({ where: { sid }, data: { expiresAt: new Date(0) } });
    await expect(service().verify(sid, userId)).resolves.toBe(false);
    expect(verifyRequests).toBe(0);
  });

  it('persists a definitive denial across service instances', async () => {
    const { sid } = await openSession();
    await expect(service().verify(sid, userId)).resolves.toBe(true);
    centralStatus = 403;
    await expect(service().verify(sid, userId)).resolves.toBe(false);
    centralStatus = 204;
    await expect(service().verify(sid, userId)).resolves.toBe(false);
    expect(verifyRequests).toBe(2);
  });

  it('fails closed on 5xx without revoking a session that can be verified later', async () => {
    const { sid } = await openSession();
    await expect(service().verify(sid, userId)).resolves.toBe(true);
    centralStatus = 503;
    await expect(service().verify(sid, userId)).resolves.toBe(false);
    centralStatus = 204;
    await expect(service().verify(sid, userId)).resolves.toBe(true);
  });

  it('rejects a positive central reply if logout wins while verification is in flight', async () => {
    const { sid } = await openSession();
    beforeResponse = () => service().revoke(sid, userId);
    await expect(service().verify(sid, userId)).resolves.toBe(false);
  });
});
