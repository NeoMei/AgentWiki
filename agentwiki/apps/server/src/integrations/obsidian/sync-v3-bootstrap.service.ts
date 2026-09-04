import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuthorizationService,
  type Principal,
} from '../../core/authorization/authorization.service';
import { SpaceRevisionWriterService } from '../../core/sync/space-revision-writer.service';
import {
  SyncV3RevisionWriterService,
  type SyncV3CandidateInspection,
} from '../../core/sync/sync-v3-revision-writer.service';
import { PrismaService } from '../../database/prisma.service';
import { SyncApiException } from './sync-error';

export interface BootstrapPreview {
  protocolVersion: '3';
  mode: 'bootstrap_required';
  baseRevision: string;
  candidateHash: string;
  attachmentCount: string;
  transferBytes: string;
  blockers: Array<{
    pageId: string;
    code: 'ATTACHMENT_REFERENCE_INVALID' | 'ATTACHMENT_MISSING';
  }>;
}

@Injectable()
export class SyncV3BootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly revisionWriter: SpaceRevisionWriterService,
    private readonly v3Writer: SyncV3RevisionWriterService,
  ) {}

  async previewBootstrap(spaceId: string, principal: Principal): Promise<BootstrapPreview> {
    await this.authorization.assertSpaceAccess(
      principal,
      spaceId,
      ['owner', 'admin', 'editor', 'viewer'],
      'pages:read',
    );
    const inspection = await this.prisma.$transaction(
      (tx) => this.v3Writer.inspectCurrentLocked(tx as any, spaceId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return this.previewEnvelope(inspection);
  }

  async bootstrapConfirmed(
    spaceId: string,
    principal: Principal,
    input: { baseRevision: string; confirmationHash: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      await this.assertLiveCredentialLocked(tx, principal);
      const lockedTx = await this.revisionWriter.lockSpace(tx, spaceId);
      await this.authorization.assertLiveHumanSpaceAccess(
        lockedTx,
        principal,
        spaceId,
        ['owner', 'editor'],
      );
      const inspection = await this.v3Writer.inspectCurrentLocked(lockedTx, spaceId);
      if (inspection.baseRevision !== input.baseRevision) {
        throw new SyncApiException('BASE_STALE', 'Bootstrap base revision is stale', undefined, '3');
      }
      if (inspection.candidateHash !== input.confirmationHash) {
        throw new SyncApiException(
          'CONFIRMATION_MISMATCH',
          'Bootstrap candidate changed after preview',
          undefined,
          '3',
        );
      }
      if (inspection.mode !== 'bootstrap_required') {
        throw new SyncApiException(
          'SYNC_PROTOCOL_UPGRADE_REQUIRED',
          'Space does not require a Sync v3 bootstrap',
          undefined,
          '3',
        );
      }
      const blocker = inspection.blockers[0];
      if (blocker) {
        throw new SyncApiException(
          blocker.code,
          'Bootstrap candidate contains an unresolved attachment reference',
          undefined,
          '3',
        );
      }
      const result = await this.v3Writer.advanceV3Locked(
        lockedTx,
        spaceId,
        inspection.candidate,
        {
          origin: 'obsidian_sync',
          createdByUserId: principal.userId,
          humanDeviceCredentialId: principal.credentialId,
        },
      );
      return {
        protocolVersion: '3' as const,
        status: 'published' as const,
        revision: result.revisionId,
        sequence: result.sequence,
        revisionContentHash: result.revisionContentHash,
        folderCount: String(inspection.candidate.folders.length),
        pageCount: result.pageCount.toString(),
        attachmentCount: result.attachmentCount.toString(),
        revisionManifestByteLength: result.revisionManifestByteLength.toString(),
        revisionBodyBytes: result.revisionBodyBytes.toString(),
        revisionAttachmentBytes: result.revisionAttachmentBytes.toString(),
        publishedAt: result.publishedAt.toISOString(),
        changeSetId: null,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    });
  }

  private async assertLiveCredentialLocked(
    tx: Prisma.TransactionClient,
    principal: Principal,
  ): Promise<void> {
    if (!principal.credentialId) {
      throw new SyncApiException('DEVICE_CREDENTIAL_REVOKED', 'Device credential is unavailable', undefined, '3');
    }
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "HumanDeviceCredential"
      WHERE "id" = ${principal.credentialId}
      FOR NO KEY UPDATE
    `);
    const credential = rows.length === 1
      ? await tx.humanDeviceCredential.findUnique({
        where: { id: principal.credentialId },
        select: { id: true, userId: true, status: true, provisionalExpiresAt: true },
      })
      : null;
    if (!credential || credential.userId !== principal.userId
      || !['active', 'provisional'].includes(credential.status)) {
      throw new SyncApiException('DEVICE_CREDENTIAL_REVOKED', 'Device credential is unavailable', undefined, '3');
    }
    if (credential.status === 'provisional'
      && (!credential.provisionalExpiresAt || credential.provisionalExpiresAt <= new Date())) {
      throw new SyncApiException('DEVICE_CREDENTIAL_EXPIRED', 'Device credential is expired', undefined, '3');
    }
  }

  private previewEnvelope(inspection: SyncV3CandidateInspection): BootstrapPreview {
    if (inspection.mode !== 'bootstrap_required') {
      throw new SyncApiException(
        'SYNC_PROTOCOL_UPGRADE_REQUIRED',
        'Space does not require a Sync v3 bootstrap',
        undefined,
        '3',
      );
    }
    return {
      protocolVersion: '3',
      mode: inspection.mode,
      baseRevision: inspection.baseRevision,
      candidateHash: inspection.candidateHash,
      attachmentCount: inspection.attachmentCount,
      transferBytes: inspection.transferBytes,
      blockers: inspection.blockers,
    };
  }
}
