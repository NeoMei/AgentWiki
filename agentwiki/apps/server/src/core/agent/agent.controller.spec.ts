import { AgentController } from './agent.controller';

describe('AgentController platform authorization', () => {
  it('preserves the authenticated platform role when authorizing an Agent grant', async () => {
    const agents = {
      upsertGrantForSpace: jest.fn().mockResolvedValue({ id: 'grant-1' }),
    } as any;
    const authorization = {
      assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner', isSuperAdmin: true }),
    } as any;
    const controller = new AgentController(agents, authorization, {} as any);
    const principal = { userId: 'admin-1', type: 'human', platformRole: 'super_admin' };

    await controller.upsertGrant(
      { user: principal } as any,
      'agent-1',
      'space-1',
      { role: 'editor' },
    );

    expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(
      principal,
      'space-1',
      ['owner', 'admin'],
    );
    expect(agents.upsertGrantForSpace).toHaveBeenCalledWith(
      'admin-1', 'agent-1', 'space-1', 'editor',
    );
  });

  it('revokes credentials through the local-sync lifecycle cleanup wrapper', async () => {
    const installations = {
      revokeCredentialAndReceipts: jest.fn().mockResolvedValue({ success: true }),
    } as any;
    const controller = new AgentController({} as any, {} as any, installations);

    await expect(controller.revokeCredential(
      { user: { userId: 'owner-1' } } as any,
      'agent-1',
      'credential-1',
    )).resolves.toEqual({ success: true });
    expect(installations.revokeCredentialAndReceipts).toHaveBeenCalledWith(
      'owner-1', 'agent-1', 'credential-1',
    );
  });

  it('requires both Space administration and Agent ownership when removing a grant', async () => {
    const agents = { removeGrant: jest.fn().mockResolvedValue({ success: true }) } as any;
    const authorization = { assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'admin' }) } as any;
    const controller = new AgentController(agents, authorization, {} as any);
    const principal = { userId: 'owner-1', type: 'human' };

    await controller.removeGrant({ user: principal } as any, 'agent-1', 'space-1');

    expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(principal, 'space-1', ['owner', 'admin']);
    expect(agents.removeGrant).toHaveBeenCalledWith('owner-1', 'agent-1', 'space-1');
  });
});
