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

    it('maps an Agent credential to the Agent principal without granting owner identity privileges', async () => {
      mockPrisma.apiKeyCredential.findUnique.mockResolvedValue(null);
      mockPrisma.agentCredential.findUnique.mockResolvedValue({
        id: 'agent-credential-1',
        agentId: 'agent-1',
        revokedAt: null,
        expiresAt: null,
        role: 'editor',
        scopes: ['pages:read'],
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
        agentRole: 'editor',
        type: 'agent',
        scopes: ['pages:read'],
      });
    });
  });
});
