import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service';

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

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
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
      ['Password 1', 'ValidName'],
      ['Password1', 'Valid Name'],
      ['   ', 'ValidName'],
    ])('rejects whitespace in registration credentials before persistence (%s / %s)', async (password, name) => {
      await expect(service.register('new@test.com', password, name))
        .rejects.toMatchObject({
          businessCode: password.includes(' ') ? 'AUTH_PASSWORD_POLICY' : 'AUTH_NAME_POLICY',
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
