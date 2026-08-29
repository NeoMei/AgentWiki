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
  grant: { id: string; role: AgentAccessRole; folderScopes: string[] };
  credential: { authorizationId: string; revokedAt: Date | null; expiresAt: Date | null };
}

type LockedNonSpaceAuthorization = Omit<LockedAgentAuthorization, 'space'>;

/**
 * Global structural-write lock order:
 *
 *   User -> Agent -> AgentGrant -> AgentCredential -> Space advisory -> Space
 *
 * A path that does not need the advisory lock omits that step but preserves the
 * remaining order. ContentTree/Page/Folder writers already take the advisory
 * lock before they update Space.contentTreeRevision. Live Agent writers must
 * therefore never lock the Space row before crossing that advisory boundary.
 *
 * Authorization mutations share the non-Space prefix. These rows use
 * FOR NO KEY UPDATE: it still serializes every revocation/policy-field update,
 * while remaining compatible with the implicit KEY SHARE locks taken by
 * structural-write foreign keys (for example Folder.createdByUserId).
 * The preliminary Space read below is deliberately non-locking: invalid
 * callers are rejected before they can occupy the Space advisory lock. After
 * the advisory lock is held, the
 * authoritative Space row is locked and re-read so deletion/policy changes
 * that raced the wait cannot authorize a write.
 */
export async function lockLiveAgentAuthorization(
  db: QueryClient,
  context: LiveAgentAuthorizationContext,
  spaceId: string,
): Promise<LockedAgentAuthorization | null> {
  const nonSpace = await lockAndReadNonSpaceAuthorization(db, context, spaceId);
  if (!nonSpace) return null;
  const space = await lockAndReadSpace(db, spaceId);
  if (!space) return null;
  return { ...nonSpace, space };
}

export async function lockLiveAgentAuthorizationAcrossSpaceBoundary<T>(
  db: QueryClient,
  context: LiveAgentAuthorizationContext,
  spaceId: string,
  isAuthorized: (state: LockedAgentAuthorization) => boolean,
  acquireSpaceAdvisory: () => Promise<T>,
): Promise<{ authorization: LockedAgentAuthorization; spaceLock: T } | null> {
  const nonSpace = await lockAndReadNonSpaceAuthorization(db, context, spaceId);
  if (!nonSpace) return null;

  const preliminarySpace = await readSpace(db, spaceId);
  if (!preliminarySpace) return null;
  const preliminary = { ...nonSpace, space: preliminarySpace };
  if (!isAuthorized(preliminary)) return null;

  const spaceLock = await acquireSpaceAdvisory();
  const authoritativeSpace = await lockAndReadSpace(db, spaceId);
  if (!authoritativeSpace) return null;
  const authorization = { ...nonSpace, space: authoritativeSpace };
  if (!isAuthorized(authorization)) return null;
  return { authorization, spaceLock };
}

async function lockAndReadNonSpaceAuthorization(
  db: QueryClient,
  context: LiveAgentAuthorizationContext,
  spaceId: string,
): Promise<LockedNonSpaceAuthorization | null> {
  const users = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "User"
    WHERE "id" = ${context.ownerId}
    FOR NO KEY UPDATE
  `);
  if (users.length !== 1) return null;

  const agents = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Agent"
    WHERE "id" = ${context.agentId} AND "ownerId" = ${context.ownerId}
    FOR NO KEY UPDATE
  `);
  if (agents.length !== 1) return null;

  const grants = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "AgentGrant"
    WHERE "agentId" = ${context.agentId} AND "spaceId" = ${spaceId}
    FOR NO KEY UPDATE
  `);
  if (grants.length !== 1) return null;

  const credentials = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "AgentCredential"
    WHERE "id" = ${context.credentialId} AND "agentId" = ${context.agentId}
    FOR NO KEY UPDATE
  `);
  if (credentials.length !== 1) return null;

  const client = db as any;
  const [credential, agent, grant] = await Promise.all([
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
      select: { id: true, role: true, folderScopes: true },
    }),
  ]);
  if (!credential || !agent || !grant || !agent.owner) return null;
  return {
    user: agent.owner,
    agent,
    grant,
    credential,
  };
}

async function lockAndReadSpace(
  db: QueryClient,
  spaceId: string,
): Promise<LockedAgentAuthorization['space'] | null> {
  const spaces = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Space"
    WHERE "id" = ${spaceId}
    FOR NO KEY UPDATE
  `);
  if (spaces.length !== 1) return null;
  return readSpace(db, spaceId);
}

async function readSpace(
  db: QueryClient,
  spaceId: string,
): Promise<LockedAgentAuthorization['space'] | null> {
  const client = db as any;
  return client.space.findUnique({
    where: { id: spaceId },
    select: { deletedAt: true, approvalPolicy: true },
  });
}
