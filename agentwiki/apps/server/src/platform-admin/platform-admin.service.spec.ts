import { PlatformAdminService } from './platform-admin.service';
import { AuthService } from '../core/auth/auth.service';

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
    expect(first).toMatch(/[A-Z]/);
    expect(first).toMatch(/[a-z]/);
    expect(first).toMatch(/\d/);
    expect(first).toContain('!');
    expect(auth.hashPassword).toHaveBeenNthCalledWith(1, first);
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mustChangePassword: true, authVersion: { increment: 1 } }),
    }));
  });

  it('completes a real bcrypt reset, forced change, and login credential lifecycle', async () => {
    const persistedUser: any = {
      id: 'user-real',
      email: 'reset-user@example.test',
      name: 'Reset User',
      type: 'human',
      platformRole: 'user',
      password: '',
      lockedAt: null,
      deletedAt: null,
      authVersion: 4,
      mustChangePassword: false,
    };
    const userStore = {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id && where.id !== persistedUser.id) return null;
        if (where.email && where.email !== persistedUser.email) return null;
        return { ...persistedUser };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        if (where.id !== persistedUser.id) throw new Error('test user not found');
        if (typeof data.password === 'string') persistedUser.password = data.password;
        if (typeof data.mustChangePassword === 'boolean') persistedUser.mustChangePassword = data.mustChangePassword;
        if (data.authVersion?.increment) persistedUser.authVersion += data.authVersion.increment;
        return { ...persistedUser };
      }),
    };
    const jwt = { sign: jest.fn(({ authVersion, passwordChangeRequired }) => `jwt-${authVersion}-${passwordChangeRequired}`) } as any;
    const realAuth = new AuthService(jwt, { user: userStore } as any);
    persistedUser.password = await realAuth.hashPassword('Original_Password_2026!');

    const resetTx = {
      user: userStore,
      apiKeyCredential: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      agentCredential: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    } as any;
    const resetPrisma = { $transaction: jest.fn(async (callback: any) => callback(resetTx)) } as any;
    const resetService = new PlatformAdminService(
      resetPrisma,
      config,
      { record: jest.fn().mockResolvedValue(undefined) } as any,
      realAuth,
    );

    const temporaryPassword = await resetService.resetPassword('admin-1', persistedUser.id);

    expect(persistedUser.password).not.toBe(temporaryPassword);
    await expect(realAuth.validatePassword(temporaryPassword, persistedUser.password)).resolves.toBe(true);
    const temporaryLogin = await realAuth.login(persistedUser.email, temporaryPassword);
    expect(temporaryLogin.user.mustChangePassword).toBe(true);
    expect(jwt.sign).toHaveBeenLastCalledWith(expect.objectContaining({ passwordChangeRequired: true }));

    await expect(realAuth.changeRequiredPassword(persistedUser.id, temporaryPassword)).rejects.toMatchObject({
      businessCode: 'AUTH_PASSWORD_POLICY',
    });
    expect(persistedUser.mustChangePassword).toBe(true);

    const replacementPassword = 'Replacement_Password_2026!';
    const changed = await realAuth.changeRequiredPassword(persistedUser.id, replacementPassword);
    expect(changed.user.mustChangePassword).toBe(false);
    await expect(realAuth.validatePassword(replacementPassword, persistedUser.password)).resolves.toBe(true);
    await expect(realAuth.login(persistedUser.email, replacementPassword)).resolves.toMatchObject({
      user: { id: persistedUser.id, mustChangePassword: false },
    });
    await expect(realAuth.login(persistedUser.email, temporaryPassword)).rejects.toMatchObject({
      businessCode: 'AUTH_INVALID_CREDENTIALS',
    });
  });
});
