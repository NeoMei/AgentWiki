import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { UniHubController } from './unihub.controller';

describe('UniHub callback flow ownership', () => {
  const cookie = 'a'.repeat(43);
  const confirmationId = createHash('sha256').update(cookie).digest('hex');

  function fixture() {
    const currentFlow = { mode: 'sso', code: 'fixture-code', nonce: 'nonce', state: 'state', verifier: 'verifier' };
    const redis = {
      getStrict: jest.fn().mockResolvedValue(JSON.stringify(currentFlow)),
      deleteIfValueMatches: jest.fn().mockResolvedValue(true),
    };
    const client = {
      enabled: true, hasPilotUsers: true, callbackURL: 'https://wiki.test/api/auth/unihub/callback',
      request: jest.fn().mockRejectedValue(new Error('unexpected exchange')),
    };
    const controller = new UniHubController(client as never, redis as never, {} as never, {} as never, {} as never, {} as never);
    const req = { headers: { cookie: 'agentwiki_unihub_flow=' + cookie }, query: {} } as Request;
    const res = { set: jest.fn(), clearCookie: jest.fn() } as unknown as Response;
    return { controller, redis, client, req, res };
  }

  it('rejects an old tab without consuming its replacement flow', async () => {
    const { controller, redis, client, req, res } = fixture();
    const input = { mode: 'link' as const, confirmationId: 'b'.repeat(64), centralUserId: 'selected-old-account' };
    await expect(controller.finish(input, req, res)).rejects.toThrow('UniHub browser flow changed');
    expect(redis.deleteIfValueMatches).not.toHaveBeenCalled();
    expect(client.request).not.toHaveBeenCalled();
  });

  it('rejects a link confirmation for an SSO flow with the current ID', async () => {
    const { controller, redis, req, res } = fixture();
    const input = { mode: 'link' as const, confirmationId, centralUserId: 'selected-old-account' };
    await expect(controller.finish(input, req, res)).rejects.toThrow('UniHub browser flow changed');
    expect(redis.deleteIfValueMatches).not.toHaveBeenCalled();
  });

  it('checks the callback tab ID before returning the pending SSO flow', async () => {
    const { controller, req } = fixture();
    req.query = { flow: 'b'.repeat(64) };
    await expect(controller.pending(req)).rejects.toThrow('UniHub browser flow changed');
    req.query = { flow: confirmationId };
    await expect(controller.pending(req)).resolves.toEqual({ mode: 'sso', confirmationId });
  });
});

