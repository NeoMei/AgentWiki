import { Injectable } from '@nestjs/common';
import { BusinessException } from '../filters/business-error';
import { PrismaService } from '../../database/prisma.service';

export type SpaceRole = 'owner' | 'editor' | 'viewer';
export interface Principal {
  userId: string;
  agentId?: string;
  scopes?: string[];
  credentialId?: string;
}
type PrincipalInput = string | Principal;

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async assertSpaceAccess(
    principalInput: PrincipalInput,
    spaceId: string,
    allowedRoles: SpaceRole[] = ['owner', 'editor', 'viewer'],
    requiredScope?: string,
  ) {
    const principal = this.normalize(principalInput);
    if (principal.agentId) {
      this.assertScope(principal, requiredScope);
      const grant = await this.prisma.agentGrant.findUnique({
        where: { agentId_spaceId: { agentId: principal.agentId, spaceId } },
        include: {
          agent: { select: { status: true, revokedAt: true } },
          space: { select: { deletedAt: true } },
        },
      });
      if (
        !grant ||
        grant.agent.status !== 'active' ||
        grant.agent.revokedAt ||
        grant.space.deletedAt ||
        !allowedRoles.includes(grant.role as SpaceRole)
      ) {
        throw new BusinessException('SPACE_ACCESS_DENIED', 'Agent does not have permission to access this space');
      }
      return grant;
    }
    const member = await this.prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: principal.userId, spaceId } },
      include: { space: { select: { deletedAt: true } } },
    });
    if (!member || member.space.deletedAt || !allowedRoles.includes(member.role as SpaceRole)) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'You do not have permission to access this space');
    }
    return member;
  }

  async assertPageAccess(
    principal: PrincipalInput,
    pageId: string,
    allowedRoles: SpaceRole[] = ['owner', 'editor', 'viewer'],
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
    allowedRoles: SpaceRole[] = ['owner', 'editor', 'viewer'],
    requiredScope?: string,
  ) {
    const relation = await this.prisma.knowledgeRelation.findUnique({
      where: { id: relationId },
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
    allowedRoles: SpaceRole[] = ['owner', 'editor', 'viewer'],
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
    allowedRoles: SpaceRole[] = ['owner', 'editor', 'viewer'],
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
    allowedRoles: SpaceRole[] = ['owner', 'editor', 'viewer'],
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

  async getAccessibleSpaceIds(principalInput: PrincipalInput, requiredScope = 'spaces:read'): Promise<string[]> {
    const principal = this.normalize(principalInput);
    if (principal.agentId) {
      this.assertScope(principal, requiredScope);
      const grants = await this.prisma.agentGrant.findMany({
        where: {
          agentId: principal.agentId,
          agent: { status: 'active', revokedAt: null },
          space: { deletedAt: null },
        },
        select: { spaceId: true },
      });
      return grants.map((grant) => grant.spaceId);
    }
    const memberships = await this.prisma.spaceMember.findMany({
      where: { userId: principal.userId, space: { deletedAt: null } },
      select: { spaceId: true },
    });
    return memberships.map((membership) => membership.spaceId);
  }

  private normalize(principal: PrincipalInput): Principal {
    return typeof principal === 'string' ? { userId: principal } : principal;
  }

  private assertScope(principal: Principal, requiredScope?: string) {
    if (!requiredScope || !principal.scopes?.includes(requiredScope)) {
      throw new BusinessException('AUTH_SCOPE_REQUIRED', `Agent credential requires scope: ${requiredScope || 'explicit scope'}`);
    }
  }
}
