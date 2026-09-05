import type { Prisma } from '@prisma/client';
import { agentRoleAllowsScope } from '@neomei/agentwiki-sync-protocol';
import { BusinessException } from '../core/filters/business-error';

export async function assertCollaborationAgentsReady(
  tx: Prisma.TransactionClient,
  spaceId: string,
  agentIds: readonly string[],
): Promise<void> {
  await assertCollaborationAgentGrantsExecutable(tx, spaceId, agentIds, true);
}

export async function assertCollaborationAgentGrantsExecutable(
  tx: Prisma.TransactionClient,
  spaceId: string,
  agentIds: readonly string[],
  requireCredential = false,
): Promise<void> {
  const issues = await inspectCollaborationAgentReadiness(
    tx, spaceId, agentIds, requireCredential,
  );
  const first = issues[0];
  if (first) throw new BusinessException(first.code);
}

export type CollaborationAgentReadinessIssue = {
  code: 'COLLABORATION_AGENT_INACTIVE' | 'COLLABORATION_AGENT_CANNOT_EXECUTE';
  agentId: string;
};

export async function inspectCollaborationAgentReadiness(
  tx: Prisma.TransactionClient,
  spaceId: string,
  agentIds: readonly string[],
  requireCredential = false,
): Promise<CollaborationAgentReadinessIssue[]> {
  const uniqueIds = [...new Set(agentIds)];
  const grants = await tx.agentGrant.findMany({
    where: { spaceId, agentId: { in: uniqueIds } },
    include: {
      agent: { select: { id: true, status: true, revokedAt: true, owner: { select: { deletedAt: true, lockedAt: true } } } },
      space: { select: { deletedAt: true } },
      credentials: {
        where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { id: true },
      },
    },
  });
  const byAgent = new Map(grants.map((grant) => [grant.agentId, grant]));
  const issues: CollaborationAgentReadinessIssue[] = [];
  for (const agentId of uniqueIds.sort()) {
    const grant = byAgent.get(agentId);
    if (!grant) {
      issues.push({ code: 'COLLABORATION_AGENT_CANNOT_EXECUTE', agentId });
      continue;
    }
    const owner = grant.agent.owner;
    if (grant.agent.status !== 'active' || grant.agent.revokedAt || !owner
      || owner.deletedAt || owner.lockedAt || grant.space.deletedAt) {
      issues.push({ code: 'COLLABORATION_AGENT_INACTIVE', agentId });
      continue;
    }
    if (!agentRoleAllowsScope(grant.role, 'collaboration:execute')
      || (requireCredential && grant.credentials.length === 0)) {
      issues.push({ code: 'COLLABORATION_AGENT_CANNOT_EXECUTE', agentId });
    }
  }
  return issues;
}
