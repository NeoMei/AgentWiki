import { Controller, Get, INestApplication, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AddressInfo } from 'net';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../security/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService } from './authorization.service';

@Controller('permission-probe')
@UseGuards(CombinedAuthGuard)
class PermissionProbeController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Get(':spaceId')
  async read(@Req() request: any, @Param('spaceId') spaceId: string) {
    await this.authorization.assertSpaceAccess(request.user, spaceId, ['owner', 'editor', 'viewer'], 'pages:read');
    return { allowed: true };
  }

  @Post(':spaceId')
  async write(@Req() request: any, @Param('spaceId') spaceId: string) {
    await this.authorization.assertSpaceAccess(request.user, spaceId, ['owner', 'editor'], 'pages:write');
    return { allowed: true };
  }
}

describe('HTTP authentication and space authorization', () => {
  let app: INestApplication;
  let baseUrl: string;
  const prisma = {
    spaceMember: { findUnique: jest.fn() },
    agentGrant: { findUnique: jest.fn() },
  } as any;
  const jwt = {
    verify: jest.fn((token: string) => {
      if (token === 'member-token') return { sub: 'member', email: 'member@example.test', type: 'human' };
      if (token === 'viewer-token') return { sub: 'viewer', email: 'viewer@example.test', type: 'human' };
      if (token === 'outsider-token') return { sub: 'outsider', email: 'outsider@example.test', type: 'human' };
      throw new Error('bad token');
    }),
  };
  const auth = {
    validateJwtUser: jest.fn(async (userId: string) => userId === 'deleted' ? null : ({
      userId,
      email: `${userId}@example.test`,
      type: 'human',
    })),
    validateApiKey: jest.fn(async (key: string) => key === 'agk_reader'
      ? { userId: 'owner', agentId: 'agent-1', credentialId: 'credential-1', scopes: ['pages:read'], type: 'agent', email: 'owner@example.test' }
      : key === 'agk_no_scope'
        ? { userId: 'owner', agentId: 'agent-1', credentialId: 'credential-2', scopes: [], type: 'agent', email: 'owner@example.test' }
        : null),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PermissionProbeController],
      providers: [
        AuthorizationService,
        CombinedAuthGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: AuthService, useValue: auth },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('allows a human member and rejects a non-member through the real HTTP guard chain', async () => {
    prisma.spaceMember.findUnique.mockImplementation(({ where }: any) => where.userId_spaceId.userId === 'member'
      ? Promise.resolve({ role: 'editor', space: { deletedAt: null } })
      : Promise.resolve(null));
    expect((await fetch(`${baseUrl}/permission-probe/space-1`, { headers: { authorization: 'Bearer member-token' } })).status).toBe(200);
    expect((await fetch(`${baseUrl}/permission-probe/space-1`, { headers: { authorization: 'Bearer outsider-token' } })).status).toBe(403);
  });

  it('prevents a viewer from writing', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({ role: 'viewer', space: { deletedAt: null } });
    expect((await fetch(`${baseUrl}/permission-probe/space-1`, { method: 'POST', headers: { authorization: 'Bearer viewer-token' } })).status).toBe(403);
  });

  it('rejects a validly signed token after its user is deleted', async () => {
    jwt.verify.mockReturnValueOnce({ sub: 'deleted', email: 'deleted@example.test', type: 'human' });
    expect((await fetch(`${baseUrl}/permission-probe/space-1`, {
      headers: { authorization: 'Bearer deleted-token' },
    })).status).toBe(401);
  });

  it('requires both the Agent scope and matching space grant', async () => {
    prisma.agentGrant.findUnique.mockResolvedValue({ role: 'viewer', agent: { status: 'active', revokedAt: null }, space: { deletedAt: null } });
    expect((await fetch(`${baseUrl}/permission-probe/space-1`, { headers: { 'x-api-key': 'agk_reader' } })).status).toBe(200);
    expect((await fetch(`${baseUrl}/permission-probe/space-1`, { headers: { 'x-api-key': 'agk_no_scope' } })).status).toBe(403);
    prisma.agentGrant.findUnique.mockResolvedValue(null);
    expect((await fetch(`${baseUrl}/permission-probe/space-2`, { headers: { 'x-api-key': 'agk_reader' } })).status).toBe(403);
  });
});
