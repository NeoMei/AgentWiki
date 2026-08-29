import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  advanceRevisionChainHash,
  assertCompleteRevisionV2,
  assertRevisionV2Metadata,
  isValidRevisionChainCheckpoint,
  loadRevisionV2Evidence,
  revisionEvidenceShouldBeV2,
  revisionTreeDeltaHashV2,
  sealRevisionChainCheckpoint,
  validateRevisionChainTrust,
  REVISION_V2_SCALAR_SELECT,
  type RevisionV2ScalarMetadata,
} from './revision-v2-integrity';

const RETENTION_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;
const CURSOR_SAFETY_MS = 25 * 60 * 60 * 1_000;

function expiredForRetention(
  revision: { createdAt: Date; supersededAt: Date | null },
  now: number,
): boolean {
  if (!revision.supersededAt) return false;
  return now >= Math.max(
    revision.createdAt.getTime() + RETENTION_WINDOW_MS,
    revision.supersededAt.getTime() + CURSOR_SAFETY_MS,
  );
}

@Injectable()
export class RevisionRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prunes only the oldest contiguous eligible prefix under the shared Space
   * advisory lock. Verified v2 identities are compacted into one rolling
   * checkpoint whose live anchor remains immutable and fully queryable.
   */
  async cleanSpace(spaceId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${spaceId}))`;
      const revisions = await tx.spaceKnowledgeRevision.findMany({
        where: { spaceId },
        orderBy: { sequence: 'asc' },
        select: {
          ...REVISION_V2_SCALAR_SELECT,
          supersededAt: true,
        },
      });
      const head = revisions[revisions.length - 1];
      if (!head || revisions.length === 1) return 0;

      const checkpoint = await tx.spaceRevisionChainCheckpoint.findUnique({ where: { spaceId } });
      if (checkpoint && !isValidRevisionChainCheckpoint(checkpoint, spaceId)) {
        throw new Error('REVISION_CHAIN_CHECKPOINT_INVALID');
      }

      const headEvidence = await loadRevisionV2Evidence(tx, spaceId, head.id);
      const headShouldBeV2 = revisionEvidenceShouldBeV2(head, headEvidence);
      if (checkpoint || headShouldBeV2) {
        await validateRevisionChainTrust(
          tx,
          spaceId,
          head,
          revisions.slice(0, -1).reverse(),
        );
      }

      const now = Date.now();
      const candidates: typeof revisions = [];
      for (let index = 0; index < revisions.length - 1; index += 1) {
        const revision = revisions[index]!;
        const previous = index === 0 ? null : revisions[index - 1]!;
        if (previous && (
          revision.sequence !== previous.sequence + 1
          || revision.parentRevisionId !== previous.id
        )) break;
        if (!expiredForRetention(revision, now)) break;
        candidates.push(revision);
      }
      if (candidates.length === 0) return 0;

      const anchor = revisions[candidates.length]!;
      if (!anchor) throw new Error('REVISION_RETENTION_HEAD_BOUNDARY');

      let rollingChainHash = checkpoint?.rollingChainHash ?? null;
      let previousV2Manifest = null;
      let previousWasV2 = false;
      let boundary: RevisionV2ScalarMetadata | null = null;

      for (const revision of candidates) {
        const evidence = await loadRevisionV2Evidence(tx, spaceId, revision.id);
        const shouldBeV2 = revisionEvidenceShouldBeV2(revision, evidence, previousWasV2);
        if (!shouldBeV2) continue;

        if (
          checkpoint
          && revision.sequence === checkpoint.anchorSequence
          && revision.id === checkpoint.anchorRevisionId
        ) {
          previousV2Manifest = assertRevisionV2Metadata(revision, evidence);
          if (revisionTreeDeltaHashV2(evidence.deltaRows) !== checkpoint.anchorTreeDeltaHash) {
            throw new Error('REVISION_CHAIN_CHECKPOINT_ANCHOR_INVALID');
          }
        } else {
          previousV2Manifest = assertCompleteRevisionV2(
            revision,
            evidence,
            previousV2Manifest,
          );
        }
        previousWasV2 = true;
        rollingChainHash = advanceRevisionChainHash(rollingChainHash, revision);
        boundary = revision;
      }

      let nextCheckpoint = null;
      if (boundary) {
        const anchorEvidence = await loadRevisionV2Evidence(tx, spaceId, anchor.id);
        if (!revisionEvidenceShouldBeV2(anchor, anchorEvidence, true)) {
          throw new Error('REVISION_CHAIN_CHECKPOINT_ANCHOR_NOT_V2');
        }
        assertCompleteRevisionV2(anchor, anchorEvidence, previousV2Manifest);
        nextCheckpoint = sealRevisionChainCheckpoint({
          spaceId,
          boundarySequence: boundary.sequence,
          boundaryRevisionId: boundary.id,
          boundaryParentRevisionId: boundary.parentRevisionId,
          boundaryRevisionContentHash: boundary.revisionContentHash,
          rollingChainHash: rollingChainHash!,
          anchorSequence: anchor.sequence,
          anchorRevisionId: anchor.id,
          anchorParentRevisionId: anchor.parentRevisionId!,
          anchorRevisionContentHash: anchor.revisionContentHash,
          anchorTreeDeltaHash: revisionTreeDeltaHashV2(anchorEvidence.deltaRows),
        });
      } else if (headShouldBeV2) {
        // Legacy-only pruning may expose an old prefix. It is safe only when
        // the retained suffix has the exact Task 6 v2 genesis marker.
        try {
          const retained = revisions.slice(candidates.length);
          await validateRevisionChainTrust(
            tx,
            spaceId,
            retained[retained.length - 1]!,
            retained.slice(0, -1).reverse(),
          );
        } catch {
          return 0;
        }
      }

      if (nextCheckpoint) {
        await tx.spaceRevisionChainCheckpoint.upsert({
          where: { spaceId },
          create: nextCheckpoint,
          update: nextCheckpoint,
        });
      }

      const ids = candidates.map((revision) => revision.id);
      await tx.syncRevisionDeltaRow.deleteMany({ where: { revisionId: { in: ids } } });
      await tx.syncRevisionTreeDeltaRow.deleteMany({ where: { revisionId: { in: ids } } });
      await tx.syncRevisionFolderRow.deleteMany({ where: { revisionId: { in: ids } } });
      await tx.legacyRevisionPageExtra.deleteMany({ where: { revisionId: { in: ids } } });
      await tx.legacyRevisionSidecar.deleteMany({ where: { revisionId: { in: ids } } });
      await tx.syncRevisionPageRow.deleteMany({ where: { revisionId: { in: ids } } });
      await tx.spaceKnowledgeRevision.deleteMany({ where: { id: { in: ids } } });

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
      const staleLegacyHashes = await tx.$queryRaw<Array<{ contentHash: string }>>`
        SELECT b."contentHash"
        FROM "LegacyPageBodyRow" b
        WHERE NOT EXISTS (
          SELECT 1 FROM "LegacyRevisionPageExtra" e WHERE e."legacyBodyHash" = b."contentHash"
        )
      `;
      if (staleLegacyHashes.length > 0) {
        await tx.legacyPageBodyRow.deleteMany({
          where: { contentHash: { in: staleLegacyHashes.map((row) => row.contentHash) } },
        });
      }
      return candidates.length;
    });
  }
}
