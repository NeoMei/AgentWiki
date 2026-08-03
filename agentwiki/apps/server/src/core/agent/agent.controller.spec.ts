import { AgentController } from './agent.controller';

describe('AgentController platform authorization', () => {
  it('preserves the authenticated platform role when authorizing an Agent grant', async () => {
    const agents = {
      upsertGrantForSpace: jest.fn().mockResolvedValue({ id: 'grant-1' }),
    } as any;
    const authorization = {
      assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner', isSuperAdmin: true }),
    } as any;
    const controller = new AgentController(agents, authorization);
    const principal = { userId: 'admin-1', type: 'human', platformRole: 'super_admin' };

    await controller.upsertGrant(
      { user: principal } as any,
      'agent-1',
      'space-1',
      { role: 'editor', scopes: ['pages:read'] },
    );

    expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(
      principal,
      'space-1',
      ['owner', 'admin'],
    );
  });
});
