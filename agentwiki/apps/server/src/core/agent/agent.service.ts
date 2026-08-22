import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreateAgentDto, CreateAgentCredentialDto, UpdateAgentDto } from '../dto/agent.dto';
import type { AgentAccessRole } from '@neomei/agentwiki-sync-protocol';

const VALID_SCOPES = new Set([
  'spaces:read', 'pages:read', 'pages:write', 'graph:read', 'graph:write',
  'sources:read', 'sources:write', 'runs:read', 'runs:write',
    'review:read', 'review:auto-publish', 'memory:read', 'memory:write',
]);

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

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
    const scopes = this.normalizeCredentialScopes(dto.scopes);
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
    try {
      await this.audit(agentId, 'credential.create', 'success', 'AgentCredential', credential.id);
    } catch (error) {
      this.logger.warn(`Credential ${credential.id} was persisted but its audit event failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { ...credential, apiKey: rawKey };
  }

  async createInstallationCredential(
    ownerId: string,
    agentId: string,
    installationId: string,
    rawKey: string,
    scopes: string[],
  ) {
    const agent = await this.getOwned(ownerId, agentId);
    if (agent.status !== 'active') throw new BadRequestException('Agent must be active');
    const normalizedScopes = this.normalizeCredentialScopes(scopes);
    const select = {
      id: true,
      agentId: true,
      keyHash: true,
      scopes: true,
      revokedAt: true,
    } as const;
    let credential = await this.prisma.agentCredential.findUnique({
      where: { localSyncInstallationId: installationId },
      select,
    });
    let created = false;
    if (!credential) {
      try {
        credential = await this.prisma.agentCredential.create({
          data: {
            agentId,
            name: 'Local sync plugin',
            prefix: rawKey.slice(0, 12),
            keyHash: createHash('sha256').update(rawKey).digest('hex'),
            localSyncInstallationId: installationId,
            scopes: normalizedScopes,
          },
          select,
        });
        created = true;
      } catch (error) {
        try {
          credential = await this.prisma.agentCredential.findUnique({
            where: { localSyncInstallationId: installationId },
            select,
          });
        } catch {
          throw error;
        }
        if (!credential) throw error;
      }
    }
    if (
      credential.agentId !== agentId
      || credential.keyHash !== createHash('sha256').update(rawKey).digest('hex')
      || credential.revokedAt
      || normalizedScopes.some((scope) => !credential.scopes.includes(scope))
      || credential.scopes.some((scope) => !normalizedScopes.includes(scope))
    ) {
      throw new ForbiddenException('Local sync installation credential is unavailable');
    }
    if (created) {
      await this.audit(agentId, 'credential.create', 'success', 'AgentCredential', credential.id)
        .catch((error) => this.logger.warn(
          `Installation credential ${credential!.id} audit failed: ${error instanceof Error ? error.message : String(error)}`,
        ));
    }
    return { ...credential, apiKey: rawKey, created };
  }

  normalizeCredentialScopes(scopes: string[]): string[] {
    const input = Array.from(new Set(scopes));
    if (input.length === 0) {
      throw new BadRequestException('Credential contains an invalid or empty scope list');
    }
    if (input.includes('*')) {
      return Array.from(VALID_SCOPES);
    }
    if (input.some((scope) => !VALID_SCOPES.has(scope))) {
      throw new BadRequestException('Credential contains an invalid or empty scope list');
    }
    return input;
  }

  async assertCredentialCanDelegate(
    ownerId: string,
    agentId: string,
    credentialId: string,
    requestedScopes: string[],
  ): Promise<void> {
    const credential = await this.prisma.agentCredential.findFirst({
      where: {
        id: credentialId,
        agentId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        agent: {
          ownerId,
          status: 'active',
          revokedAt: null,
          owner: { deletedAt: null, lockedAt: null },
        },
      },
      select: { scopes: true },
    });
    if (!credential || requestedScopes.some((scope) => !credential.scopes.includes(scope))) {
      throw new ForbiddenException('The issuing Agent credential is unavailable or no longer permits these scopes');
    }
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

  async upsertGrant(ownerId: string, agentId: string, spaceId: string, role: 'viewer' | 'editor', scopes?: string[]) {
    await this.getOwned(ownerId, agentId);
    return this.upsertGrantForSpace(ownerId, agentId, spaceId, role, scopes);
  }

  // Space-level grant management: creating a new grant requires an active Agent
  // owned by the caller. Once the Agent is already a Space member, owner/admin
  // callers may continue to manage that existing grant regardless of ownership.
  async upsertGrantForSpace(
    actorUserId: string,
    agentId: string,
    spaceId: string,
    role: 'viewer' | 'editor',
    scopes?: string[],
  ) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, ownerId: true, status: true, revokedAt: true },
    });
    if (!agent || agent.revokedAt || agent.status === 'revoked') {
      throw new NotFoundException('Agent not found');
    }
    const existingGrant = await this.prisma.agentGrant.findUnique({
      where: { agentId_spaceId: { agentId, spaceId } },
      select: { id: true },
    });
    if (!existingGrant) {
      if (agent.ownerId !== actorUserId) {
        throw new NotFoundException('Agent not found');
      }
      if (agent.status !== 'active') {
        throw new BadRequestException('Agent must be active before it can join a space');
      }
    }

    let normalizedScopes = scopes === undefined ? undefined : Array.from(new Set(scopes));
    if (normalizedScopes?.includes('*')) {
      normalizedScopes = Array.from(VALID_SCOPES);
    }
    if (normalizedScopes?.some((scope) => !VALID_SCOPES.has(scope))) {
      throw new BadRequestException('Grant contains an invalid scope');
    }
    // The public DTO moves to the canonical three-role contract in Task 3.
    // Until then, persist the legacy read-only input conservatively as reader.
    const persistedRole: AgentAccessRole = role === 'viewer' ? 'reader' : role;
    const createData = normalizedScopes !== undefined
      ? { agentId, spaceId, role: persistedRole, scopes: normalizedScopes }
      : { agentId, spaceId, role: persistedRole };
    const grant = await this.prisma.agentGrant.upsert({
      where: { agentId_spaceId: { agentId, spaceId } },
      create: createData,
      update: normalizedScopes !== undefined
        ? { role: persistedRole, scopes: normalizedScopes }
        : { role: persistedRole },
      include: { space: { select: { id: true, name: true } } },
    });
    await this.audit(agentId, 'grant.upsert', 'success', 'Space', spaceId, { role, scopes: normalizedScopes });
    return grant;
  }

  async removeGrant(ownerId: string, agentId: string, spaceId: string) {
    await this.getOwned(ownerId, agentId);
    return this.removeGrantForSpace(agentId, spaceId);
  }

  async removeGrantForSpace(agentId: string, spaceId: string) {
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
