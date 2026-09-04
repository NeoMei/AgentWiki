import { Injectable } from '@nestjs/common';
import { BusinessException } from '../filters/business-error';
import { PrismaService } from '../../database/prisma.service';
import {
  AgentAccessRoleSchema,
  agentGrantAllowsScope,
  agentRoleSpaceCapability,
  type AgentAccessRole,
} from '@neomei/agentwiki-sync-protocol';
import { Prisma } from '@prisma/client';
import {
  lockLiveAgentAuthorization,
  lockLiveAgentAuthorizationAcrossSpaceBoundary,
  type LockedAgentAuthorization,
} from './live-agent-authorization';

export type SpaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
export interface Principal {
  userId: string;
  agentId?: string;
  authorizationId?: string;
  authorizationSpaceId?: string;
  agentRole?: AgentAccessRole;
  scopes?: string[];
  credentialId?: string;
  platformRole?: 'user' | 'super_admin';
}
type PrincipalInput = string | Principal;

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Locks the human account before any Space advisory lock is acquired.
   *
   * Global human-write lock order is User -> Space advisory -> Space-scoped
   * rows. Platform account lock/delete updates the same User row, so either
   * the write completes before revocation or it waits and observes the revoked
   * account. Callers that later acquire a Space lock must invoke this method
   * first; assertLiveHumanSpaceAccess safely re-enters the same row lock.
   */
  async lockLiveHumanPrincipal(
    db: Prisma.TransactionClient,
    principal: Principal,
  ): Promise<{ id: string; type: string; platformRole: string; deletedAt: Date | null; lockedAt: Date | null }> {
    if (principal.agentId) throw new BusinessException('SPACE_ACCESS_DENIED', 'Human authorization is required');
    const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "User"
      WHERE "id" = ${principal.userId}
      FOR NO KEY UPDATE
    `);
    if (rows.length !== 1) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Human write authorization is no longer valid');
    }
    const user = await db.user.findUnique({
      where: { id: principal.userId },
      select: { id: true, type: true, platformRole: true, deletedAt: true, lockedAt: true },
    });
    if (!user || user.type !== 'human' || user.deletedAt || user.lockedAt) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Human write authorization is no longer valid');
    }
    return user;
  }

  async assertLiveHumanSpaceAccess(
    db: Prisma.TransactionClient,
    principal: Principal,
    spaceId: string,
    allowedRoles: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'],
  ): Promise<{ role: SpaceRole; userId: string; spaceId: string; isSuperAdmin?: true }> {
    const user = await this.lockLiveHumanPrincipal(db, principal);
    const space = await db.space.findUnique({ where: { id: spaceId }, select: { id: true, deletedAt: true } });
    if (!space || space.deletedAt) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Human write authorization is no longer valid');
    }
    if (user.platformRole === 'super_admin') {
      return { role: 'owner', userId: user.id, spaceId, isSuperAdmin: true };
    }
    const member = await db.spaceMember.findUnique({
      where: { userId_spaceId: { userId: user.id, spaceId } },
      select: { role: true },
    });
    const effectiveAllowedRoles = humanAllowedRoles(allowedRoles);
    if (!member || !effectiveAllowedRoles.includes(member.role as SpaceRole)) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Human write authorization is no longer valid');
    }
    return { role: member.role as SpaceRole, userId: user.id, spaceId };
  }

  async assertSpaceAccess(
    principalInput: PrincipalInput,
    spaceId: string,
    allowedRoles: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'],
    requiredScope?: string,
  ) {
    const principal = this.normalize(principalInput);
    const effectiveAllowedRoles = !principal.agentId ? humanAllowedRoles(allowedRoles) : allowedRoles;
    // Distinguish "space id does not exist" from "no permission". Callers (and
    // agents) often pass a display name; a 404 with a self-describing message
    // turns a dead-end permission error into a self-correcting one.
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: { id: true, deletedAt: true },
    });
    if (!space || space.deletedAt) {
      throw new BusinessException(
        'SPACE_NOT_FOUND',
        `Space not found: "${spaceId}". spaceId must be the space's internal id (CUID), not its display name. Call list_spaces or GET /api/integrations/mcp to see the spaces you can access and their ids.`,
      );
    }
    if (!principal.agentId && principal.platformRole === 'super_admin') {
      return { role: 'owner' as const, spaceId, userId: principal.userId, isSuperAdmin: true };
    }
    if (principal.agentId) {
      const grant = await this.prisma.agentGrant.findUnique({
        where: { agentId_spaceId: { agentId: principal.agentId, spaceId } },
        include: {
          agent: { select: { status: true, revokedAt: true } },
          space: { select: { deletedAt: true } },
        },
      });
      if (
        !grant ||
        !principal.authorizationId ||
        grant.id !== principal.authorizationId ||
        (principal.authorizationSpaceId !== undefined && principal.authorizationSpaceId !== spaceId) ||
        grant.agent.status !== 'active' ||
        grant.agent.revokedAt ||
        grant.space.deletedAt ||
        !AgentAccessRoleSchema.safeParse(grant.role).success ||
        !allowedRoles.includes(agentRoleSpaceCapability(grant.role))
      ) {
        throw new BusinessException('SPACE_ACCESS_DENIED', 'Agent does not have permission to access this space');
      }
      this.assertScope(requiredScope, grant.role, grant.folderScopes);
      return grant;
    }
    const member = await this.prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: principal.userId, spaceId } },
      include: { space: { select: { deletedAt: true } } },
    });
    if (!member || member.space.deletedAt || !effectiveAllowedRoles.includes(member.role as SpaceRole)) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'You do not have permission to access this space');
    }
    return member;
  }

  async assertPageAccess(
    principal: PrincipalInput,
    pageId: string,
    allowedRoles: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'],
    requiredScope?: string,
  ) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId, deletedAt: null },
      select: { id: true, spaceId: true },
    });
    if (!page) throw new BusinessException('RESOURCE_NOT_FOUND', 'Page not found');
    await this.assertSpaceAccess(principal, page.spaceId, allowedRoles, requiredScope);
    return page;
  }

  async assertRelationAccess(
    principal: PrincipalInput,
    relationId: string,
    allowedRoles: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'],
    requiredScope?: string,
  ) {
    const relation = await this.prisma.knowledgeRelation.findUnique({
      where: { id: relationId },
      include: { sourcePage: { select: { spaceId: true } } },
    });
    if (!relation) throw new BusinessException('RESOURCE_NOT_FOUND', 'Relation not found');
    const source = await this.assertPageAccess(principal, relation.sourcePageId, allowedRoles, requiredScope);
    const target = await this.prisma.page.findUnique({
      where: { id: relation.targetPageId, deletedAt: null },
      select: { spaceId: true },
    });
    if (!target || target.spaceId !== source.spaceId) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Relation crosses a space boundary');
    }
    return relation;
  }

  async assertSourceAccess(
    principal: PrincipalInput,
    sourceId: string,
    allowedRoles: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'],
    requiredScope = 'sources:read',
  ) {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true, spaceId: true },
    });
    if (!source) throw new BusinessException('RESOURCE_NOT_FOUND', 'Source not found');
    await this.assertSpaceAccess(principal, source.spaceId, allowedRoles, requiredScope);
    return source;
  }

  async assertIngestRunAccess(
    principal: PrincipalInput,
    runId: string,
    allowedRoles: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'],
    requiredScope = 'runs:read',
  ) {
    const run = await this.prisma.ingestRun.findUnique({
      where: { id: runId },
      select: { id: true, spaceId: true },
    });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Run not found');
    await this.assertSpaceAccess(principal, run.spaceId, allowedRoles, requiredScope);
    return run;
  }

  async assertChangeSetAccess(
    principal: PrincipalInput,
    changeSetId: string,
    allowedRoles: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'],
    requiredScope = 'review:read',
  ) {
    const changeSet = await this.prisma.changeSet.findUnique({
      where: { id: changeSetId },
      select: { id: true, spaceId: true },
    });
    if (!changeSet) throw new BusinessException('RESOURCE_NOT_FOUND', 'Change set not found');
    await this.assertSpaceAccess(principal, changeSet.spaceId, allowedRoles, requiredScope);
    return changeSet;
  }

  async assertAgentMemoryAccess(
    principalInput: PrincipalInput,
    agentId: string,
    spaceId: string,
    requiredScope: 'memory:read' | 'memory:write',
  ) {
    const principal = this.normalize(principalInput);
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { ownerId: true, status: true, revokedAt: true, memoryEnabled: true },
    });
    if (!agent || agent.revokedAt || !agent.memoryEnabled) {
    throw new BusinessException('SPACE_ACCESS_DENIED', 'Agent memory is not available');
    }
    if (principal.agentId) {
    if (principal.agentId !== agentId) throw new BusinessException('SPACE_ACCESS_DENIED', 'Agents can only access their own memory');
      await this.assertSpaceAccess(principal, spaceId, ['owner', 'editor', 'viewer'], requiredScope);
    } else {
    if (principal.userId !== agent.ownerId) throw new BusinessException('SPACE_ACCESS_DENIED', 'You do not own this agent');
      await this.assertSpaceAccess(principal, spaceId);
    }
    return agent;
  }

  async assertLiveAgentWriteAccess(
    db: Prisma.TransactionClient,
    principal: Principal,
    spaceId: string,
    requiredScopes: string[],
  ): Promise<void> {
    if (!principal.agentId) return;
    if (!principal.credentialId) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Agent write authorization is unavailable');
    }
    const state = await lockLiveAgentAuthorization(db, {
      ownerId: principal.userId,
      agentId: principal.agentId,
      credentialId: principal.credentialId,
    }, spaceId);
    if (!state || !this.isLiveAgentWriteAuthorized(state, principal, spaceId, requiredScopes)) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Agent write authorization is no longer valid');
    }
  }

  async assertLiveAgentAccess(
    principal: Principal,
    spaceId: string,
    requiredScopes: string[],
  ): Promise<void> {
    if (!principal.agentId) {
      const requiresWrite = requiredScopes.some((scope) => scope.endsWith(':write') || scope.endsWith(':delete'));
      await this.assertSpaceAccess(
        principal,
        spaceId,
        requiresWrite ? ['owner', 'editor'] : ['owner', 'admin', 'editor', 'viewer'],
      );
      return;
    }
    if (!principal.credentialId) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Agent authorization is unavailable');
    }
    const state = await this.prisma.$transaction((db) => lockLiveAgentAuthorization(db, {
      ownerId: principal.userId,
      agentId: principal.agentId!,
      credentialId: principal.credentialId!,
    }, spaceId));
    if (!state || !this.isLiveAgentBaseAuthorized(state, principal, spaceId)) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Agent authorization is no longer valid');
    }
    const missingScope = requiredScopes.find((scope) => !agentGrantAllowsScope(
      state.grant.role,
      state.grant.folderScopes,
      scope,
    ));
    if (missingScope) {
      throw new BusinessException('AUTH_SCOPE_REQUIRED', `Required scope is missing: ${missingScope}`);
    }
  }

  async lockLiveAgentWriteAccessAcrossSpaceBoundary<T>(
    db: Prisma.TransactionClient,
    principal: Principal,
    spaceId: string,
    requiredScopes: string[],
    acquireSpaceAdvisory: () => Promise<T>,
  ): Promise<T> {
    if (!principal.agentId) return acquireSpaceAdvisory();
    if (!principal.credentialId) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Agent write authorization is unavailable');
    }
    const locked = await lockLiveAgentAuthorizationAcrossSpaceBoundary(
      db,
      {
        ownerId: principal.userId,
        agentId: principal.agentId,
        credentialId: principal.credentialId,
      },
      spaceId,
      (state) => this.isLiveAgentWriteAuthorized(state, principal, spaceId, requiredScopes),
      acquireSpaceAdvisory,
    );
    if (!locked) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Agent write authorization is no longer valid');
    }
    return locked.spaceLock;
  }

  async getAccessibleSpaceIds(principalInput: PrincipalInput, requiredScope = 'spaces:read'): Promise<string[]> {
    const principal = this.normalize(principalInput);
    if (!principal.agentId && principal.platformRole === 'super_admin') {
      const spaces = await this.prisma.space.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      return spaces.map((space) => space.id);
    }
    if (principal.agentId) {
      if (!principal.authorizationId) return [];
      const grants = await this.prisma.agentGrant.findMany({
        where: {
          id: principal.authorizationId,
          agentId: principal.agentId,
          agent: { status: 'active', revokedAt: null },
          space: { deletedAt: null },
        },
        select: { spaceId: true, role: true, folderScopes: true },
      });
      return grants
        .filter((grant) => !requiredScope || agentGrantAllowsScope(
          grant.role, grant.folderScopes, requiredScope,
        ))
        .map((grant) => grant.spaceId);
    }
    const memberships = await this.prisma.spaceMember.findMany({
      where: { userId: principal.userId, space: { deletedAt: null } },
      select: { spaceId: true },
    });
    return memberships.map((membership) => membership.spaceId);
  }

  /**
   * Returns the spaces a principal can access with id, display name and role.
   * This is the in-band discovery path agents use to resolve a space's internal
   * id before calling space-scoped tools.
   */
  async listAccessibleSpaces(
    principalInput: PrincipalInput,
    requiredScope = 'spaces:read',
  ): Promise<Array<{ id: string; name: string; role: SpaceRole | AgentAccessRole }>> {
    const principal = this.normalize(principalInput);
    if (!principal.agentId && principal.platformRole === 'super_admin') {
      const spaces = await this.prisma.space.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      });
      return spaces.map((space) => ({ id: space.id, name: space.name, role: 'owner' }));
    }
    if (principal.agentId) {
      if (!principal.authorizationId) return [];
      const grants = await this.prisma.agentGrant.findMany({
        where: {
          id: principal.authorizationId,
          agentId: principal.agentId,
          agent: { status: 'active', revokedAt: null },
          space: { deletedAt: null },
        },
        select: {
          role: true, folderScopes: true,
          space: { select: { id: true, name: true, deletedAt: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return grants
        .filter((grant) => !grant.space.deletedAt && (!requiredScope || agentGrantAllowsScope(
          grant.role, grant.folderScopes, requiredScope,
        )))
        .map((grant) => ({ id: grant.space.id, name: grant.space.name, role: grant.role }));
    }
    const memberships = await this.prisma.spaceMember.findMany({
      where: { userId: principal.userId, space: { deletedAt: null } },
      select: { role: true, space: { select: { id: true, name: true, deletedAt: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships
      .filter((membership) => !membership.space.deletedAt)
      .map((membership) => ({ id: membership.space.id, name: membership.space.name, role: membership.role as SpaceRole }));
  }

  private normalize(principal: PrincipalInput): Principal {
    return typeof principal === 'string' ? { userId: principal } : principal;
  }

  private assertScope(
    requiredScope?: string,
    grantRole?: AgentAccessRole,
    folderScopes: readonly string[] = [],
  ) {
    if (!requiredScope) return;
    if (grantRole && !agentGrantAllowsScope(grantRole, folderScopes, requiredScope)) {
      if (requiredScope.startsWith('folders:')) {
        throw new BusinessException('AUTH_SCOPE_REQUIRED', `Required scope is missing: ${requiredScope}`);
      }
      throw new BusinessException('SPACE_ACCESS_DENIED', `Agent role is not granted scope ${requiredScope} in this space`);
    }
  }

  private isLiveAgentBaseAuthorized(
    state: LockedAgentAuthorization,
    principal: Principal,
    spaceId: string,
  ): boolean {
    const now = new Date();
    return !state.user.deletedAt &&
      !state.user.lockedAt &&
      state.agent.status === 'active' &&
      !state.agent.revokedAt &&
      !state.space.deletedAt &&
      !state.credential.revokedAt &&
      (!state.credential.expiresAt || state.credential.expiresAt > now) &&
      state.credential.authorizationId === state.grant.id &&
      principal.authorizationId === state.grant.id &&
      (principal.authorizationSpaceId === undefined || principal.authorizationSpaceId === spaceId);
  }

  private isLiveAgentWriteAuthorized(
    state: LockedAgentAuthorization,
    principal: Principal,
    spaceId: string,
    requiredScopes: string[],
  ): boolean {
    return this.isLiveAgentBaseAuthorized(state, principal, spaceId) &&
      (!requiredScopes.some((scope) => scope.startsWith('memory:')) || state.agent.memoryEnabled) &&
      requiredScopes.every((scope) => agentGrantAllowsScope(
        state.grant.role, state.grant.folderScopes, scope,
      ));
  }
}

function humanAllowedRoles(allowedRoles: SpaceRole[]): SpaceRole[] {
  return allowedRoles.includes('editor') && !allowedRoles.includes('admin')
    ? [...allowedRoles, 'admin']
    : allowedRoles;
}