describe('seamless AgentWiki entry into UniHub', () => {
  const user = { id: 'original-wiki-user', authVersion: 4, email: 'original@example.test', name: 'Original', type: 'human', password: 'stored-hash' };

  function fixture(options: { authVersion?: number; bound?: boolean } = {}) {
    const sessions = {
      findBinding: jest.fn().mockResolvedValue(options.bound ? { userId: user.id } : null),
      bind: jest.fn().mockResolvedValue(undefined),
    };
    const client = {
      enabled: true, hasPilotUsers: true, clientId: 'wiki', callbackURL: 'https://wiki.test/api/auth/unihub/callback',
      allowsLocalUser: jest.fn().mockReturnValue(true),
      request: jest.fn().mockImplementation(async () => {
        sessions.findBinding.mockResolvedValue({ userId: user.id });
        return { binding: { local_user_id: user.id, user_id: 'central-id' }, auth_version: 5, access: { active: true, permissions: ['product:use'] } };
      }),
      browserURL: jest.fn().mockReturnValue('https://hub.test/handoff'),
    };
    const jwt = { verify: () => ({ sub: user.id, authVersion: options.authVersion, iat: 100 }) };
    const redis = { setStrict: jest.fn().mockResolvedValue(undefined) };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
    const controller = new UniHubController(client as never, redis as never, sessions as never, prisma as never, {} as never, jwt as never);
    const req = { headers: { authorization: 'Bearer original-native-token' } } as Request;
    const res = { set: jest.fn(), cookie: jest.fn() } as unknown as Response;
    const enter = () => controller.native({ mode: 'auto' }, req, res);
    return { enter, client, sessions };
  }

  it('opens an existing mapping using the original session', async () => {
    const { enter, client } = fixture({ authVersion: 4, bound: true });
    await expect(enter()).resolves.toEqual({ redirectUrl: 'https://hub.test/handoff' });
    expect(client.request).not.toHaveBeenCalled();
  });

  it('provisions once with a valid versioned original session and stores the original user mapping', async () => {
    const { enter, client, sessions } = fixture({ authVersion: 4 });
    await expect(enter()).resolves.toEqual({ redirectUrl: 'https://hub.test/handoff' });
    expect(client.request).toHaveBeenCalledWith('/enroll', expect.objectContaining({
      automatic: true, authentication: expect.objectContaining({
        local_user_id: user.id, auth_version: 5, method: 'session',
      }),
    }), undefined);
    expect(sessions.bind).toHaveBeenCalledWith(user.id, 'central-id', 5);
  });

  it.each([undefined, 3])('refuses new automatic provisioning for a missing or stale version (%s)', async (authVersion) => {
    const { enter, client } = fixture({ authVersion });
    await expect(enter()).rejects.toMatchObject({ status: 401 });
    expect(client.request).not.toHaveBeenCalled();
  });
});

describe('UniHub return to an active AgentWiki session', () => {
  const cookie = 'c'.repeat(43);
  const confirmationId = createHash('sha256').update(cookie).digest('hex');

  function fixture(incomingId: string) {
    const flow = { mode: 'sso', code: 'fixture-code', nonce: 'nonce', state: 'state', verifier: 'verifier', returnTo: '/dashboard' };
    const redis = { getStrict: jest.fn().mockResolvedValue(JSON.stringify(flow)), deleteIfValueMatches: jest.fn().mockResolvedValue(true) };
    const client = {
      enabled: true, hasPilotUsers: true, allowsLocalUser: () => true,
      callbackURL: 'https://wiki.test/api/auth/unihub/callback',
      request: jest.fn().mockResolvedValue({
        identity: { binding: { local_user_id: incomingId, user_id: 'center-id' }, auth_version: 5, access: { active: true, permissions: ['product:use'] } },
      }),
    };
    const auth = { validateJwtUser: jest.fn().mockResolvedValue({ userId: 'active-user', authVersion: 4 }) };
    const sessions = { bind: jest.fn(), open: jest.fn() };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: incomingId, type: 'human', authVersion: 4 }) } };
    const jwt = { verify: () => ({ sub: 'active-user', authVersion: 4 }) };
    const controller = new UniHubController(client as never, redis as never, sessions as never, prisma as never, auth as never, jwt as never);
    const request = { headers: { cookie: 'agentwiki_unihub_flow=' + cookie, authorization: 'Bearer original' }, query: {} } as Request;
    const response = { set: jest.fn(), clearCookie: jest.fn() } as unknown as Response;
    return { finish: () => controller.finish({ mode: 'sso', confirmationId, requireSameUser: true }, request, response), sessions };
  }

  it('retains the native JWT when the exchanged code matches the active account', async () => {
    const { finish, sessions } = fixture('active-user');
    await expect(finish()).resolves.toEqual({ returnTo: '/dashboard' });
    expect(sessions.bind).toHaveBeenCalledWith('active-user', 'center-id', 5);
    expect(sessions.open).not.toHaveBeenCalled();
  });

  it('rejects automatic switching to any other AgentWiki account', async () => {
    const { finish, sessions } = fixture('another-user');
    await expect(finish()).rejects.toMatchObject({ status: 409 });
    expect(sessions.bind).not.toHaveBeenCalled();
    expect(sessions.open).not.toHaveBeenCalled();
  });
});
