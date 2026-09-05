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
  for (const agentId of uniqueIds) {
    const grant = byAgent.get(agentId);
    if (!grant) throw new BusinessException('COLLABORATION_AGENT_CANNOT_EXECUTE');
    const owner = grant.agent.owner;
    if (grant.agent.status !== 'active' || grant.agent.revokedAt || !owner
      || owner.deletedAt || owner.lockedAt || grant.space.deletedAt) {
      throw new BusinessException('COLLABORATION_AGENT_INACTIVE');
    }
    if (!agentRoleAllowsScope(grant.role, 'collaboration:execute')
      || (requireCredential && grant.credentials.length === 0)) {
      throw new BusinessException('COLLABORATION_AGENT_CANNOT_EXECUTE');
    }
  }
}
