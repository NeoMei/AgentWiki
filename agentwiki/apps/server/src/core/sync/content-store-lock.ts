import type { Prisma } from '@prisma/client';

export const CONTENT_STORE_ADVISORY_LOCK_KEY = 'agentwiki:sync-page-content-store:v1';

/**
 * Global serialization boundary for content rows and every revision/session
 * reference that can keep them alive. Structural writers acquire the Space
 * advisory lock first; standalone staging writers and GC acquire only this
 * two-key advisory lock.
 */
export async function lockContentStore(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${CONTENT_STORE_ADVISORY_LOCK_KEY}), 0)
  `;
}
