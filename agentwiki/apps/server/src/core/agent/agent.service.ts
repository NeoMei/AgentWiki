import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreateAgentDto, CreateAgentCredentialDto, UpdateAgentDto } from '../dto/agent.dto';

const VALID_SCOPES = new Set([
  'spaces:read', 'pages:read', 'pages:write', 'graph:read', 'graph:write',
  'sources:read', 'sources:write', 'runs:read', 'runs:write',
    'review:read', 'review:auto-publish', 'memory:read', 'memory:write',
]);

@Injectable()
export class AgentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, dto: CreateAgentDto) {
    const agent = await this.prisma.agent.create({
      data: {
        ownerId,
        name: dto.name,
        description: dto.description,
        approvalMode: dto.approvalMode || 'always-review',
        memoryEnabled: dto.memoryEnabled || false,
      },
    });
    await this.audit(agent.id, 'agent.create', 'success');
    return agent;
  }

  async list(ownerId: string) {
    return this.prisma.agent.findMany({
      where: { ownerId, revokedAt: null },
      include: {
        grants: { include: { space: { select: { id: true, name: true } } } },
        _count: { select: { credentials: true, auditEvents: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOwned(ownerId: string, id: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: {
        grants: { include: { space: { select: { id: true, name: true } } } },
        credentials: {
          where: { revokedAt: null },
          select: {
            id: true, name: true, prefix: true, scopes: true,
            expiresAt: true, lastUsedAt: true, createdAt: true,
          },
        },
      },
    });
    if (!agent || agent.revokedAt) throw new NotFoundException('Agent not found');
    if (agent.ownerId !== ownerId) throw new ForbiddenException('You do not own this agent');
    return agent;
  }

  async update(ownerId: string, id: string, dto: UpdateAgentDto) {
    await this.getOwned(ownerId, id);
    const agent = await this.prisma.agent.update({ where: { id }, data: dto });
    await this.audit(id, dto.status === 'paused' ? 'agent.pause' : 'agent.update', 'success');
    return agent;
  }

  async revoke(ownerId: string, id: string) {
    await this.getOwned(ownerId, id);
    await this.prisma.$transaction([
      this.prisma.agentCredential.updateMany({
        where: { agentId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.agent.update({
        where: { id },
        data: { status: 'revoked', revokedAt: new Date() },
      }),
    ]);
    await this.audit(id, 'agent.revoke', 'success');
    return { success: true };
  }

  async createCredential(ownerId: string, agentId: string, dto: CreateAgentCredentialDto) {
    const agent = await this.getOwned(ownerId, agentId);
    if (agent.status === 'revoked') throw new BadRequestException('Agent is revoked');
    const scopes = Array.from(new Set(dto.scopes));
    if (scopes.length === 0 || scopes.some((scope) => !VALID_SCOPES.has(scope))) {
      throw new BadRequestException('Credential contains an invalid or empty scope list');
    }
    const rawKey = 'agk_' + randomBytes(32).toString('base64url');
    const credential = await this.prisma.agentCredential.create({
      data: {
        agentId,
        name: dto.name,
        prefix: rawKey.slice(0, 12),
        keyHash: createHash('sha256').update(rawKey).digest('hex'),
        scopes,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
      select: {
        id: true, name: true, prefix: true, scopes: true,
        expiresAt: true, lastUsedAt: true, createdAt: true,
      },
    });
    await this.audit(agentId, 'credential.create', 'success', 'AgentCredential', credential.id);
    return { ...credential, apiKey: rawKey };
  }

  async listCredentials(ownerId: string, agentId: string) {
    await this.getOwned(ownerId, agentId);
    return this.prisma.agentCredential.findMany({
      where: { agentId, revokedAt: null },
      select: {
        id: true, name: true, prefix: true, scopes: true,
        expiresAt: true, lastUsedAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeCredential(ownerId: string, agentId: string, credentialId: string) {
    await this.getOwned(ownerId, agentId);
    const result = await this.prisma.agentCredential.updateMany({
      where: { id: credentialId, agentId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Credential not found');
    await this.audit(agentId, 'credential.revoke', 'success', 'AgentCredential', credentialId);
    return { success: true };
  }

  async upsertGrant(ownerId: string, agentId: string, spaceId: string, role: 'viewer' | 'editor') {
    await this.getOwned(ownerId, agentId);
    const grant = await this.prisma.agentGrant.upsert({
      where: { agentId_spaceId: { agentId, spaceId } },
      create: { agentId, spaceId, role },
      update: { role },
      include: { space: { select: { id: true, name: true } } },
    });
    await this.audit(agentId, 'grant.upsert', 'success', 'Space', spaceId, { role });
    return grant;
  }

  async removeGrant(ownerId: string, agentId: string, spaceId: string) {
    await this.getOwned(ownerId, agentId);
    await this.prisma.agentGrant.deleteMany({ where: { agentId, spaceId } });
    await this.audit(agentId, 'grant.remove', 'success', 'Space', spaceId);
    return { success: true };
  }

  async activity(ownerId: string, agentId: string, skip = 0, take = 50) {
    await this.getOwned(ownerId, agentId);
    const [data, total] = await Promise.all([
      this.prisma.agentAuditEvent.findMany({
        where: { agentId }, skip, take, orderBy: { createdAt: 'desc' },
      }),
      this.prisma.agentAuditEvent.count({ where: { agentId } }),
    ]);
    return { data, total, page: Math.floor(skip / take) + 1, limit: take };
  }

  recentMcpCalls(ownerId: string, agentId?: string) {
    return this.prisma.agentAuditEvent.findMany({
      where: {
        action: { contains: 'mcp', mode: 'insensitive' },
        agent: { ownerId },
        ...(agentId ? { agentId } : {}),
      },
      select: {
        id: true, action: true, outcome: true, resourceType: true,
        resourceId: true, createdAt: true,
        agent: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async integrationAccess(ownerId: string, agentId?: string) {
    if (agentId) await this.getOwned(ownerId, agentId);
    const agents = await this.prisma.agent.findMany({
      where: {
        ownerId,
        revokedAt: null,
        ...(agentId ? { id: agentId } : {}),
      },
      select: {
        id: true,
        name: true,
        status: true,
        grants: {
          select: { role: true, space: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        credentials: {
          where: { revokedAt: null },
          select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true, lastUsedAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    const now = Date.now();
    return agents.map((agent) => ({
      ...agent,
      credentials: agent.credentials.map((credential) => ({
        ...credential,
        active: !credential.expiresAt || credential.expiresAt.getTime() > now,
      })),
    }));
  }

  private async audit(
    agentId: string,
    action: string,
    outcome: string,
    resourceType?: string,
    resourceId?: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.prisma.agentAuditEvent.create({
      data: { agentId, action, outcome, resourceType, resourceId, metadata: metadata as any },
    });
  }
}
