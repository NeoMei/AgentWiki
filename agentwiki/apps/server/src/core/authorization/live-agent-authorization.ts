import { Prisma } from '@prisma/client';
import type { AgentAccessRole } from '@neomei/agentwiki-sync-protocol';

type QueryClient = {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
};

export interface LiveAgentAuthorizationContext {
  ownerId: string;
  agentId: string;
  credentialId: string;
}

export interface LockedAgentAuthorization {
  user: { deletedAt: Date | null; lockedAt: Date | null };
  agent: {
    status: string;
    revokedAt: Date | null;
    approvalMode: string;
    memoryEnabled: boolean;
  };
  space: { deletedAt: Date | null; approvalPolicy: string };
  grant: { id: string; role: AgentAccessRole };
  credential: { authorizationId: string; revokedAt: Date | null; expiresAt: Date | null };
}

/**
 * Lock every row that defines one Agent authorization in one deterministic
 * order. Authorization mutations use the same order so a proposal, sync, role
 * change, or Credential revocation cannot observe a half-changed permission
 * set or deadlock through planner-dependent JOIN lock ordering.
 */
export async function lockLiveAgentAuthorization(
  db: QueryClient,
  context: LiveAgentAuthorizationContext,
  spaceId: string,
): Promise<LockedAgentAuthorization | null> {
  const users = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "User"
    WHERE "id" = ${context.ownerId}
    FOR UPDATE
  `);
  if (users.length !== 1) return null;

  const agents = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Agent"
    WHERE "id" = ${context.agentId} AND "ownerId" = ${context.ownerId}
    FOR UPDATE
  `);
  if (agents.length !== 1) return null;

  const spaces = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Space"
    WHERE "id" = ${spaceId}
    FOR UPDATE
  `);
  if (spaces.length !== 1) return null;

  const grants = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "AgentGrant"
    WHERE "agentId" = ${context.agentId} AND "spaceId" = ${spaceId}
    FOR UPDATE
  `);
  if (grants.length !== 1) return null;

  const credentials = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "AgentCredential"
    WHERE "id" = ${context.credentialId} AND "agentId" = ${context.agentId}
    FOR UPDATE
  `);
  if (credentials.length !== 1) return null;

  const client = db as any;
  const [credential, agent, grant, space] = await Promise.all([
    client.agentCredential.findFirst({
      where: { id: context.credentialId, agentId: context.agentId },
      select: { authorizationId: true, revokedAt: true, expiresAt: true },
    }),
    client.agent.findUnique({
      where: { id: context.agentId },
      select: {
        status: true,
        revokedAt: true,
        approvalMode: true,
        memoryEnabled: true,
        owner: { select: { deletedAt: true, lockedAt: true } },
      },
    }),
    client.agentGrant.findUnique({
      where: { agentId_spaceId: { agentId: context.agentId, spaceId } },
      select: { id: true, role: true },
    }),
    client.space.findUnique({
      where: { id: spaceId },
      select: { deletedAt: true, approvalPolicy: true },
    }),
  ]);
  if (!credential || !agent || !grant || !space || !agent.owner) return null;
  return {
    user: agent.owner,
    agent,
    space,
    grant,
    credential,
  };
}
