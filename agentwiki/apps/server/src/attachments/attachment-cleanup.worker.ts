import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { lstat, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaService } from '../database/prisma.service';
import { isAttachmentBlobReferenced } from '../core/sync/revision-retention.service';
import type { AttachmentConfig } from './attachment.config';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from './attachment-storage';
import { ATTACHMENT_CONFIG } from './attachment.config';

const ARCHIVED_SCAN_VISIT_LIMIT = 100;
const ARCHIVED_CLAIM_HEARTBEAT_MS = 15_000;
const ARCHIVED_CURSOR_KEY = 'archived-attachments-v1';
const ORPHAN_SCAN_VISIT_LIMIT = 100;
const ORPHAN_DELETE_LIMIT = 100;
const DEFAULT_POLL_MS = 60 * 60 * 1000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const SHARD_PATTERN = /^[0-9a-f]{2}$/u;

type ArchivedAttachment = {
  id: string;
  spaceId: string;
  contentHash: string;
  storageKey: string;
  archivedAt: Date | null;
};

type ArchivedCursorPosition = {
  archivedAt: Date | null;
  attachmentId: string | null;
};

type ArchivedPageClaim = {
  ownerToken: string;
  attachments: ArchivedAttachment[];
};

type ArchivedLeaseHeartbeat = {
  assertActive(): Promise<boolean>;
  markLost(): void;
  stop(): Promise<void>;
};

type OrphanCandidate = {
  absolutePath: string;
  contentHash: string;
  storageKey: string;
};

