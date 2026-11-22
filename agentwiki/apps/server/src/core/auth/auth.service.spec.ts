import { Test, TestingModule } from '@nestjs/testing';
import { AuthService, type User } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { CombinedAuthGuard } from './combined-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { createHash } from 'crypto';
import { UniHubClient } from './unihub/unihub-client';
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
  const findUser = jest.fn();
  const prisma = { user: { findUnique: findUser } } as unknown as PrismaService;
  const sessions = { verify: jest.fn<Promise<boolean>, [string, string]>() };
  const service = new AuthService(jwt, prisma, sessions as unknown as UniHubSessionService);
  const strategy = new JwtStrategy(new ConfigService({ JWT_SECRET: secret }), service);
  const guard = new CombinedAuthGuard(jwt, service, { record: jest.fn() } as any);

  beforeEach(() => {
    findUser.mockReset().mockResolvedValue(user);
    sessions.verify.mockReset();
    sessions.verify.mockImplementation(async (sid, userId) => sid === 'active' && userId === 'user-1');
  });

  it('signs the session ID with the supplied Unix expiry', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const storedUser = { ...user, type: String(user.type), name: null };
    const payload = jwt.verify(service.signToken(storedUser, { sid: 'active', expiresAt }));
    expect(payload).toMatchObject({ sub: 'user-1', unihubSid: 'active', exp: expiresAt });
    expect(payload).not.toHaveProperty('jti');
  });

  it('issues distinct native JWTs to the same user in the same second', () => {
    const issuedAt = 1_700_000_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(issuedAt * 1_000);
    try {
      const first = service.signToken(user);
      const second = service.signToken(user);
      const claims = jwt.verify(first);
      expect(claims).toEqual({
        sub: user.id,
        email: user.email,
        type: 'human',
        authVersion: 3,
        passwordChangeRequired: false,
        iat: issuedAt,
        exp: issuedAt + 7 * 24 * 60 * 60,
        jti: expect.any(String),
      });
      expect(jwt.verify(second).jti).not.toBe(claims.jti);
      expect(second).not.toBe(first);
    } finally {
      clock.mockRestore();
    }
  });

  it('continues to validate previously issued native JWTs without a JWT ID', async () => {
    const payload = jwt.verify(jwt.sign({
      sub: user.id, email: user.email, type: user.type, authVersion: 3, passwordChangeRequired: false,
    }));
    expect(payload).not.toHaveProperty('jti');
    await expect(strategy.validate({ headers: {} }, payload)).resolves.toMatchObject({ userId: 'user-1' });
    expect(sessions.verify).not.toHaveBeenCalled();
  });

  it.each(['revoked', '', null])('rejects a JWT with invalid session claim %p through Passport', async (sid) => {
    const payload = jwt.verify(jwt.sign({ sub: user.id, authVersion: 3, unihubSid: sid }));
    await expect(strategy.validate({ headers: {} }, payload)).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    ['locked', { lockedAt: new Date() }],
    ['reset', { authVersion: 4 }],
  ])('rejects a JWT when the local account is %s during UniHub verification', async (_change, patch) => {
    const token = service.signToken(user, { sid: 'active', expiresAt: Math.floor(Date.now() / 1_000) + 60 });
    let finishVerification!: (verified: boolean) => void;
    let startVerification!: () => void;
    const started = new Promise<void>((resolve) => { startVerification = resolve; });
    sessions.verify.mockImplementationOnce(() => {
      startVerification();
      return new Promise<boolean>((resolve) => { finishVerification = resolve; });
    });

    const validation = strategy.validate({ headers: {} }, jwt.verify(token));
    await started;
    findUser.mockResolvedValue({ ...user, ...patch });
    finishVerification(true);

    await expect(validation).rejects.toMatchObject({ status: 401 });
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

describe('Native JWT logout through the REST guards', () => {
  const secret = 'native-logout-test-secret';
  const jwt = new JwtService({ secret, signOptions: { expiresIn: '7d' } });
  const user = {
    id: 'user-1', email: 'native@example.test', name: 'Native', type: 'human', authVersion: 0,
  } as const;
  const findSession = jest.fn();
  const runtime = { lifecycleEnabled: true };
  let service: AuthService;

  beforeEach(async () => {
    findSession.mockReset();
    runtime.lifecycleEnabled = true;
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwt },
        { provide: UniHubClient, useValue: runtime },
        { provide: UniHubSessionService, useValue: { verify: jest.fn() } },
        { provide: PrismaService, useValue: {
          user: { findUnique: jest.fn(async () => user) },
          uniHubNativeBrowserSession: { findUnique: findSession },
        } },
      ],
    }).compile();
    service = module.get(AuthService);
    new JwtStrategy(new ConfigService({ JWT_SECRET: secret }), service);
  });

  function authorization(token: string, guard: JwtAuthGuard | CombinedAuthGuard) {
    const request = { headers: { authorization: 'Bearer ' + token } };
    const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }) } as any;
    return guard.canActivate(context);
  }

  it.each(['Passport', 'combined'])('rejects only the explicitly revoked token through %s auth', async (kind) => {
    const guard = kind === 'Passport' ? new JwtAuthGuard() : new CombinedAuthGuard(jwt, service, {} as any);
    const token = service.signToken(user);
    const sibling = service.signToken(user);
    const id = createHash('sha256').update(token).digest('hex');
    // Simulate a tombstone recorded even when the token was never tracked.
    findSession.mockImplementation(async ({ where }) =>
      where.id === id && where.userId === user.id && where.revokedAt?.not === null ? { id } : null);

    await expect(authorization(sibling, guard)).resolves.toBe(true);
    await expect(authorization(token, guard)).rejects.toMatchObject({ status: 401 });
  });

  it('keeps native JWTs stateless when lifecycle integration is disabled', async () => {
    runtime.lifecycleEnabled = false;
    const token = jwt.sign({ sub: user.id, authVersion: 0 });
    await expect(authorization(token, new JwtAuthGuard())).resolves.toBe(true);
    expect(findSession).not.toHaveBeenCalled();
  });
});
