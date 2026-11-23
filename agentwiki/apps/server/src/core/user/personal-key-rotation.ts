import { Prisma } from '@prisma/client';

export const PERSONAL_KEY_ROTATION_ID_PREFIX = 'pat_rotation_';

export async function lockConnectionOwner(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `);
}

// Regenerated Keys are retained even after revocation. Counting their reserved
// IDs gives a durable generation while leaving first issues and legacy codes at zero.
export function readPersonalKeyRotation(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  return tx.apiKeyCredential.count({
    where: { userId, id: { startsWith: PERSONAL_KEY_ROTATION_ID_PREFIX } },
  });
}
