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
const DEFAULT_POLL_MS = 60 * 60 * 1000;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const SHARD_PATTERN = /^[0-9a-f]{2}$/u;

type ArchivedAttachment = {
  id: string;
  contentHash: string;
  storageKey: string;
  archivedAt: Date | null;
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
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(ATTACHMENT_STORAGE)
    private readonly storage: AttachmentStorage,
    @Inject(ATTACHMENT_CONFIG)
    private readonly attachmentConfig: AttachmentConfig,
  ) {}

  onModuleInit(): void {
    const role = String(this.config.get('PROCESS_ROLE') || 'api').toLowerCase();
    if (!['worker', 'all'].includes(role)) return;
    const intervalMs = pollInterval(this.config.get('ATTACHMENT_CLEANUP_POLL_MS'));
    this.timer = setInterval(() => void this.safeTick(), intervalMs);
    this.timer.unref?.();
    void this.safeTick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      await this.cleanupArchived(new Date(now - this.attachmentConfig.retentionMs));
      await this.cleanupOrphans(new Date(now - this.attachmentConfig.orphanGraceMs));
    } finally {
      this.running = false;
    }
  }

  private async safeTick(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      this.logger.error(`Attachment cleanup tick failed: ${safeMessage(error)}`);
    }
  }

  private async cleanupArchived(cutoff: Date): Promise<void> {
    const archived = await this.prisma.spaceAttachment.findMany({
      where: { status: 'archived', archivedAt: { lte: cutoff } },
      orderBy: [{ archivedAt: 'asc' }, { id: 'asc' }],
      take: BATCH_SIZE,
      select: { id: true, contentHash: true, storageKey: true, archivedAt: true },
    }) as ArchivedAttachment[];

    for (const attachment of archived) {
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
    const candidates = await this.findOrphanCandidates(cutoff, BATCH_SIZE);
    for (const candidate of candidates) {
      try {
        await this.storage.withContentLock(candidate.contentHash, async (lease) => {
          const metadata = await lstat(candidate.absolutePath);
          if (
            metadata.isSymbolicLink()
            || !metadata.isFile()
            || metadata.mtimeMs > cutoff.getTime()
          ) return;
          const references = await this.prisma.spaceAttachment.count({
            where: { storageKey: candidate.storageKey },
          });
          if (references === 0) {
            await this.storage.removeIfUnreferenced(candidate.storageKey, lease);
          }
        });
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
    await this.storage.withContentLock(contentHash, async (lease) => {
      const references = await this.prisma.spaceAttachment.count({
        where: { storageKey },
      });
      if (references === 0) {
        await this.storage.removeIfUnreferenced(storageKey, lease);
      }
    });
  }

  private async findOrphanCandidates(
    cutoff: Date,
    limit: number,
  ): Promise<Array<{ absolutePath: string; contentHash: string; storageKey: string }>> {
    const root = resolve(this.attachmentConfig.storagePath);
    const algorithmRoot = join(root, 'sha256');
    const candidates: Array<{
      absolutePath: string;
      contentHash: string;
      storageKey: string;
    }> = [];

    if (!await this.isSafeDirectory(algorithmRoot)) return candidates;
    const firstLevel = await opendir(algorithmRoot);
    for await (const first of firstLevel) {
      if (candidates.length >= limit) break;
      if (!first.isDirectory() || first.isSymbolicLink() || !SHARD_PATTERN.test(first.name)) {
        continue;
      }
      const firstPath = join(algorithmRoot, first.name);
      if (!await this.isSafeDirectory(firstPath)) continue;
      const secondLevel = await opendir(firstPath);
      for await (const second of secondLevel) {
        if (candidates.length >= limit) break;
        if (!second.isDirectory() || second.isSymbolicLink() || !SHARD_PATTERN.test(second.name)) {
          continue;
        }
        const secondPath = join(firstPath, second.name);
        if (!await this.isSafeDirectory(secondPath)) continue;
        const blobs = await opendir(secondPath);
        for await (const blob of blobs) {
          if (candidates.length >= limit) break;
          if (!blob.isFile() || blob.isSymbolicLink() || !HASH_PATTERN.test(blob.name)) continue;
          if (blob.name.slice(0, 2) !== first.name || blob.name.slice(2, 4) !== second.name) {
            continue;
          }
          const absolutePath = join(secondPath, blob.name);
          let metadata;
          try {
            metadata = await lstat(absolutePath);
          } catch (error) {
            if (isMissing(error)) continue;
            throw error;
          }
          if (
            metadata.isSymbolicLink()
            || !metadata.isFile()
            || metadata.mtimeMs > cutoff.getTime()
          ) continue;
          candidates.push({
            absolutePath,
            contentHash: blob.name,
            storageKey: `sha256/${first.name}/${second.name}/${blob.name}`,
          });
        }
      }
    }
    return candidates;
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