type OrphanScanVisit = {
  candidate?: OrphanCandidate;
};

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pollInterval(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_POLL_MS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_POLL_MS;
  if (parsed > MAX_TIMER_DELAY_MS) {
    throw new Error(`ATTACHMENT_CLEANUP_POLL_MS must be at most ${MAX_TIMER_DELAY_MS}`);
  }
  return parsed;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

@Injectable()
export class AttachmentCleanupWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentCleanupWorker.name);
  private timer?: NodeJS.Timeout;
  private shuttingDown = false;
  private activeTick?: Promise<void>;
  private destroyPromise?: Promise<void>;
  private orphanIterator?: AsyncGenerator<OrphanScanVisit, void, void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(ATTACHMENT_STORAGE)
    private readonly storage: AttachmentStorage,
    @Inject(ATTACHMENT_CONFIG)
    private readonly attachmentConfig: AttachmentConfig,
  ) {}

  onModuleInit(): void {
    if (this.shuttingDown) return;
    const role = String(this.config.get('PROCESS_ROLE') || 'api').toLowerCase();
    if (!['worker', 'all'].includes(role)) return;
    const intervalMs = pollInterval(this.config.get('ATTACHMENT_CLEANUP_POLL_MS'));
    this.timer = setInterval(() => void this.safeTick(), intervalMs);
    this.timer.unref?.();
    void this.safeTick();
  }

  onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.destroyPromise ??= this.finishDestroy();
    return this.destroyPromise;
  }

  async tick(): Promise<void> {
    if (this.shuttingDown || this.activeTick) return;
    const activeTick = this.runTick();
    this.activeTick = activeTick;
    try {
      await activeTick;
    } finally {
      if (this.activeTick === activeTick) this.activeTick = undefined;
    }
  }

  private async runTick(): Promise<void> {
    if (this.shuttingDown) return;
    const now = Date.now();
    const referenceTime = new Date(now);
    await this.storage.cleanupExpiredTempReservations(
      new Date(now - this.attachmentConfig.orphanGraceMs),
    );
    if (this.shuttingDown) return;
    await this.cleanupArchived(
      new Date(now - this.attachmentConfig.retentionMs),
      referenceTime,
    );
    if (this.shuttingDown) return;
    await this.cleanupOrphans(
      new Date(now - this.attachmentConfig.orphanGraceMs),
      referenceTime,
    );
  }

  private async safeTick(): Promise<void> {
    if (this.shuttingDown) return;
    try {
      await this.tick();
    } catch (error) {
      this.logger.error(`Attachment cleanup tick failed: ${safeMessage(error)}`);
    }
  }

  private async cleanupArchived(cutoff: Date, referenceTime: Date): Promise<void> {
    if (this.shuttingDown) return;
    const claim = await this.claimArchivedPage(cutoff);
    if (!claim) return;
    const heartbeat = this.startArchivedLeaseHeartbeat(claim.ownerToken);
    try {
      if (this.shuttingDown) return;
      for (const attachment of claim.attachments) {
        if (this.shuttingDown || !await heartbeat.assertActive()) return;
        try {
          if (await this.hasRevisionOwner(this.prisma, attachment)) continue;
          const deleted = await this.prisma.$transaction(async (tx) => {
            const lease = await tx.$queryRaw<Array<{ key: string }>>`
              UPDATE "AttachmentCleanupCursor"
              SET "leaseExpiresAt" = clock_timestamp() + INTERVAL '60 seconds',
                  "updatedAt" = clock_timestamp()
              WHERE key = ${ARCHIVED_CURSOR_KEY}
                AND "leaseOwner" = ${claim.ownerToken}
                AND "leaseExpiresAt" > clock_timestamp()
              RETURNING key
            `;
            if (lease.length !== 1) return { count: 0, leaseLost: true };
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id
              FROM "SpaceAttachment"
              WHERE id = ${attachment.id}
                AND status = 'archived'::"SpaceAttachmentStatus"
                AND "archivedAt" <= ${cutoff}
              FOR UPDATE
            `;
            if (locked.length !== 1) return { count: 0, leaseLost: false };
            if (await this.hasRevisionOwner(tx, attachment)) {
              return { count: 0, leaseLost: false };
            }
            await tx.attachmentVersion.deleteMany({
              where: {
                attachmentId: attachment.id,
                revisionRows: { none: {} },
              },
            });
            const result = await tx.spaceAttachment.deleteMany({
              where: {
                id: attachment.id,
                status: 'archived',
                archivedAt: { lte: cutoff },
              },
            });
            return { count: result.count, leaseLost: false };
          });
          if (deleted.leaseLost) {
            heartbeat.markLost();
            return;
          }
          if (deleted.count !== 1) continue;
          if (this.shuttingDown || !await heartbeat.assertActive()) return;
          await this.removeBlobWhenUnreferenced(
            attachment.storageKey,
            attachment.contentHash,
            referenceTime,
            () => heartbeat.assertActive(),
          );
        } catch (error) {
          this.logger.error(
            `Attachment cleanup failed for metadata ${attachment.id}: ${safeMessage(error)}`,
          );
        }
      }
    } finally {
      await heartbeat.stop();
    }
  }

  private async claimArchivedPage(cutoff: Date): Promise<ArchivedPageClaim | null> {
    const ownerToken = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "AttachmentCleanupCursor" ("key")
        VALUES (${ARCHIVED_CURSOR_KEY})
        ON CONFLICT ("key") DO NOTHING
      `;
      const positions = await tx.$queryRaw<Array<{
        archivedAt: Date | null;
        attachmentId: string | null;
        sweepArchivedAt: Date | null;
        sweepAttachmentId: string | null;
        leaseOwner: string | null;
        leaseExpiresAt: Date | null;
      }>>`
        UPDATE "AttachmentCleanupCursor"
        SET "leaseOwner" = ${ownerToken},
            "leaseExpiresAt" = clock_timestamp() + INTERVAL '60 seconds',
            "updatedAt" = clock_timestamp()
        WHERE key = ${ARCHIVED_CURSOR_KEY}
          AND (
            "leaseOwner" IS NULL
            OR "leaseExpiresAt" <= clock_timestamp()
          )
        RETURNING "archivedAt", "attachmentId", "sweepArchivedAt", "sweepAttachmentId",
                  "leaseOwner", "leaseExpiresAt"
      `;
      if (positions.length === 0) return null;
      const position = positions[0];
      if (
        positions.length !== 1
        || !position
        || ((position.archivedAt === null) !== (position.attachmentId === null))
        || ((position.sweepArchivedAt === null) !== (position.sweepAttachmentId === null))
        || ((position.leaseOwner === null) !== (position.leaseExpiresAt === null))
      ) throw new Error('ATTACHMENT_CLEANUP_CURSOR_INVALID');

      const select = {
        id: true,
        spaceId: true,
        contentHash: true,
        storageKey: true,
        archivedAt: true,
      } as const;
      const findTail = () => tx.spaceAttachment.findFirst({
        where: { status: 'archived', archivedAt: { lte: cutoff } },
        orderBy: [{ archivedAt: 'desc' as const }, { id: 'desc' as const }],
        select,
      }) as Promise<ArchivedAttachment | null>;
      const findPage = (
        current: ArchivedCursorPosition | null,
        sweep: ArchivedCursorPosition,
      ) =>
        tx.spaceAttachment.findMany({
          where: {
            status: 'archived',
            archivedAt: { lte: cutoff },
            AND: [
              ...(current?.archivedAt && current.attachmentId
                ? [{
                  OR: [
                    { archivedAt: { gt: current.archivedAt } },
                    { archivedAt: current.archivedAt, id: { gt: current.attachmentId } },
                  ],
                }]
                : []),
              {
                OR: [
                  { archivedAt: { lt: sweep.archivedAt! } },
                  { archivedAt: sweep.archivedAt!, id: { lte: sweep.attachmentId! } },
                ],
              },
            ],
          },
          orderBy: [{ archivedAt: 'asc' as const }, { id: 'asc' as const }],
          take: ARCHIVED_SCAN_VISIT_LIMIT,
          select,
        }) as Promise<ArchivedAttachment[]>;

      let sweep: ArchivedCursorPosition | null = position.sweepArchivedAt
        ? { archivedAt: position.sweepArchivedAt, attachmentId: position.sweepAttachmentId }
        : null;
      let current: ArchivedCursorPosition | null = position.archivedAt
        ? { archivedAt: position.archivedAt, attachmentId: position.attachmentId }
        : null;
      if (!sweep) {
        const tail = await findTail();
        if (!tail?.archivedAt) {
          await tx.attachmentCleanupCursor.update({
            where: { key: ARCHIVED_CURSOR_KEY },
            data: {
              archivedAt: null, attachmentId: null,
              sweepArchivedAt: null, sweepAttachmentId: null,
              leaseOwner: null, leaseExpiresAt: null,
            },
          });
          return null;
        }
        sweep = { archivedAt: tail.archivedAt, attachmentId: tail.id };
      }
      let page = await findPage(current, sweep);
      if (page.length === 0 && current) {
        const tail = await findTail();
        if (!tail?.archivedAt) {
          await tx.attachmentCleanupCursor.update({
            where: { key: ARCHIVED_CURSOR_KEY },
            data: {
              archivedAt: null, attachmentId: null,
              sweepArchivedAt: null, sweepAttachmentId: null,
              leaseOwner: null, leaseExpiresAt: null,
            },
          });
          return null;
        }
        current = null;
        sweep = { archivedAt: tail.archivedAt, attachmentId: tail.id };
        page = await findPage(current, sweep);
      }
      if (page.length === 0) {
        await tx.attachmentCleanupCursor.updateMany({
          where: { key: ARCHIVED_CURSOR_KEY, leaseOwner: ownerToken },
          data: { leaseOwner: null, leaseExpiresAt: null },
        });
        return null;
      }
      const last = page[page.length - 1];
      await tx.attachmentCleanupCursor.update({
        where: { key: ARCHIVED_CURSOR_KEY },
        data: {
          archivedAt: last!.archivedAt,
          attachmentId: last!.id,
          sweepArchivedAt: sweep.archivedAt,
          sweepAttachmentId: sweep.attachmentId,
        },
      });
      return { ownerToken, attachments: page };
    });
  }

  private async renewArchivedLease(ownerToken: string): Promise<boolean> {
    const renewed = await this.prisma.$queryRaw<Array<{ key: string }>>`
      UPDATE "AttachmentCleanupCursor"
      SET "leaseExpiresAt" = clock_timestamp() + INTERVAL '60 seconds',
          "updatedAt" = clock_timestamp()
      WHERE key = ${ARCHIVED_CURSOR_KEY}
        AND "leaseOwner" = ${ownerToken}
        AND "leaseExpiresAt" > clock_timestamp()
      RETURNING key
    `;
    return renewed.length === 1;
  }

  private async releaseArchivedLease(ownerToken: string): Promise<void> {
    await this.prisma.attachmentCleanupCursor.updateMany({
      where: { key: ARCHIVED_CURSOR_KEY, leaseOwner: ownerToken },
      data: { leaseOwner: null, leaseExpiresAt: null },
    });
  }

  private startArchivedLeaseHeartbeat(ownerToken: string): ArchivedLeaseHeartbeat {
    let lost = false;
    let heartbeat = Promise.resolve();
    const beat = () => {
      heartbeat = heartbeat.then(async () => {
        if (!lost && !await this.renewArchivedLease(ownerToken)) lost = true;
      }).catch(() => {
        lost = true;
      });
    };
    const timer = setInterval(beat, ARCHIVED_CLAIM_HEARTBEAT_MS);
    timer.unref?.();
    return {
      assertActive: async () => {
        await heartbeat;
        if (lost) return false;
        if (!await this.renewArchivedLease(ownerToken)) lost = true;
        return !lost;
      },
      markLost: () => { lost = true; },
      stop: async () => {
        clearInterval(timer);
        await heartbeat;
        await this.releaseArchivedLease(ownerToken);
      },
    };
  }

  private async hasRevisionOwner(
    db: Pick<PrismaService, 'syncRevisionAttachmentRow'>,
    attachment: Pick<ArchivedAttachment, 'id' | 'spaceId'>,
  ): Promise<boolean> {
    const owner = await db.syncRevisionAttachmentRow.findFirst({
      where: { attachmentId: attachment.id, spaceId: attachment.spaceId },
      select: { attachmentId: true },
    });
    return owner !== null;
  }

  private async cleanupOrphans(cutoff: Date, referenceTime: Date): Promise<void> {
    let visited = 0;
    let deletions = 0;
    while (
      !this.shuttingDown
      && visited < ORPHAN_SCAN_VISIT_LIMIT
      && deletions < ORPHAN_DELETE_LIMIT
    ) {
      this.orphanIterator ??= this.scanOrphanEntries();
      let next: IteratorResult<OrphanScanVisit, void>;
      try {
        next = await this.orphanIterator.next();
      } catch (error) {
        try {
          await this.closeOrphanIterator();
        } catch (closeError) {
          this.logger.error(
            `Attachment orphan iterator close failed: ${safeMessage(closeError)}`,
          );
        }
        throw error;
      }
      if (this.shuttingDown) return;
      if (next.done) {
        await this.closeOrphanIterator();
        break;
      }
      visited += 1;
      const candidate = next.value.candidate;
      if (!candidate) continue;
      try {
        if (await isAttachmentBlobReferenced(
          this.prisma,
          candidate.storageKey,
          referenceTime,
          this.attachmentConfig.orphanGraceMs,
        )) continue;
        let removed = false;
        if (this.shuttingDown) return;
        await this.storage.withContentLock(candidate.contentHash, async (lease) => {
          if (this.shuttingDown) return;
          const metadata = await lstat(candidate.absolutePath);
          if (this.shuttingDown) return;
          if (
            metadata.isSymbolicLink()
            || !metadata.isFile()
            || metadata.mtimeMs > cutoff.getTime()
          ) return;
          const referenced = await isAttachmentBlobReferenced(
            this.prisma,
            candidate.storageKey,
            referenceTime,
            this.attachmentConfig.orphanGraceMs,
          );
          if (this.shuttingDown) return;
          if (!referenced) {
            await this.storage.removeIfUnreferenced(candidate.storageKey, lease);
            removed = true;
          }
        });
        if (removed) deletions += 1;
      } catch (error) {
        this.logger.error(
          `Attachment orphan cleanup failed for ${candidate.storageKey}: ${safeMessage(error)}`,
        );
      }
    }
  }

  private async removeBlobWhenUnreferenced(
    storageKey: string,
    contentHash: string,
    referenceTime: Date,
    leaseActive: () => Promise<boolean> = async () => true,
  ): Promise<void> {
    if (this.shuttingDown || !await leaseActive()) return;
    await this.storage.withContentLock(contentHash, async (lease) => {
      if (this.shuttingDown || !await leaseActive()) return;
      const referenced = await isAttachmentBlobReferenced(
        this.prisma,
        storageKey,
        referenceTime,
        this.attachmentConfig.orphanGraceMs,
      );
      if (this.shuttingDown || !await leaseActive()) return;
      if (!referenced) {
        await this.storage.removeIfUnreferenced(storageKey, lease);
      }
    });
  }

  private async finishDestroy(): Promise<void> {
    const activeTick = this.activeTick;
    if (activeTick) {
      try {
        await activeTick;
      } catch (error) {
        this.logger.error(`Attachment cleanup tick failed during shutdown: ${safeMessage(error)}`);
      }
    }
    try {
      await this.closeOrphanIterator();
    } catch (error) {
      this.logger.error(`Attachment orphan iterator close failed: ${safeMessage(error)}`);
    }
  }

  private async *scanOrphanEntries(): AsyncGenerator<OrphanScanVisit, void, void> {
    const root = resolve(this.attachmentConfig.storagePath);
    const algorithmRoot = join(root, 'sha256');

    if (!await this.isSafeDirectory(algorithmRoot)) return;
    const firstLevel = await opendir(algorithmRoot);
    for await (const first of firstLevel) {
      const firstPath = join(algorithmRoot, first.name);
      const validFirst = (
        first.isDirectory()
        && !first.isSymbolicLink()
        && SHARD_PATTERN.test(first.name)
        && await this.isSafeDirectory(firstPath)
      );
      yield {};
      if (!validFirst) continue;
      const secondLevel = await opendir(firstPath);
      for await (const second of secondLevel) {
        const secondPath = join(firstPath, second.name);
        const validSecond = (
          second.isDirectory()
          && !second.isSymbolicLink()
          && SHARD_PATTERN.test(second.name)
          && await this.isSafeDirectory(secondPath)
        );
        yield {};
        if (!validSecond) continue;
        const blobs = await opendir(secondPath);
        for await (const blob of blobs) {
          let candidate: OrphanCandidate | undefined;
          if (
            blob.isFile()
            && !blob.isSymbolicLink()
            && HASH_PATTERN.test(blob.name)
            && blob.name.slice(0, 2) === first.name
            && blob.name.slice(2, 4) === second.name
          ) {
            const absolutePath = join(secondPath, blob.name);
            let metadata;
            try {
              metadata = await lstat(absolutePath);
            } catch (error) {
              if (!isMissing(error)) throw error;
            }
            if (metadata?.isFile() && !metadata.isSymbolicLink()) {
              candidate = {
                absolutePath,
                contentHash: blob.name,
                storageKey: `sha256/${first.name}/${second.name}/${blob.name}`,
              };
            }
          }
          yield candidate ? { candidate } : {};
        }
      }
    }
  }

  private async closeOrphanIterator(): Promise<void> {
    const iterator = this.orphanIterator;
    this.orphanIterator = undefined;
    if (iterator) await iterator.return(undefined);
  }

  private async isSafeDirectory(path: string): Promise<boolean> {
    try {
      const metadata = await lstat(path);
      return metadata.isDirectory() && !metadata.isSymbolicLink();
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }
}
