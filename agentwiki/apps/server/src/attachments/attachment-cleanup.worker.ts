import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lstat, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaService } from '../database/prisma.service';
import type { AttachmentConfig } from './attachment.config';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from './attachment-storage';
import { ATTACHMENT_CONFIG } from './attachment.service';

const BATCH_SIZE = 100;
const ORPHAN_SCAN_VISIT_LIMIT = 100;
const ORPHAN_DELETE_LIMIT = 100;
const DEFAULT_POLL_MS = 60 * 60 * 1000;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const SHARD_PATTERN = /^[0-9a-f]{2}$/u;

type ArchivedAttachment = {
  id: string;
  contentHash: string;
  storageKey: string;
  archivedAt: Date | null;
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
    await this.cleanupArchived(new Date(now - this.attachmentConfig.retentionMs));
    if (this.shuttingDown) return;
    await this.cleanupOrphans(new Date(now - this.attachmentConfig.orphanGraceMs));
  }

  private async safeTick(): Promise<void> {
    if (this.shuttingDown) return;
    try {
      await this.tick();
    } catch (error) {
      this.logger.error(`Attachment cleanup tick failed: ${safeMessage(error)}`);
    }
  }

  private async cleanupArchived(cutoff: Date): Promise<void> {
    if (this.shuttingDown) return;
    const archived = await this.prisma.spaceAttachment.findMany({
      where: { status: 'archived', archivedAt: { lte: cutoff } },
      orderBy: [{ archivedAt: 'asc' }, { id: 'asc' }],
      take: BATCH_SIZE,
      select: { id: true, contentHash: true, storageKey: true, archivedAt: true },
    }) as ArchivedAttachment[];
    if (this.shuttingDown) return;

    for (const attachment of archived) {
      if (this.shuttingDown) return;
      try {
        const deleted = await this.prisma.$transaction((tx) =>
          tx.spaceAttachment.deleteMany({
            where: {
              id: attachment.id,
              status: 'archived',
              archivedAt: { lte: cutoff },
            },
          }),
        );
        if (deleted.count !== 1) continue;
        if (this.shuttingDown) return;
        await this.removeBlobWhenUnreferenced(
          attachment.storageKey,
          attachment.contentHash,
        );
      } catch (error) {
        this.logger.error(
          `Attachment cleanup failed for metadata ${attachment.id}: ${safeMessage(error)}`,
        );
      }
    }
  }

  private async cleanupOrphans(cutoff: Date): Promise<void> {
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
          const references = await this.prisma.spaceAttachment.count({
            where: { storageKey: candidate.storageKey },
          });
          if (this.shuttingDown) return;
          if (references === 0) {
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
  ): Promise<void> {
    if (this.shuttingDown) return;
    await this.storage.withContentLock(contentHash, async (lease) => {
      if (this.shuttingDown) return;
      const references = await this.prisma.spaceAttachment.count({
        where: { storageKey },
      });
      if (this.shuttingDown) return;
      if (references === 0) {
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
