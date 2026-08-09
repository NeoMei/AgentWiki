import { PlatformAdminService } from './platform-admin.service';

describe('PlatformAdminService password reset security', () => {
  const tx = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    apiKeyCredential: { updateMany: jest.fn() },
    agentCredential: { updateMany: jest.fn() },
  } as any;
  const prisma = { $transaction: jest.fn() } as any;
  const config = { get: jest.fn() } as any;
  const audit = { record: jest.fn() } as any;
  const auth = { hashPassword: jest.fn() } as any;
  const service = new PlatformAdminService(prisma, config, audit, auth);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    tx.user.findUnique.mockResolvedValue({ id: 'user-1', type: 'human', deletedAt: null });
    tx.user.update.mockResolvedValue({ id: 'user-1' });
    auth.hashPassword.mockResolvedValue('hashed');
    audit.record.mockResolvedValue(undefined);
  });

  it('issues a different cryptographically-random temporary password on every reset', async () => {
    const first = await service.resetPassword('admin-1', 'user-1');
    const second = await service.resetPassword('admin-1', 'user-1');

    expect(first).not.toBe(second);
    expect(first).not.toBe('12345678');
    expect(first.length).toBeGreaterThanOrEqual(24);
    expect(auth.hashPassword).toHaveBeenNthCalledWith(1, first);
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mustChangePassword: true, authVersion: { increment: 1 } }),
    }));
  });
});
