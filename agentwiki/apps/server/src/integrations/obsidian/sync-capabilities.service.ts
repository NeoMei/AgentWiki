import { Injectable } from '@nestjs/common';
import { capabilitiesHash, TREE_SYNC_V2_LIMITS } from '@neomei/agentwiki-sync-protocol';
import { DEFAULT_SYNC_CAPABILITIES } from './obsidian-crypto.service';
import { PrismaService } from '../../database/prisma.service';
import { SyncApiException } from './sync-error';

@Injectable()
export class SyncCapabilitiesService {
  constructor(private readonly prisma: PrismaService) {}

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
    };
  }

  async hashV2(): Promise<string> {
    return capabilitiesHash(this.capabilitiesV2());
  }

  async assertV1Compatible(spaceId: string): Promise<void> {
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
