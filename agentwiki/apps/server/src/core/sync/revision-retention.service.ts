import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { lockContentStore } from './content-store-lock';
import {
  advanceRevisionChainHash,
  assertCompleteRevisionV2,
  assertRevisionV2Metadata,
  hasTrustedV2GenesisBoundary,
  hasTrustedV2GenesisMarker,
  isValidRevisionChainCheckpoint,
  loadRevisionV2EvidenceBatch,
  revisionEvidenceShouldBeV2,
  revisionTreeDeltaHashV2,
  sealRevisionChainCheckpoint,
  REVISION_V2_SCALAR_SELECT,
  type LoadedRevisionV2Evidence,
  type RevisionV2ScalarMetadata,
} from './revision-v2-integrity';

const RETENTION_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;
const CURSOR_SAFETY_MS = 25 * 60 * 60 * 1_000;
export const REVISION_RETENTION_BATCH_SIZE = 64;

type RetentionRevision = RevisionV2ScalarMetadata & {
  createdAt: Date;
  supersededAt: Date | null;
};

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
  private readonly logger = new Logger(RevisionRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prune at most one fixed-size oldest eligible prefix. Revision/checkpoint
   * mutation commits under the Space lock; best-effort global content GC runs
   * afterward in its own transaction so a GC failure can only leak blobs.
   */
  async cleanSpace(spaceId: string): Promise<number> {
    const removed = await this.prisma.$transaction((tx) => this.compactSpace(tx, spaceId));
    try {
      await this.garbageCollectContent();
    } catch (error) {
      this.logger.warn(
        `Content-store GC deferred after retention for Space ${spaceId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
    return removed;
  }

  private async compactSpace(
    tx: Prisma.TransactionClient,
    spaceId: string,
  ): Promise<number> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${spaceId}))`;
    const revisions = await tx.spaceKnowledgeRevision.findMany({
      where: { spaceId },
      orderBy: { sequence: 'asc' },
      take: REVISION_RETENTION_BATCH_SIZE + 1,
      select: {
        ...REVISION_V2_SCALAR_SELECT,
        supersededAt: true,
      },
    }) as RetentionRevision[];
    if (revisions.length <= 1) return 0;

    const checkpoint = await tx.spaceRevisionChainCheckpoint.findUnique({ where: { spaceId } });
    if (checkpoint && !isValidRevisionChainCheckpoint(checkpoint, spaceId)) {
      throw new Error('REVISION_CHAIN_CHECKPOINT_INVALID');
    }
    const first = revisions[0]!;
    if (checkpoint && (
      first.sequence !== checkpoint.anchorSequence
      || first.id !== checkpoint.anchorRevisionId
      || first.parentRevisionId !== checkpoint.anchorParentRevisionId
      || first.revisionContentHash !== checkpoint.anchorRevisionContentHash
    )) throw new Error('REVISION_CHAIN_CHECKPOINT_ANCHOR_INVALID');

    const candidates: RetentionRevision[] = [];
    const scanLimit = Math.min(REVISION_RETENTION_BATCH_SIZE, revisions.length - 1);
    const now = Date.now();
    for (let index = 0; index < scanLimit; index += 1) {
      const revision = revisions[index]!;
      const previous = index === 0 ? null : revisions[index - 1]!;
      if (previous && (
        revision.sequence !== previous.sequence + 1
        || revision.parentRevisionId !== previous.id
      )) throw new Error('REVISION_RETENTION_CHAIN_GAP');
      if (!expiredForRetention(revision, now)) break;
      candidates.push(revision);
    }
    if (candidates.length === 0) return 0;

    const anchor = revisions[candidates.length];
    if (!anchor) throw new Error('REVISION_RETENTION_HEAD_BOUNDARY');
    const lastCandidate = candidates[candidates.length - 1]!;
    if (
      anchor.sequence !== lastCandidate.sequence + 1
      || anchor.parentRevisionId !== lastCandidate.id
    ) throw new Error('REVISION_RETENTION_CHAIN_GAP');

    const retainedWindow = [...candidates, anchor];
    const evidenceByRevision = await loadRevisionV2EvidenceBatch(
      tx,
      spaceId,
      retainedWindow.map((revision) => revision.id),
    );
    let rollingChainHash = checkpoint?.rollingChainHash ?? null;
    let previousV2Manifest = null;
    let previousWasV2 = false;
    let boundary: RevisionV2ScalarMetadata | null = null;

    for (let index = 0; index < candidates.length; index += 1) {
      const revision = candidates[index]!;
      const evidence = evidenceByRevision.get(revision.id)!;
      const isCheckpointAnchor = !!checkpoint
        && index === 0
        && revision.id === checkpoint.anchorRevisionId;
      if (isCheckpointAnchor) {
        previousV2Manifest = assertRevisionV2Metadata(revision, evidence);
        if (revisionTreeDeltaHashV2(evidence.deltaRows) !== checkpoint.anchorTreeDeltaHash) {
          throw new Error('REVISION_CHAIN_CHECKPOINT_ANCHOR_INVALID');
        }
        previousWasV2 = true;
      } else {
        const shouldBeV2 = revisionEvidenceShouldBeV2(revision, evidence, previousWasV2);
        if (!shouldBeV2) continue;
        if (!previousWasV2) {
          await this.assertV2GenesisTransition(
            tx,
            spaceId,
            revision,
            evidence,
            retainedWindow,
            evidenceByRevision,
            index,
          );
        }
        previousV2Manifest = assertCompleteRevisionV2(
          revision,
          evidence,
          previousV2Manifest,
        );
        previousWasV2 = true;
      }
      rollingChainHash = advanceRevisionChainHash(rollingChainHash, revision);
      boundary = revision;
    }

    let nextCheckpoint = null;
    const anchorEvidence = evidenceByRevision.get(anchor.id)!;
    if (boundary) {
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
    } else if (revisionEvidenceShouldBeV2(anchor, anchorEvidence)) {
      // Legacy-only pruning may expose v2 only when the exact Task 6 genesis
      // and its retained sequence-1 predecessor are verified in this txn.
      await this.assertV2GenesisTransition(
        tx,
        spaceId,
        anchor,
        anchorEvidence,
        retainedWindow,
        evidenceByRevision,
        candidates.length,
      );
      assertCompleteRevisionV2(anchor, anchorEvidence, null);
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
    return candidates.length;
  }

  private async assertV2GenesisTransition(
    tx: Prisma.TransactionClient,
    spaceId: string,
    revision: RevisionV2ScalarMetadata,
    evidence: LoadedRevisionV2Evidence,
    retainedWindow: readonly RetentionRevision[],
    evidenceByRevision: ReadonlyMap<string, LoadedRevisionV2Evidence>,
    index: number,
  ): Promise<void> {
    if (revision.sequence === 1 && revision.parentRevisionId === null) return;
    if (!hasTrustedV2GenesisMarker(spaceId, revision, evidence.sidecar)) {
      throw new Error('REVISION_RETENTION_UNTRUSTED_V2_GENESIS');
    }
    const earlier = retainedWindow.slice(0, index);
    if (earlier.some((candidate) => revisionEvidenceShouldBeV2(
      candidate,
      evidenceByRevision.get(candidate.id)!,
    ))) throw new Error('REVISION_RETENTION_EARLIER_V2_EVIDENCE');
    if (!await hasTrustedV2GenesisBoundary(tx, spaceId, revision, earlier)) {
      throw new Error('REVISION_RETENTION_GENESIS_PARENT_INVALID');
    }
  }

  private async garbageCollectContent(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockContentStore(tx);
      await tx.$executeRaw`
        WITH deleted_sync_content AS (
          DELETE FROM "SyncPageContentRow" c
          WHERE NOT EXISTS (
            SELECT 1 FROM "SyncRevisionPageRow" r
            WHERE r."contentHash" = c."contentHash"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "PushSessionChange" s
            WHERE s."contentHash" = c."contentHash"
          )
          RETURNING c."contentHash"
        )
        DELETE FROM "LegacyPageBodyRow" b
        WHERE NOT EXISTS (
          SELECT 1 FROM "LegacyRevisionPageExtra" e
          WHERE e."legacyBodyHash" = b."contentHash"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "PushSessionChange" s
          WHERE s."contentHash" = b."contentHash"
        )
      `;
    });
  }
}
