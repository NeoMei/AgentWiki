import type { Principal } from '../../core/authorization/authorization.service';
import { SyncV3BootstrapService } from './sync-v3-bootstrap.service';

describe('SyncV3BootstrapService', () => {
  const principal: Principal = { userId: 'user-1', credentialId: 'device-1' };
  const inspection = {
    mode: 'bootstrap_required' as const,
    baseRevision: 'revision-1',
    candidateHash: 'a'.repeat(64),
    attachmentCount: '1',
    transferBytes: '4',
    blockers: [],
    candidate: { folders: [], pages: [], attachments: [] },
  };

  function setup() {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: principal.credentialId }]),
      humanDeviceCredential: { findUnique: jest.fn().mockResolvedValue({
        id: principal.credentialId, userId: principal.userId, status: 'active', provisionalExpiresAt: null,
      }) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: unknown) => unknown) => callback(tx)),
    };
    const authorization = {
      assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner' }),
      lockLiveHumanPrincipal: jest.fn().mockResolvedValue({ id: principal.userId }),
      assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner' }),
    };
    const revisionWriter = {
      lockSpace: jest.fn().mockResolvedValue(tx),
    };
    const v3Writer = {
      inspectCurrentLocked: jest.fn().mockResolvedValue(inspection),
      advanceV3Locked: jest.fn().mockResolvedValue({
        revisionId: 'revision-2', sequence: 2,
        revisionContentHash: inspection.candidateHash,
        pageCount: 0n, attachmentCount: 1n,
        revisionManifestByteLength: 200n,
        revisionBodyBytes: 0n, revisionAttachmentBytes: 4n,
        publishedAt: new Date('2026-09-04T00:00:00.000Z'),
      }),
    };
    return {
      tx, prisma, authorization, revisionWriter, v3Writer,
      service: new SyncV3BootstrapService(
        prisma as any,
        authorization as any,
        revisionWriter as any,
        v3Writer as any,
      ),
    };
  }

  it('does not create a revision during bootstrap preview', async () => {
    const { service, prisma, revisionWriter, v3Writer } = setup();

    await expect(service.previewBootstrap('space-1', principal)).resolves.toEqual({
      protocolVersion: '3',
      mode: 'bootstrap_required',
      baseRevision: inspection.baseRevision,
      candidateHash: inspection.candidateHash,
      attachmentCount: '1',
      transferBytes: '4',
      blockers: [],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(revisionWriter.lockSpace).not.toHaveBeenCalled();
    expect(v3Writer.advanceV3Locked).not.toHaveBeenCalled();
  });

  it('publishes the first v3 revision under the same Space lock after explicit confirmation', async () => {
    const { service, tx, authorization, revisionWriter, v3Writer } = setup();

    await expect(service.bootstrapConfirmed('space-1', principal, {
      baseRevision: inspection.baseRevision,
      confirmationHash: inspection.candidateHash,
    })).resolves.toMatchObject({
      protocolVersion: '3',
      revision: 'revision-2',
      sequence: 2,
    });
    expect(revisionWriter.lockSpace).toHaveBeenCalledWith(tx, 'space-1');
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledWith(
      tx, principal, 'space-1', ['owner', 'editor'],
    );
    expect(v3Writer.advanceV3Locked).toHaveBeenCalledWith(
      tx,
      'space-1',
      inspection.candidate,
      {
        origin: 'obsidian_sync',
        createdByUserId: principal.userId,
        humanDeviceCredentialId: principal.credentialId,
      },
    );
  });

  it('fails closed when the candidate changes after preview', async () => {
    const { service, v3Writer } = setup();
    v3Writer.inspectCurrentLocked.mockResolvedValue({
      ...inspection,
      candidateHash: 'b'.repeat(64),
    });

    await expect(service.bootstrapConfirmed('space-1', principal, {
      baseRevision: inspection.baseRevision,
      confirmationHash: inspection.candidateHash,
    })).rejects.toEqual(expect.objectContaining({ syncCode: 'CONFIRMATION_MISMATCH' }));
    expect(v3Writer.advanceV3Locked).not.toHaveBeenCalled();
  });

  it('rechecks the locked Human Device Credential after guard success and before publishing', async () => {
    const { service, tx, v3Writer } = setup();
    tx.humanDeviceCredential.findUnique.mockResolvedValue({
      id: principal.credentialId, userId: principal.userId, status: 'revoked', provisionalExpiresAt: null,
    });

    await expect(service.bootstrapConfirmed('space-1', principal, {
      baseRevision: inspection.baseRevision,
      confirmationHash: inspection.candidateHash,
    })).rejects.toEqual(expect.objectContaining({ syncCode: 'DEVICE_CREDENTIAL_REVOKED' }));
    expect(v3Writer.advanceV3Locked).not.toHaveBeenCalled();
  });
});
