import { CombinedAuthGuard } from './combined-auth.guard';

describe('CombinedAuthGuard forced-password-change boundary', () => {
  const jwt = { verify: jest.fn() } as any;
  const auth = { validateJwtUser: jest.fn(), validateApiKey: jest.fn() } as any;
  const audit = { record: jest.fn() } as any;
  const guard = new CombinedAuthGuard(jwt, auth, audit);

  const context = (url: string) => {
    const request = {
      originalUrl: url,
      headers: { authorization: 'Bearer signed-token' },
      ip: '127.0.0.1',
    } as any;
    return {
      request,
      execution: { switchToHttp: () => ({ getRequest: () => request }) } as any,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({ sub: 'user-1', authVersion: 2 });
    auth.validateJwtUser.mockResolvedValue({
      userId: 'user-1', email: 'u@test', type: 'human', authVersion: 2, mustChangePassword: true,
    });
  });

  it('blocks normal API access while a temporary password is active', async () => {
    const { execution } = context('/api/spaces');
    await expect(guard.canActivate(execution)).rejects.toThrow('Password change required');
  });

  it('allows only the required-password-change endpoint', async () => {
    const { execution, request } = context('/api/auth/change-required-password');
    await expect(guard.canActivate(execution)).resolves.toBe(true);
    expect(request.user).toMatchObject({ userId: 'user-1', mustChangePassword: true });
  });
});
