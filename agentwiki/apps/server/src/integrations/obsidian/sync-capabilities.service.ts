import { Injectable } from '@nestjs/common';
import {
  capabilitiesHash,
  TREE_SYNC_V2_LIMITS,
  TREE_SYNC_V3_HARD_LIMITS,
  treeCapabilitiesHashV3,
  TreeSyncCapabilitiesV3Schema,
} from '@neomei/agentwiki-sync-protocol';
import { DEFAULT_SYNC_CAPABILITIES } from './obsidian-crypto.service';
import { PrismaService } from '../../database/prisma.service';
import { SyncApiException } from './sync-error';
import { SyncV3RevisionWriterService } from '../../core/sync/sync-v3-revision-writer.service';

@Injectable()
export class SyncCapabilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly v3Writer: SyncV3RevisionWriterService,
  ) {}

  capabilities() {
    return { ...DEFAULT_SYNC_CAPABILITIES };
  }

  async hash(): Promise<string> {
    return capabilitiesHash(DEFAULT_SYNC_CAPABILITIES);
  }

  capabilitiesV2() {
    return {
      ...DEFAULT_SYNC_CAPABILITIES,
      maxBatchItems: TREE_SYNC_V2_LIMITS.maxPushChanges,
      maxChangeCount: TREE_SYNC_V2_LIMITS.maxPushChanges,
      maxClientTotalBodyBytes: TREE_SYNC_V2_LIMITS.maxDocumentTreeBytes,
      maxClientSpaceFolders: TREE_SYNC_V2_LIMITS.maxClientSpaceFolders,
      maxSnapshotObjects: TREE_SYNC_V2_LIMITS.maxSnapshotObjects,
      maxDeltaItems: TREE_SYNC_V2_LIMITS.maxDeltaItems,
      maxResponseBytes: Math.min(DEFAULT_SYNC_CAPABILITIES.maxResponseBytes, TREE_SYNC_V2_LIMITS.maxResponseBytes),
    };
  }

  async hashV2(): Promise<string> {
    return capabilitiesHash(this.capabilitiesV2());
  }

  capabilitiesV3() {
    return TreeSyncCapabilitiesV3Schema.parse({
      ...this.capabilitiesV2(),
      maxAttachmentBytes: TREE_SYNC_V3_HARD_LIMITS.maxAttachmentBytes,
      maxRevisionAttachments: TREE_SYNC_V3_HARD_LIMITS.maxRevisionAttachments,
      maxTransferBlobBytes: TREE_SYNC_V3_HARD_LIMITS.maxTransferBlobBytes,
      blobChunkBytes: TREE_SYNC_V3_HARD_LIMITS.blobChunkBytes,
      maxBlobChunks: TREE_SYNC_V3_HARD_LIMITS.maxBlobChunks,
      maxConcurrentBlobs: TREE_SYNC_V3_HARD_LIMITS.maxConcurrentBlobs,
      maxImageDimension: TREE_SYNC_V3_HARD_LIMITS.maxImageDimension,
      maxDecodedPixels: TREE_SYNC_V3_HARD_LIMITS.maxDecodedPixels,
      allowedMimeTypes: ['image/gif', 'image/jpeg', 'image/png', 'image/webp'],
      blobStagingTtlSeconds: 900,
      downloadAuthorizationTtlSeconds: 300,
    });
  }

  async hashV3(): Promise<string> {
    return treeCapabilitiesHashV3(this.capabilitiesV3());
  }

  async assertV1Compatible(spaceId: string): Promise<void> {
    {
      const inspection = await this.prisma.$transaction(
        (tx) => this.v3Writer.inspectCurrentLocked(tx as any, spaceId),
        { isolationLevel: 'RepeatableRead' },
      );
      if (inspection.mode === 'bootstrap_required') {
        throw new SyncApiException(
          'SYNC_PROTOCOL_UPGRADE_REQUIRED',
          'Current Space content requires Sync v3',
        );
      }
    }
    const [activeFolders, placedPages] = await Promise.all([
      this.prisma.folder.count({ where: { spaceId, deletedAt: null } }),
      this.prisma.page.count({
        where: { spaceId, deletedAt: null, folderId: { not: null } },
      }),
    ]);
    if (activeFolders > 0 || placedPages > 0) {
      throw new SyncApiException(
        'SYNC_PROTOCOL_UPGRADE_REQUIRED',
        'This Space contains Folder structure and requires Sync Protocol v2',
      );
    }
  }
}
