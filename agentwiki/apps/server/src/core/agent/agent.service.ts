import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreateAgentDto, UpdateAgentDto } from '../dto/agent.dto';
import {
  folderScopesForAgentAccessRole,
  scopesForAgentGrant,
  type AgentAccessRole,
} from '@neomei/agentwiki-sync-protocol';

@Injectable()
export class AgentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, dto: CreateAgentDto) {
    const id = dto.idempotencyKey ? deterministicAgentId(ownerId, dto.idempotencyKey) : undefined;
    const description = dto.description ?? undefined;
    const data = {
      ...(id ? { id } : {}),
      ownerId,
      name: dto.name,
      description,
      memoryEnabled: dto.memoryEnabled || false,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const agent = await tx.agent.create({ data });
        await tx.agentAuditEvent.create({
          data: { agentId: agent.id, action: 'agent.create', outcome: 'success' },
        });
        return agent;
      });
    } catch (error) {
      if (!id || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const existing = await this.prisma.agent.findUnique({ where: { id } });
      if (!existing
        || existing.ownerId !== ownerId
        || existing.revokedAt
        || existing.name !== dto.name
        || (existing.description ?? undefined) !== description
        || existing.memoryEnabled !== (dto.memoryEnabled || false)) {
        throw new BadRequestException('Idempotency key was already used for a different Agent');
      }
      return existing;
    }
  }

  async list(ownerId: string) {
    const agents = await this.prisma.agent.findMany({
      where: { ownerId, revokedAt: null },
      include: {
        grants: { include: { space: { select: { id: true, name: true } } } },
        _count: { select: { credentials: true, auditEvents: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return agents.map((agent) => ({
      ...agent,
      grants: agent.grants.map((grant) => this.grantResponse(grant)),
    }));
  }

  async getOwned(ownerId: string, id: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: {
        grants: { include: { space: { select: { id: true, name: true } } } },
        credentials: {
          where: { revokedAt: null },
          select: {
            id: true, name: true, prefix: true, authorizationId: true,
            expiresAt: true, lastUsedAt: true, createdAt: true,
            authorization: {
              select: {
                role: true, folderScopes: true,
                space: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!agent || agent.revokedAt) throw new NotFoundException('Agent not found');
    if (agent.ownerId !== ownerId) throw new ForbiddenException('You do not own this agent');
    return {
      ...agent,
      grants: (agent.grants ?? []).map((grant) => this.grantResponse(grant)),
      credentials: (agent.credentials ?? []).map((credential) => ({
        id: credential.id,
        name: credential.name,
        prefix: credential.prefix,
        authorization: {
          id: credential.authorizationId,
          role: credential.authorization.role,
          scopes: scopesForAgentGrant(
            credential.authorization.role,
            credential.authorization.folderScopes,
          ),
          space: credential.authorization.space,
        },
        expiresAt: credential.expiresAt,
        lastUsedAt: credential.lastUsedAt,
        createdAt: credential.createdAt,
      })),
    };
  }

  async update(ownerId: string, id: string, dto: UpdateAgentDto) {
    await this.getOwned(ownerId, id);
    const agent = await this.prisma.agent.update({ where: { id }, data: dto });
    await this.audit(id, dto.status === 'paused' ? 'agent.pause' : 'agent.update', 'success');
    return agent;
  }

  async revoke(ownerId: string, id: string) {
    await this.getOwned(ownerId, id);
    await this.prisma.$transaction(async (tx) => {
      // Keep revocation in the same owner -> Agent -> Credential lock order as
      // live authorization checks. Reversing Agent/Credential can deadlock a
      // write that is concurrently proving its Credential is still valid.
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "User" WHERE "id" = ${ownerId} FOR UPDATE
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Agent"
        WHERE "id" = ${id} AND "ownerId" = ${ownerId}
        FOR UPDATE
      `);
      const agent = await tx.agent.findFirst({
        where: { id, ownerId, revokedAt: null },
        select: { id: true },
      });
      if (!agent) throw new NotFoundException('Agent not found');

      const revokedAt = new Date();
      await tx.agentCredential.updateMany({
        where: { agentId: id, revokedAt: null },
        data: { revokedAt },
      });
      await tx.agent.update({
        where: { id },
        data: { status: 'revoked', revokedAt },
      });
    });
    await this.audit(id, 'agent.revoke', 'success');
    return { success: true };
  }

  async assertCanIssueConnection(
    ownerId: string,
    agentId: string,
    spaceId: string,
    isSuperAdmin = false,
  ): Promise<void> {
    const agent = await this.getOwned(ownerId, agentId);
    if (agent.status !== 'active') throw new BadRequestException('Agent must be active');
    const space = await this.prisma.space.findFirst({
      where: {
        id: spaceId,
        deletedAt: null,
        ...(!isSuperAdmin ? {
          members: { some: { userId: ownerId, role: { in: ['owner', 'admin'] } } },
        } : {}),
      },
      select: { id: true },
    });
    if (!space) {
      throw new ForbiddenException('You cannot authorize this Agent for the Space');
    }
  }

  async exchangeConnectionIntent(input: {
    ownerId: string;
    agentId: string;
    spaceId: string;
    role: AgentAccessRole;
    installationId: string;
    rawKey: string;
  }): Promise<{
    id: string;
    grantId: string;
    agentId: string;
    role: AgentAccessRole;
    scopes: string[];
    apiKey: string;
  }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockAgentAuthorizationMutationRows(
        tx, input.ownerId, input.agentId, input.spaceId, true,
      );
      const owner = await tx.user.findFirst({
        where: {
          id: input.ownerId,
          deletedAt: null,
          lockedAt: null,
        },
        select: { id: true, platformRole: true },
      });
      const agent = await tx.agent.findFirst({
        where: {
          id: input.agentId,
          ownerId: input.ownerId,
          status: 'active',
          revokedAt: null,
          owner: { deletedAt: null, lockedAt: null },
        },
        select: { id: true },
      });
      const space = await tx.space.findFirst({
        where: {
          id: input.spaceId,
          deletedAt: null,
          ...(owner?.platformRole === 'super_admin' ? {} : {
            members: { some: { userId: input.ownerId, role: { in: ['owner', 'admin'] } } },
          }),
        },
        select: { id: true },
      });
      if (!owner || !agent || !space) {
        throw new ForbiddenException('Connection authorization is no longer valid');
      }

      const keyHash = createHash('sha256').update(input.rawKey).digest('hex');
      const previousGrant = await tx.agentGrant.findUnique({
        where: { agentId_spaceId: { agentId: input.agentId, spaceId: input.spaceId } },
        select: { role: true },
      });
      const grant = await tx.agentGrant.upsert({
        where: { agentId_spaceId: { agentId: input.agentId, spaceId: input.spaceId } },
        create: {
          agentId: input.agentId,
          spaceId: input.spaceId,
          role: input.role,
          folderScopes: folderScopesForAgentAccessRole(input.role),
        },
        update: {
          role: input.role,
          folderScopes: folderScopesForAgentAccessRole(input.role),
        },
        select: { id: true, role: true, folderScopes: true },
      });
      const credential = await tx.agentCredential.upsert({
        where: { localSyncInstallationId: input.installationId },
        create: {
          agentId: input.agentId,
          authorizationId: grant.id,
          name: 'AgentWiki connection',
          prefix: input.rawKey.slice(0, 12),
          keyHash,
          localSyncInstallationId: input.installationId,
        },
        update: {},
        select: {
          id: true,
          agentId: true,
          authorizationId: true,
          keyHash: true,
          revokedAt: true,
        },
      });
      if (
        credential.agentId !== input.agentId
        || credential.authorizationId !== grant.id
        || credential.keyHash !== keyHash
        || credential.revokedAt
      ) {
        throw new ForbiddenException('Connection credential is unavailable');
      }
      if (input.role === 'publisher') {
        await tx.agent.update({
          where: { id: input.agentId },
          data: { memoryEnabled: true, approvalMode: 'scoped-auto-publish' },
        });
      }
      await tx.agentAuditEvent.create({
        data: {
          agentId: input.agentId,
          action: 'connection.authorize',
          outcome: 'success',
          resourceType: 'Space',
          resourceId: input.spaceId,
          metadata: {
            credentialId: credential.id,
            oldRole: previousGrant?.role ?? null,
            newRole: input.role,
          },
        },
      });
      return {
        id: credential.id,
        grantId: grant.id,
        agentId: credential.agentId,
        role: grant.role,
        scopes: scopesForAgentGrant(grant.role, grant.folderScopes),
        apiKey: input.rawKey,
      };
    });
  }

  async assertConnectionReceipt(input: {
    ownerId: string;
    agentId: string;
    credentialId: string;
    grantId: string;
    spaceId: string;
    role: AgentAccessRole;
  }): Promise<{ scopes: string[] }> {
    const [credential, grant] = await Promise.all([
      this.prisma.agentCredential.findFirst({
        where: {
          id: input.credentialId,
          agentId: input.agentId,
          authorizationId: input.grantId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          agent: {
            ownerId: input.ownerId,
            status: 'active',
            revokedAt: null,
            owner: { deletedAt: null, lockedAt: null },
          },
        },
        select: { id: true, authorizationId: true },
      }),
      this.prisma.agentGrant.findFirst({
        where: {
          id: input.grantId,
          agentId: input.agentId,
          spaceId: input.spaceId,
          role: input.role,
        },
        select: {
          id: true,
          role: true,
          folderScopes: true,
          space: { select: { deletedAt: true } },
        },
      }),
    ]);
    if (
      !credential
      || !grant
      || credential.id !== input.credentialId
      || credential.authorizationId !== input.grantId
      || grant.id !== input.grantId
      || grant.role !== input.role
      || grant.space.deletedAt
    ) {
      throw new ForbiddenException('Connection credential is unavailable');
    }
    return { scopes: scopesForAgentGrant(grant.role, grant.folderScopes) };
  }

  async listCredentials(ownerId: string, agentId: string) {
    await this.getOwned(ownerId, agentId);
    const credentials = await this.prisma.agentCredential.findMany({
      where: { agentId, revokedAt: null },
      select: {
        id: true, name: true, prefix: true, authorizationId: true,
        expiresAt: true, lastUsedAt: true, createdAt: true,
        authorization: {
          select: {
            role: true, folderScopes: true,
            space: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return credentials.map((credential) => ({
      id: credential.id,
      name: credential.name,
      prefix: credential.prefix,
      authorization: {
        id: credential.authorizationId,
        role: credential.authorization.role,
        scopes: scopesForAgentGrant(
          credential.authorization.role,
          credential.authorization.folderScopes,
        ),
        space: credential.authorization.space,
      },
      expiresAt: credential.expiresAt,
      lastUsedAt: credential.lastUsedAt,
      createdAt: credential.createdAt,
    }));
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

  async upsertGrant(ownerId: string, agentId: string, spaceId: string, role: AgentAccessRole) {
    return this.upsertGrantForSpace(ownerId, agentId, spaceId, role);
  }

  async upsertGrantForSpace(
    actorUserId: string,
    agentId: string,
    spaceId: string,
    role: AgentAccessRole,
    isSuperAdmin = false,
  ) {
    await this.getOwned(actorUserId, agentId);
    return this.prisma.$transaction(async (tx) => {
      const agent = await this.assertGrantMutationAuthority(
        tx, actorUserId, agentId, spaceId, isSuperAdmin,
      );
      const existingGrant = await tx.agentGrant.findUnique({
        where: { agentId_spaceId: { agentId, spaceId } },
        select: { id: true, role: true },
      });
      if (!existingGrant && agent.status !== 'active') {
        throw new BadRequestException('Agent must be active before it can join a space');
      }
      const grant = await tx.agentGrant.upsert({
        where: { agentId_spaceId: { agentId, spaceId } },
        create: {
          agentId, spaceId, role,
          folderScopes: folderScopesForAgentAccessRole(role),
        },
        update: { role, folderScopes: folderScopesForAgentAccessRole(role) },
        include: { space: { select: { id: true, name: true } } },
      });
      if (role === 'publisher') {
        await tx.agent.update({
          where: { id: agentId },
          data: { memoryEnabled: true, approvalMode: 'scoped-auto-publish' },
        });
      }
      await tx.agentAuditEvent.create({
        data: {
          agentId,
          action: 'grant.upsert',
          outcome: 'success',
          resourceType: 'Space',
          resourceId: spaceId,
          metadata: { oldRole: existingGrant?.role ?? null, newRole: role, spaceId },
        },
      });
      return { ...grant, scopes: scopesForAgentGrant(grant.role, grant.folderScopes) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async removeGrant(
    ownerId: string,
    agentId: string,
    spaceId: string,
    isSuperAdmin = false,
  ) {
    await this.getOwned(ownerId, agentId);
    return this.prisma.$transaction(async (tx) => {
      await this.assertGrantMutationAuthority(
        tx, ownerId, agentId, spaceId, isSuperAdmin,
      );
      await tx.agentGrant.deleteMany({ where: { agentId, spaceId } });
      await tx.agentAuditEvent.create({
        data: {
          agentId,
          action: 'grant.remove',
          outcome: 'success',
          resourceType: 'Space',
          resourceId: spaceId,
        },
      });
      return { success: true as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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

  recentMcpCalls(ownerId: string, agentId?: string, credentialId?: string) {
    if (agentId && !credentialId) {
      throw new ForbiddenException('Connection credential is unavailable');
    }
    return this.prisma.agentAuditEvent.findMany({
      where: {
        action: { contains: 'mcp', mode: 'insensitive' },
        agent: { ownerId },
        ...(agentId ? { agentId } : {}),
        ...(credentialId ? {
          metadata: { path: ['credentialId'], equals: credentialId },
        } : {}),
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

  async integrationAccess(ownerId: string, agentId?: string, authorizationId?: string) {
    if (agentId) {
      if (!authorizationId) throw new ForbiddenException('Connection authorization is unavailable');
      await this.getOwned(ownerId, agentId);
    }
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
          ...(authorizationId ? { where: { id: authorizationId } } : {}),
          select: {
            role: true, folderScopes: true,
            space: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        credentials: {
          where: {
            revokedAt: null,
            ...(authorizationId ? { authorizationId } : {}),
          },
          select: {
            id: true, name: true, prefix: true, authorizationId: true,
            expiresAt: true, lastUsedAt: true,
            authorization: {
              select: {
                role: true, folderScopes: true,
                space: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    const now = Date.now();
    return agents.map((agent) => ({
      ...agent,
      grants: agent.grants.map((grant) => this.grantResponse(grant)),
      credentials: agent.credentials.map((credential) => ({
        id: credential.id,
        name: credential.name,
        prefix: credential.prefix,
        authorization: {
          id: credential.authorizationId,
          role: credential.authorization.role,
          scopes: scopesForAgentGrant(
            credential.authorization.role,
            credential.authorization.folderScopes,
          ),
          space: credential.authorization.space,
        },
        expiresAt: credential.expiresAt,
        lastUsedAt: credential.lastUsedAt,
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

  private grantResponse<T extends { role: AgentAccessRole; folderScopes: string[] }>(grant: T) {
    return {
      ...grant,
      scopes: scopesForAgentGrant(grant.role, grant.folderScopes),
    };
  }

  private async assertGrantMutationAuthority(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    agentId: string,
    spaceId: string,
    isSuperAdmin: boolean,
  ): Promise<{ id: string; status: string }> {
    await this.lockAgentAuthorizationMutationRows(
      tx, actorUserId, agentId, spaceId, !isSuperAdmin,
    );
    const [agent, space, platformAdmin] = await Promise.all([
      tx.agent.findFirst({
        where: {
          id: agentId,
          ownerId: actorUserId,
          revokedAt: null,
          owner: { deletedAt: null, lockedAt: null },
        },
        select: { id: true, status: true },
      }),
      tx.space.findFirst({
        where: {
          id: spaceId,
          deletedAt: null,
          ...(isSuperAdmin ? {} : {
            members: { some: { userId: actorUserId, role: { in: ['owner', 'admin'] } } },
          }),
        },
        select: { id: true },
      }),
      isSuperAdmin
        ? tx.user.findFirst({
            where: {
              id: actorUserId,
              platformRole: 'super_admin',
              deletedAt: null,
              lockedAt: null,
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (!agent || !space || (isSuperAdmin && !platformAdmin)) {
      throw new ForbiddenException('Grant mutation authorization is no longer valid');
    }
    return agent;
  }

  private async lockAgentAuthorizationMutationRows(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    agentId: string,
    spaceId: string,
    lockMembership: boolean,
  ): Promise<void> {
    // Match the live-write prefix before touching Space:
    // owner -> Agent -> Grant -> Space -> membership. A live structural writer
    // may insert AgentCredential -> Space advisory between Grant and Space, but
    // the shared owner/Agent prefix serializes these mutation paths first.
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "User" WHERE "id" = ${actorUserId} FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Agent"
      WHERE "id" = ${agentId} AND "ownerId" = ${actorUserId}
      FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "AgentGrant"
      WHERE "agentId" = ${agentId} AND "spaceId" = ${spaceId}
      FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Space" WHERE "id" = ${spaceId} FOR UPDATE
    `);
    if (lockMembership) {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "SpaceMember"
        WHERE "userId" = ${actorUserId} AND "spaceId" = ${spaceId}
        FOR UPDATE
      `);
    }
  }

}

function deterministicAgentId(ownerId: string, idempotencyKey: string): string {
  return `agent_${createHash('sha256')
    .update(ownerId)
    .update('\0')
    .update(idempotencyKey)
    .digest('hex')
    .slice(0, 32)}`;
}
