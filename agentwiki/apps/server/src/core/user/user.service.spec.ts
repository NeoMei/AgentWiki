import { UserService } from './user.service';

describe('UserService account deletion safeguards', () => {
  const tx = {
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn(), count: jest.fn(), update: jest.fn() },
    spaceMember: { count: jest.fn() },
    apiKeyCredential: { updateMany: jest.fn() },
    agentCredential: { updateMany: jest.fn() },
    agent: { updateMany: jest.fn() },
  } as any;
  const prisma = {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const service = new UserService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    tx.user.findUnique.mockResolvedValue({ id: 'user-1', type: 'human', platformRole: 'user' });
    tx.$queryRaw.mockResolvedValue([{ id: 'locked' }]);
    tx.spaceMember.count.mockResolvedValue(0);
    tx.user.count.mockResolvedValue(1);
    tx.user.update.mockResolvedValue({ id: 'user-1', deletedAt: new Date() });
  });

  it('refuses deletion until every owned Space is transferred', async () => {
    tx.spaceMember.count.mockResolvedValue(1);
    await expect(service.remove('user-1')).rejects.toThrow('Transfer ownership');
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('refuses deletion of the final active super admin', async () => {
    tx.user.findUnique.mockResolvedValue({ id: 'user-1', type: 'human', platformRole: 'super_admin' });
    tx.user.count.mockResolvedValue(0);
    await expect(service.remove('user-1')).rejects.toThrow('last active super admin');
  });

  it('revokes credentials and Agents atomically before soft deletion', async () => {
    await service.remove('user-1');
    const lockedTables = tx.$queryRaw.mock.calls.map(([query]: any[]) => query.strings.join(' '));
    expect(lockedTables[0]).toContain('FROM "User"');
    expect(lockedTables[1]).toContain('FROM "Agent"');
    expect(tx.apiKeyCredential.updateMany).toHaveBeenCalled();
    expect(tx.agentCredential.updateMany).toHaveBeenCalled();
    expect(tx.agent.updateMany).toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authVersion: { increment: 1 } }),
    }));
  });
});
