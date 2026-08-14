import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

const RETENTION_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;
const CURSOR_SAFETY_MS = 25 * 60 * 60 * 1_000;

@Injectable()
export class RevisionRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deletes non-head revisions that are past max(publishedAt + 31d,
   * supersededAt + 25h). Each space is processed under a transaction-scoped
   * advisory lock so cleanup cannot race a new head publication or a cursor
   * that is still within its 24-hour window.
   */
  async cleanSpace(spaceId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${spaceId}))`;
      const head = await tx.spaceKnowledgeRevision.findFirst({
        where: { spaceId },
        orderBy: { sequence: 'desc' },
        select: { id: true },
      });
      if (!head) return 0;
      const now = Date.now();
      const candidates = await tx.spaceKnowledgeRevision.findMany({
        where: {
          spaceId,
          id: { not: head.id },
          supersededAt: { not: null },
        },
        select: { id: true, supersededAt: true, createdAt: true },
      });
      const expired = candidates.filter((revision) => {
        const publishedAt = revision.createdAt.getTime();
        const supersededAt = revision.supersededAt?.getTime() ?? publishedAt;
        const deadline = Math.max(
          publishedAt + RETENTION_WINDOW_MS,
          supersededAt + CURSOR_SAFETY_MS,
        );
        return now >= deadline;
      });
      if (expired.length === 0) return 0;
      const ids = expired.map((revision) => revision.id);
      await tx.syncRevisionDeltaRow.deleteMany({ where: { revisionId: { in: ids } } });
      await tx.legacyRevisionPageExtra.deleteMany({ where: { revisionId: { in: ids } } });
      await tx.legacyRevisionSidecar.deleteMany({ where: { revisionId: { in: ids } } });
      await tx.syncRevisionPageRow.deleteMany({ where: { revisionId: { in: ids } } });
      await tx.spaceKnowledgeRevision.deleteMany({ where: { id: { in: ids } } });
      // GC content blobs that are no longer referenced by any remaining
      // revision row, Page row, or push-session staging body.
      const staleContentHashes = await tx.$queryRaw<Array<{ contentHash: string }>>`
        SELECT c."contentHash"
        FROM "SyncPageContentRow" c
        WHERE NOT EXISTS (
          SELECT 1 FROM "SyncRevisionPageRow" r WHERE r."contentHash" = c."contentHash"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "PushSessionChange" s
          WHERE s."contentHash" = c."contentHash" AND s."operation" = 'upsert'
        )
      `;
      if (staleContentHashes.length > 0) {
        await tx.syncPageContentRow.deleteMany({
          where: { contentHash: { in: staleContentHashes.map((row) => row.contentHash) } },
        });
      }
      return expired.length;
    });
  }
}
