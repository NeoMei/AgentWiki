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
