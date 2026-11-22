import { Test, TestingModule } from '@nestjs/testing';
import { AuthService, type User } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { CombinedAuthGuard } from './combined-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { UniHubSessionService } from './unihub/unihub-session.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
  apiKeyCredential: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  agentCredential: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-token'),
};

describe('UniHub human JWTs', () => {
  const secret = 'unihub-session-test-secret';
  const jwt = new JwtService({ secret, signOptions: { expiresIn: '7d' } });
  const user: User = {
    id: 'user-1', email: 'unihub@example.test', name: 'Human', type: 'human', authVersion: 3,
  };
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } } as unknown as PrismaService;
  const sessions = { verify: jest.fn<Promise<boolean>, [string, string]>() };
  const service = new AuthService(jwt, prisma, sessions as unknown as UniHubSessionService);
  const strategy = new JwtStrategy(new ConfigService({ JWT_SECRET: secret }), service);
  const guard = new CombinedAuthGuard(jwt, service, { record: jest.fn() } as any);

  beforeEach(() => {
    sessions.verify.mockReset();
    sessions.verify.mockImplementation(async (sid, userId) => sid === 'active' && userId === 'user-1');
  });

  it('signs the session ID with the supplied Unix expiry', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const storedUser = { ...user, type: String(user.type), name: null };
    const payload = jwt.verify(service.signToken(storedUser, { sid: 'active', expiresAt }));
    expect(payload).toMatchObject({ sub: 'user-1', unihubSid: 'active', exp: expiresAt });
  });

  it('keeps the configured TTL and validation for a legacy JWT', async () => {
    const payload = jwt.verify(service.signToken(user));
    expect(payload.unihubSid).toBeUndefined();
    expect(payload.exp - payload.iat).toBe(7 * 24 * 60 * 60);
    await expect(strategy.validate(payload)).resolves.toMatchObject({ userId: 'user-1' });
    expect(sessions.verify).not.toHaveBeenCalled();
  });

  it.each(['revoked', '', null])('rejects a JWT with invalid session claim %p through Passport', async (sid) => {
    const payload = jwt.verify(jwt.sign({ sub: user.id, authVersion: 3, unihubSid: sid }));
    await expect(strategy.validate(payload)).rejects.toMatchObject({ status: 401 });
  });

  it.each([['active', true], ['revoked', false]])('enforces session %s through CombinedAuthGuard', async (sid, allowed) => {
    const token = jwt.sign({ sub: user.id, authVersion: 3, unihubSid: sid });
    const request = { headers: { authorization: `Bearer ${token}` } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    const outcome = guard.canActivate(context);
    if (allowed) await expect(outcome).resolves.toBe(true);
    else await expect(outcome).rejects.toMatchObject({ status: 401 });
  });
});

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: UniHubSessionService, useValue: { verify: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('should return token on valid credentials', async () => {
      const user = { id: '1', email: 'test@test.com', password: 'hashed', name: 'Test', type: 'human' };
      mockPrisma.user.findUnique.mockResolvedValue(user);
      jest.spyOn(service, 'validatePassword').mockResolvedValue(true);

      const result = await service.login('test@test.com', 'password');
      expect(result.access_token).toBe('mock-token');
    });

    it('returns the persisted platform role when validating a JWT user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@agentwiki.com',
        name: 'Admin',
        type: 'human',
        platformRole: 'super_admin',
      });

      await expect(service.validateJwtUser('admin-1')).resolves.toMatchObject({
        userId: 'admin-1',
        type: 'human',
        platformRole: 'super_admin',
      });
    });
  });

  describe('registration', () => {
    it.each([
      ['Password 1', 'ValidName', 'AUTH_PASSWORD_POLICY'],
      ['Password1', 'Valid Name', 'AUTH_NAME_POLICY'],
      ['   ', 'ValidName', 'AUTH_PASSWORD_POLICY'],
      ['Password1', '   ', 'AUTH_NAME_POLICY'],
      ['\t', 'ValidName', 'AUTH_PASSWORD_POLICY'],
      ['Password1', '\t', 'AUTH_NAME_POLICY'],
      ['\u3000', 'ValidName', 'AUTH_PASSWORD_POLICY'],
      ['Password1', '\u3000', 'AUTH_NAME_POLICY'],
    ])('rejects whitespace in registration credentials before persistence (%s / %s)', async (password, name, businessCode) => {
      await expect(service.register('new@test.com', password, name))
        .rejects.toMatchObject({
          businessCode,
          statusCode: 400,
        });
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('reports a duplicate email with the specific 409 business code', async () => {
      jest.spyOn(service, 'hashPassword').mockResolvedValue('hashed');
      mockPrisma.user.create.mockRejectedValueOnce({ code: 'P2002', meta: { target: ['email'] } });

      await expect(service.register('existing@test.com', 'Password1', 'Existing'))
        .rejects.toMatchObject({
          businessCode: 'AUTH_EMAIL_IN_USE',
          statusCode: 409,
          response: {
            statusCode: 409,
            code: 'AUTH_EMAIL_IN_USE',
            message: 'Email already in use',
            error: 'Conflict',
          },
        });
    });

    it.each([
      { code: 'P2024', message: 'Connection pool timeout' },
      new Error('Database is unavailable'),
    ])('keeps unrelated registration errors as a generic 500', async (failure) => {
      jest.spyOn(service, 'hashPassword').mockResolvedValue('hashed');
      mockPrisma.user.create.mockRejectedValueOnce(failure);

      await expect(service.register('new@test.com', 'Password1', 'New'))
        .rejects.toMatchObject({
          status: 500,
          response: {
            statusCode: 500,
            message: 'Registration failed',
            error: 'Internal Server Error',
          },
        });
    });

    it('always creates a human account', async () => {
      mockPrisma.user.create.mockImplementation(({ data }: any) => ({
        id: 'new-user',
        ...data,
      }));
      jest.spyOn(service, 'hashPassword').mockResolvedValue('hashed');
      await service.register('new@test.com', 'password', 'New');
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'human' }),
        }),
      );
    });
  });

  describe('API keys', () => {
    beforeEach(() => {
      mockPrisma.agentCredential.findUnique.mockResolvedValue(null);
    });
    it('rejects revoked credentials', async () => {
      mockPrisma.apiKeyCredential.findUnique.mockResolvedValue({
        revokedAt: new Date(),
        expiresAt: null,
        user: { deletedAt: null },
      });
      await expect(service.validateApiKey('awk_secret')).resolves.toBeNull();
    });

    it('returns scopes and updates last usage for active credentials', async () => {
      mockPrisma.apiKeyCredential.findUnique.mockResolvedValue({
        id: 'credential-1',
        revokedAt: null,
        expiresAt: null,
        scopes: ['pages:read'],
        user: {
          id: 'user-1',
          email: 'user@test.com',
          type: 'human',
          deletedAt: null,
        },
      });
      mockPrisma.apiKeyCredential.update.mockResolvedValue({});
      await expect(service.validateApiKey('awk_secret')).resolves.toMatchObject({
        credentialId: 'credential-1',
        scopes: ['pages:read'],
      });
    });

    it('derives an Agent identity without freezing any Space role', async () => {
      mockPrisma.apiKeyCredential.findUnique.mockResolvedValue(null);
      mockPrisma.agentCredential.findUnique.mockResolvedValue({
        id: 'agent-credential-1',
        agentId: 'agent-1',
        authorizationId: 'grant-1',
        revokedAt: null,
        expiresAt: null,
        authorization: {
          id: 'grant-1', agentId: 'agent-1', spaceId: 'space-1', role: 'editor',
          folderScopes: [],
        },
        agent: {
          status: 'active',
          revokedAt: null,
          ownerId: 'owner-1',
          owner: { email: 'owner@test.com', deletedAt: null },
        },
      });
      mockPrisma.agentCredential.update.mockResolvedValue({});
      await expect(service.validateApiKey('agk_secret')).resolves.toMatchObject({
        userId: 'owner-1',
        agentId: 'agent-1',
        type: 'agent',
        scopes: [],
      });
      expect(mockPrisma.agentCredential.findUnique).toHaveBeenCalledWith({
        where: expect.any(Object),
        include: {
          agent: { include: { owner: true } },
        },
      });
    });
  });
});
